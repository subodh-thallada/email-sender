import { all, newId, nowStamp, one, run, todayStamp } from "../db";
import { getProfile } from "../profile";
import { defaultAccount, NotConnectedError } from "../google/accounts";
import { sendMail } from "./gmail";
import { trackingFor } from "./tracking";

export interface OutboxRow {
  id: string;
  person_id: string | null;
  /** Connected account this was queued against. Null on rows queued before
   * sending moved to OAuth — those fall back to whatever is connected now. */
  from_email: string | null;
  to_address: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: "pending" | "sent" | "error" | "canceled";
  attempts: number;
  error: string | null;
  sent_at: string | null;
}

/** UTC 'YYYY-MM-DD HH:MM:SS', matching the schema's TEXT columns. */
export function toStamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function enqueue(input: {
  personId?: string | null;
  /** Account to send as, recorded now so a later reconnect to a different
   * address does not silently send this from the wrong mailbox. */
  from: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: Date;
}): Promise<string> {
  const id = newId("out");
  await run(
    `INSERT INTO outbox (id, person_id, from_email, to_address, subject, body, scheduled_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      id,
      input.personId ?? null,
      input.from,
      input.to,
      input.subject,
      input.body,
      toStamp(input.scheduledAt),
      nowStamp(),
    ],
  );
  return id;
}

export async function cancel(id: string): Promise<void> {
  await run(
    "UPDATE outbox SET status = 'canceled' WHERE id = ? AND status = 'pending'",
    [id],
  );
}

export async function pending(limit = 50): Promise<OutboxRow[]> {
  return all<OutboxRow>(
    `SELECT * FROM outbox WHERE status = 'pending'
     ORDER BY scheduled_at LIMIT ?`,
    [limit],
  );
}

async function sentToday(): Promise<number> {
  const row = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sends
     WHERE status = 'sent' AND substr(sent_at, 1, 10) = ?`,
    [todayStamp()],
  );
  return Number(row?.n ?? 0);
}

export interface FlushResult {
  due: number;
  sent: number;
  failed: number;
  skippedByCap: number;
}

/**
 * Send everything whose time has come. Called by the cron endpoint.
 *
 * The daily cap is re-checked per message, not once up front: a run that would
 * blow past the cap stops and leaves the rest pending for tomorrow rather than
 * dropping them.
 */
export async function flushDue(now = new Date()): Promise<FlushResult> {
  const result: FlushResult = { due: 0, sent: 0, failed: 0, skippedByCap: 0 };

  const rows = await all<OutboxRow>(
    `SELECT * FROM outbox WHERE status = 'pending' AND scheduled_at <= ?
     ORDER BY scheduled_at LIMIT 100`,
    [toStamp(now)],
  );
  result.due = rows.length;
  if (!rows.length) return result;

  const profile = await getProfile();
  const fallback = await defaultAccount();
  let count = await sentToday();

  for (const row of rows) {
    if (count >= profile.daily_send_cap) {
      result.skippedByCap += 1;
      continue;
    }

    try {
      const from = row.from_email ?? fallback?.email;
      if (!from) {
        throw new NotConnectedError(
          "No Gmail account is connected. Connect one in Settings.",
        );
      }

      // Minted here rather than at queue time: tracking may have been switched
      // on or off in the hours between scheduling and sending, and the setting
      // that matters is the one in force when the message actually goes out.
      const tracking = await trackingFor();

      const { messageId } = await sendMail({
        from,
        to: row.to_address,
        subject: row.subject,
        body: row.body,
        fromName: profile.full_name || undefined,
        pixelUrl: tracking?.url,
      });

      await run(
        `UPDATE outbox SET status = 'sent', message_id = ?, sent_at = ?,
           attempts = attempts + 1 WHERE id = ?`,
        [messageId, nowStamp(), row.id],
      );
      await run(
        `INSERT INTO sends (id, draft_id, person_id, to_address, subject, message_id, status, track_token, sent_at)
         VALUES (?,?,?,?,?,?, 'sent', ?, ?)`,
        [
          newId("snd"),
          row.id,
          row.person_id ?? "",
          row.to_address,
          row.subject,
          messageId,
          tracking?.token ?? null,
          nowStamp(),
        ],
      );
      count += 1;
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;

      // A missing or revoked grant is not this message's fault, and the cron
      // ticks every 15 minutes — counting it would burn all three attempts
      // within the hour it takes someone to notice and reconnect.
      if (err instanceof NotConnectedError) {
        await run("UPDATE outbox SET error = ? WHERE id = ?", [
          message,
          row.id,
        ]);
        continue;
      }

      // Three strikes, then stop retrying — a bad address should not be
      // retried on every cron tick forever.
      await run(
        `UPDATE outbox SET attempts = attempts + 1, error = ?,
           status = CASE WHEN attempts + 1 >= 3 THEN 'error' ELSE 'pending' END
         WHERE id = ?`,
        [message, row.id],
      );
    }
  }

  return result;
}
