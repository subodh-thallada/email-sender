import pLimit from "p-limit";
import { all, newId, nowStamp, one, run } from "../db";
import { listAccounts, readableAccount } from "../google/accounts";
import {
  GmailReadError,
  fetchThread,
  fetchThreadIdFor,
  type ThreadMessage,
} from "../gmail/read";
import { attachGmailThread } from "./store";

/**
 * Pulls replies out of Gmail and into the dashboard.
 *
 * Deliberately a poll rather than a push. Gmail's watch API needs a Cloud
 * Pub/Sub topic and a public webhook, which is a lot of infrastructure for a
 * single-user app that only cares about a few dozen conversations; asking for
 * the threads we already know about costs one request each and needs nothing
 * standing up.
 */

/** Concurrent Gmail reads. Well inside the per-user rate limit, and enough that
 *  a sweep of fifty conversations finishes while the button is still spinning. */
const CONCURRENCY = 5;

export interface SyncResult {
  ok: boolean;
  /** Set when the sync could not run at all, in words the UI can show. */
  reason?: string;
  needsReconnect?: boolean;
  scanned: number;
  newReplies: number;
  failed: number;
}

export async function syncReplies(
  opts: { limit?: number; threadId?: string } = {},
): Promise<SyncResult> {
  const empty: SyncResult = { ok: false, scanned: 0, newReplies: 0, failed: 0 };

  const account = await readableAccount();
  if (!account) {
    return {
      ...empty,
      reason:
        "No connected account has granted permission to read mail, so replies cannot be fetched. Reconnect Gmail in Settings.",
      needsReconnect: true,
    };
  }

  // Every address we send from counts as "us". Without this a second connected
  // account's messages would be filed as replies from a stranger.
  const own = new Set(
    (await listAccounts()).map((a) => a.email.toLowerCase()),
  );

  const targets = opts.threadId
    ? await all<TargetRow>(
        "SELECT id, gmail_thread_id FROM threads WHERE id = ?",
        [opts.threadId],
      )
    : await all<TargetRow>(
        `SELECT id, gmail_thread_id FROM threads WHERE archived = 0
         ORDER BY COALESCE(last_reply_at, last_sent_at, created_at) DESC
         LIMIT ?`,
        [opts.limit ?? 60],
      );

  const result: SyncResult = { ...empty, ok: true };
  const limit = pLimit(CONCURRENCY);
  // Held on an object rather than in a plain `let`: the flag is written inside
  // a closure, and reading it afterwards would otherwise be narrowed to null.
  const blocked: { err: GmailReadError | null } = { err: null };

  await Promise.all(
    targets.map((target) =>
      limit(async () => {
        // A grant that has been revoked mid-sweep fails identically for every
        // remaining thread; stop counting those as individual failures.
        if (blocked.err) return;
        try {
          const gmailThreadId = await resolveGmailThreadId(account.email, target);
          if (!gmailThreadId) return;

          result.scanned += 1;
          const messages = await fetchThread(account.email, gmailThreadId);
          for (const message of messages) {
            if (await upsertMessage(target.id, message, own)) {
              result.newReplies += 1;
            }
          }
          await recount(target.id);
        } catch (err) {
          if (err instanceof GmailReadError && err.needsReconnect) {
            blocked.err = err;
            return;
          }
          result.failed += 1;
        }
      }),
    ),
  );

  if (blocked.err) {
    return {
      ...result,
      ok: false,
      reason: blocked.err.message,
      needsReconnect: true,
    };
  }
  return result;
}

interface TargetRow {
  id: string;
  gmail_thread_id: string | null;
}

/**
 * The Gmail conversation id for a thread, looking it up from a sent message
 * when it was never recorded. Sends made before this feature existed only kept
 * the message id, which is enough to find the conversation once.
 */
async function resolveGmailThreadId(
  accountEmail: string,
  target: TargetRow,
): Promise<string | null> {
  if (target.gmail_thread_id) return target.gmail_thread_id;

  const send = await one<{ message_id: string }>(
    `SELECT message_id FROM sends
     WHERE thread_id = ? AND status = 'sent' AND message_id IS NOT NULL
       AND message_id <> ''
     ORDER BY sent_at LIMIT 1`,
    [target.id],
  );
  if (!send) return null;

  const gmailThreadId = await fetchThreadIdFor(accountEmail, send.message_id);
  if (!gmailThreadId) return null;

  await attachGmailThread(target.id, gmailThreadId);
  await run("UPDATE sends SET gmail_thread_id = ? WHERE thread_id = ?", [
    gmailThreadId,
    target.id,
  ]);
  return gmailThreadId;
}

/** Returns true when this was a reply we had not seen before. */
async function upsertMessage(
  threadId: string,
  message: ThreadMessage,
  own: Set<string>,
): Promise<boolean> {
  const direction = own.has(message.from.address) ? "outgoing" : "incoming";

  const existing = await one<{ id: string }>(
    "SELECT id FROM thread_messages WHERE gmail_id = ?",
    [message.gmailId],
  );

  if (existing) {
    // Fills the gaps in a row written at send time — which knows the markdown
    // it sent but not the Message-ID Gmail stamped on it — without overwriting
    // that markdown with Gmail's flattened rendering of it.
    await run(
      `UPDATE thread_messages
          SET from_address   = CASE WHEN from_address = '' THEN ? ELSE from_address END,
              from_name      = COALESCE(from_name, ?),
              to_address     = CASE WHEN to_address = '' THEN ? ELSE to_address END,
              subject        = CASE WHEN subject = '' THEN ? ELSE subject END,
              snippet        = CASE WHEN snippet = '' THEN ? ELSE snippet END,
              body_text      = CASE WHEN body_text = '' THEN ? ELSE body_text END,
              body_html      = COALESCE(body_html, ?),
              rfc_message_id = COALESCE(rfc_message_id, ?),
              direction      = ?
        WHERE id = ?`,
      [
        message.from.address,
        message.from.name,
        message.to,
        message.subject,
        message.snippet,
        message.text,
        message.html,
        message.rfcMessageId,
        direction,
        existing.id,
      ],
    );
    return false;
  }

  await run(
    `INSERT INTO thread_messages (id, thread_id, gmail_id, direction, from_address,
       from_name, to_address, subject, snippet, body_text, body_html,
       rfc_message_id, sent_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      newId("msg"),
      threadId,
      message.gmailId,
      direction,
      message.from.address,
      message.from.name,
      message.to,
      message.subject,
      message.snippet,
      message.text,
      message.html,
      message.rfcMessageId,
      message.sentAt,
      nowStamp(),
    ],
  );
  return direction === "incoming";
}

/** Recomputes the counters the list view sorts and filters on. */
async function recount(threadId: string): Promise<void> {
  const stats = await one<{
    replies: number | null;
    last_in: string | null;
    last_out: string | null;
  }>(
    `SELECT SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS replies,
            MAX(CASE WHEN direction = 'incoming' THEN sent_at END)  AS last_in,
            MAX(CASE WHEN direction = 'outgoing' THEN sent_at END)  AS last_out
     FROM thread_messages WHERE thread_id = ?`,
    [threadId],
  );

  await run(
    `UPDATE threads SET reply_count = ?, last_reply_at = ?,
       last_sent_at = COALESCE(?, last_sent_at), synced_at = ?
     WHERE id = ?`,
    [
      Number(stats?.replies ?? 0),
      stats?.last_in ?? null,
      stats?.last_out ?? null,
      nowStamp(),
      threadId,
    ],
  );
}
