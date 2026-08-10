import { all, newId, nowStamp, one, run } from "../db";
import { getSettings } from "../settings";

/**
 * Read receipts, done the only way SMTP allows: a 1x1 image whose URL is
 * unique per message. Loading it is the signal.
 *
 * What this can and cannot tell you, because the difference matters when
 * reading the numbers:
 *   - Gmail fetches every image through its own proxy the moment the message
 *     is opened, and caches it. So the first open is real, but repeat counts
 *     under-report, and the recorded IP belongs to Google, not the reader.
 *   - Some clients (Apple Mail Privacy Protection, most notably) prefetch
 *     images on delivery whether or not anyone looked. Those register as an
 *     open that never happened.
 *   - Anyone with images off never registers at all. A silent recipient has
 *     not necessarily ignored you.
 * Treat an open as weak positive evidence and nothing more.
 */

/** 43-byte fully transparent GIF. The smallest thing a mail client will fetch. */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export function pixelResponse(): Response {
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      // Proxies cache aggressively; without this every open after the first
      // would be served from an intermediary and never reach us at all.
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

/** Unguessable, so an open cannot be forged or enumerated from a send id. */
export function newTrackToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * The public origin mail is tracked against. Must be the deployed URL: a
 * localhost pixel in a stranger's inbox records nothing and looks broken in
 * clients that show alt text.
 */
export function trackingOrigin(): string | null {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return null;
  const base = raw.replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base)) return null;
  return base;
}

export function pixelUrl(token: string): string | null {
  const origin = trackingOrigin();
  return origin ? `${origin}/api/track/${token}.gif` : null;
}

/**
 * Whether this send should carry a pixel, and the token if so.
 *
 * Returns null when tracking is off or no public origin is configured, so
 * callers never have to special-case a half-configured setup.
 */
export async function trackingFor(): Promise<{
  token: string;
  url: string;
} | null> {
  const { trackOpens } = await getSettings();
  if (!trackOpens) return null;

  const token = newTrackToken();
  const url = pixelUrl(token);
  return url ? { token, url } : null;
}

/** True when tracking is switched on but cannot work, so Settings can say so. */
export async function trackingMisconfigured(): Promise<boolean> {
  const { trackOpens } = await getSettings();
  return trackOpens && trackingOrigin() === null;
}

/**
 * Records one pixel load. Unknown tokens are ignored rather than erroring:
 * the response is a GIF either way, and telling a scanner which tokens exist
 * would be the one thing worth hiding here.
 */
export async function recordOpen(
  token: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const send = await one<{ id: string }>(
    "SELECT id FROM sends WHERE track_token = ?",
    [token],
  );
  if (!send) return;

  const at = nowStamp();
  await run(
    `INSERT INTO email_opens (id, send_id, opened_at, user_agent, ip_prefix)
     VALUES (?,?,?,?,?)`,
    [newId("open"), send.id, at, meta.userAgent?.slice(0, 300) ?? null, ipPrefix(meta.ip)],
  );
  await run(
    `UPDATE sends SET open_count = open_count + 1,
       first_opened_at = COALESCE(first_opened_at, ?),
       last_opened_at = ?
     WHERE id = ?`,
    [at, at, send.id],
  );
}

/**
 * Coarsens an address to its network. Enough to tell a proxy prefetch from a
 * real reader; not enough to place anyone. The full address is never stored.
 */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  if (!first) return null;
  if (first.includes(":")) {
    // IPv6 -> /48.
    const groups = first.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}::/48` : null;
  }
  const octets = first.split(".");
  if (octets.length !== 4) return null;
  return `${octets.slice(0, 3).join(".")}.0/24`;
}

export interface OpenStat {
  personId: string;
  openCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
}

/** Open counts for a set of people, for the results list. */
export async function openStatsFor(
  personIds: string[],
): Promise<Map<string, OpenStat>> {
  if (personIds.length === 0) return new Map();

  const placeholders = personIds.map(() => "?").join(",");
  const rows = await all<{
    person_id: string;
    open_count: number | null;
    first_opened_at: string | null;
    last_opened_at: string | null;
  }>(
    `SELECT person_id,
            SUM(COALESCE(open_count, 0)) AS open_count,
            MIN(first_opened_at) AS first_opened_at,
            MAX(last_opened_at)  AS last_opened_at
     FROM sends
     WHERE status = 'sent' AND person_id IN (${placeholders})
     GROUP BY person_id`,
    personIds,
  );

  return new Map(
    rows.map((r) => [
      r.person_id,
      {
        personId: r.person_id,
        openCount: Number(r.open_count ?? 0),
        firstOpenedAt: r.first_opened_at,
        lastOpenedAt: r.last_opened_at,
      },
    ]),
  );
}
