/**
 * Formatting helpers for the dashboard. Client-safe: no database, no imports
 * that would drag the server bundle into the browser.
 */

/**
 * Parses the schema's 'YYYY-MM-DD HH:MM:SS' UTC strings.
 *
 * The trailing Z is load-bearing. Without it browsers read the string as local
 * time, and every timestamp in the app would drift by the reader's offset —
 * silently, and in the direction that makes recent things look like the future.
 */
export function parseStamp(stamp: string | null): Date | null {
  if (!stamp) return null;
  const ms = Date.parse(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** "3d", "5h", "just now" — dense enough for a list column. */
export function shortAgo(stamp: string | null): string {
  const date = parseStamp(stamp);
  if (!date) return "—";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds < 31_536_000) return `${Math.floor(seconds / 2_592_000)}mo`;
  return `${Math.floor(seconds / 31_536_000)}y`;
}

/** Full local time, for tooltips and the expanded timeline. */
export function fullTime(stamp: string | null): string {
  const date = parseStamp(stamp);
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** datetime-local wants local wall-clock, not ISO/UTC. */
export function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
