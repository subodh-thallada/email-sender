import { all, newId, nowStamp, one, run } from "../db";
import type {
  LabelKind,
  LabelView,
  MessageView,
  PendingView,
  ThreadDetail,
  ThreadView,
} from "./types";
import { LABEL_COLOR_KEYS } from "./types";

/**
 * Reads and writes for the outreach dashboard.
 *
 * A `thread` is the unit the user actually manages: one contact, the first
 * email, every follow-up, and every reply. Folders, tags and archiving all hang
 * off it, so filing a conversation once keeps it filed as it grows.
 *
 * Aggregates (opens, failures, queued messages) are stitched together in JS
 * rather than in one wide join. The joins would have to be written twice for
 * two SQL dialects, and at single-user scale the difference is unmeasurable.
 */

export interface ThreadRow {
  id: string;
  gmail_thread_id: string | null;
  person_id: string | null;
  contact_name: string | null;
  contact_email: string;
  subject: string;
  folder_id: string | null;
  archived: number;
  reply_count: number;
  last_sent_at: string | null;
  last_reply_at: string | null;
  synced_at: string | null;
  created_at: string;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

function isColor(value: string | undefined): value is string {
  return Boolean(value) && (LABEL_COLOR_KEYS as string[]).includes(value as string);
}

/* ------------------------------------------------------------------ write -- */

export async function createThread(input: {
  personId?: string | null;
  contactEmail: string;
  contactName?: string | null;
  subject: string;
  gmailThreadId?: string | null;
}): Promise<string> {
  const id = newId("thr");
  await run(
    `INSERT INTO threads (id, gmail_thread_id, person_id, contact_name,
       contact_email, subject, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id,
      input.gmailThreadId ?? null,
      input.personId || null,
      input.contactName ?? null,
      input.contactEmail,
      input.subject,
      nowStamp(),
    ],
  );
  return id;
}

/**
 * Points a thread at its Gmail conversation.
 *
 * Guarded against the id already being taken: Gmail puts a follow-up into the
 * same conversation as the original, so a second thread row that somehow
 * pointed at it would break the unique index and, worse, split one conversation
 * across two dashboard rows.
 */
export async function attachGmailThread(
  threadId: string,
  gmailThreadId: string,
): Promise<void> {
  if (!gmailThreadId) return;
  const clash = await one<{ id: string }>(
    "SELECT id FROM threads WHERE gmail_thread_id = ? AND id <> ?",
    [gmailThreadId, threadId],
  );
  if (clash) return;
  await run("UPDATE threads SET gmail_thread_id = ? WHERE id = ?", [
    gmailThreadId,
    threadId,
  ]);
}

/** Records a message we sent, so the timeline is right before any Gmail sync. */
export async function recordOutgoing(input: {
  threadId: string;
  gmailId?: string | null;
  fromAddress: string;
  toAddress: string;
  subject: string;
  body: string;
  sentAt?: string;
}): Promise<void> {
  const at = input.sentAt ?? nowStamp();

  // A sync may already have imported this message from Gmail. Matching on the
  // Gmail id keeps the two paths from writing the conversation twice.
  if (input.gmailId) {
    const existing = await one<{ id: string }>(
      "SELECT id FROM thread_messages WHERE gmail_id = ?",
      [input.gmailId],
    );
    if (existing) return;
  }

  await run(
    `INSERT INTO thread_messages (id, thread_id, gmail_id, direction,
       from_address, to_address, subject, snippet, body_text, sent_at, created_at)
     VALUES (?,?,?, 'outgoing', ?,?,?,?,?,?,?)`,
    [
      newId("msg"),
      input.threadId,
      input.gmailId ?? null,
      input.fromAddress,
      input.toAddress,
      input.subject,
      input.body.replace(/\s+/g, " ").slice(0, 200),
      input.body,
      at,
      nowStamp(),
    ],
  );
  await run(
    `UPDATE threads SET last_sent_at = ?
     WHERE id = ? AND (last_sent_at IS NULL OR last_sent_at < ?)`,
    [at, input.threadId, at],
  );
}

/* -------------------------------------------------------------- backfill -- */

/**
 * Gives every pre-existing send a thread to live in.
 *
 * Runs on each dashboard load and is a no-op once caught up — the guard query
 * is a single indexed lookup. Sends made before thread ids existed cannot be
 * grouped by Gmail conversation (that id was never recorded), so they are
 * grouped by recipient, which is the same thing in practice: the send route
 * refuses to email one person twice.
 */
export async function backfillThreads(): Promise<number> {
  const orphans = await all<{
    id: string;
    person_id: string;
    to_address: string;
    subject: string;
    message_id: string | null;
    status: string;
    sent_at: string;
    body: string | null;
  }>(
    `SELECT s.id, s.person_id, s.to_address, s.subject, s.message_id, s.status,
            s.sent_at, d.body
     FROM sends s LEFT JOIN drafts d ON d.id = s.draft_id
     WHERE s.thread_id IS NULL
     ORDER BY s.sent_at
     LIMIT 500`,
  );
  if (!orphans.length) return 0;

  // Names come from the people table when the person still exists; a deleted
  // search leaves the address as the only label, which is fine.
  const personIds = [...new Set(orphans.map((o) => o.person_id).filter(Boolean))];
  const people = personIds.length
    ? await all<{ id: string; name: string }>(
        `SELECT id, name FROM people WHERE id IN (${placeholders(personIds.length)})`,
        personIds,
      )
    : [];
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  const groups = new Map<string, typeof orphans>();
  for (const row of orphans) {
    const key = row.person_id || row.to_address.toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  for (const rows of groups.values()) {
    const first = rows[0];

    // An earlier backfill may already have made this thread; reuse it rather
    // than splitting the same contact across two rows.
    const existing = await one<{ id: string }>(
      first.person_id
        ? "SELECT id FROM threads WHERE person_id = ? LIMIT 1"
        : "SELECT id FROM threads WHERE contact_email = ? LIMIT 1",
      [first.person_id || first.to_address.toLowerCase()],
    );

    const threadId =
      existing?.id ??
      (await createThread({
        personId: first.person_id,
        contactEmail: first.to_address,
        contactName: nameById.get(first.person_id) ?? null,
        subject: first.subject,
      }));

    for (const row of rows) {
      await run("UPDATE sends SET thread_id = ? WHERE id = ?", [threadId, row.id]);
      if (row.status !== "sent") continue;
      await recordOutgoing({
        threadId,
        gmailId: row.message_id,
        fromAddress: "",
        toAddress: row.to_address,
        subject: row.subject,
        body: row.body ?? "",
        sentAt: row.sent_at,
      });
    }
  }

  // Queued messages predating thread ids: file them against the thread for the
  // same recipient so they show up as "scheduled" rather than vanishing.
  const queued = await all<{ id: string; person_id: string | null; to_address: string }>(
    `SELECT id, person_id, to_address FROM outbox
     WHERE thread_id IS NULL AND status = 'pending' LIMIT 200`,
  );
  for (const row of queued) {
    const match = await one<{ id: string }>(
      "SELECT id FROM threads WHERE contact_email = ? LIMIT 1",
      [row.to_address.toLowerCase()],
    );
    const threadId =
      match?.id ??
      (await createThread({
        personId: row.person_id,
        contactEmail: row.to_address,
        subject: "",
      }));
    await run("UPDATE outbox SET thread_id = ? WHERE id = ?", [threadId, row.id]);
  }

  return orphans.length;
}

/* ------------------------------------------------------------------- read -- */

function view(row: ThreadRow): ThreadView {
  return {
    id: row.id,
    gmailThreadId: row.gmail_thread_id,
    personId: row.person_id,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    subject: row.subject,
    folderId: row.folder_id,
    archived: Number(row.archived) === 1,
    replyCount: Number(row.reply_count ?? 0),
    lastSentAt: row.last_sent_at,
    lastReplyAt: row.last_reply_at,
    syncedAt: row.synced_at,
    tagIds: [],
    openCount: 0,
    firstOpenedAt: null,
    sendCount: 0,
    errorCount: 0,
    scheduledCount: 0,
    nextScheduledAt: null,
    preview: "",
    previewDirection: null,
  };
}

export async function listThreads(limit = 500): Promise<ThreadView[]> {
  const rows = await all<ThreadRow>(
    `SELECT * FROM threads
     ORDER BY COALESCE(last_reply_at, last_sent_at, created_at) DESC
     LIMIT ?`,
    [limit],
  );
  if (!rows.length) return [];

  const threads = rows.map(view);
  const byId = new Map(threads.map((t) => [t.id, t]));

  const [tags, sends, queued, previews] = await Promise.all([
    all<{ thread_id: string; label_id: string }>(
      "SELECT thread_id, label_id FROM thread_tags",
    ),
    all<{
      thread_id: string;
      n: number;
      opens: number | null;
      first_open: string | null;
      errors: number;
    }>(
      `SELECT thread_id,
              SUM(CASE WHEN status = 'sent'  THEN 1 ELSE 0 END) AS n,
              SUM(COALESCE(open_count, 0))                      AS opens,
              MIN(first_opened_at)                              AS first_open,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM sends WHERE thread_id IS NOT NULL GROUP BY thread_id`,
    ),
    all<{ thread_id: string; n: number; next_at: string }>(
      `SELECT thread_id, COUNT(*) AS n, MIN(scheduled_at) AS next_at
       FROM outbox WHERE status = 'pending' AND thread_id IS NOT NULL
       GROUP BY thread_id`,
    ),
    // Snippets only. Pulling body_text here would put every full email on the
    // wire for a page that shows one line of each.
    all<{ thread_id: string; direction: string; snippet: string; sent_at: string }>(
      "SELECT thread_id, direction, snippet, sent_at FROM thread_messages ORDER BY sent_at",
    ),
  ]);

  for (const t of tags) byId.get(t.thread_id)?.tagIds.push(t.label_id);

  for (const s of sends) {
    const t = byId.get(s.thread_id);
    if (!t) continue;
    t.sendCount = Number(s.n ?? 0);
    t.openCount = Number(s.opens ?? 0);
    t.firstOpenedAt = s.first_open;
    t.errorCount = Number(s.errors ?? 0);
  }

  for (const q of queued) {
    const t = byId.get(q.thread_id);
    if (!t) continue;
    t.scheduledCount = Number(q.n ?? 0);
    t.nextScheduledAt = q.next_at;
  }

  // Ordered oldest-first by the query, so the last write per thread wins.
  for (const m of previews) {
    const t = byId.get(m.thread_id);
    if (!t) continue;
    t.preview = m.snippet;
    t.previewDirection = m.direction === "incoming" ? "incoming" : "outgoing";
  }

  return threads;
}

export async function getThreadDetail(id: string): Promise<ThreadDetail | null> {
  const row = await one<ThreadRow>("SELECT * FROM threads WHERE id = ?", [id]);
  if (!row) return null;

  const thread = view(row);

  const [tags, sends, queued, messages] = await Promise.all([
    all<{ label_id: string }>(
      "SELECT label_id FROM thread_tags WHERE thread_id = ?",
      [id],
    ),
    all<{ n: number; opens: number | null; first_open: string | null; errors: number }>(
      `SELECT SUM(CASE WHEN status = 'sent'  THEN 1 ELSE 0 END) AS n,
              SUM(COALESCE(open_count, 0))                      AS opens,
              MIN(first_opened_at)                              AS first_open,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM sends WHERE thread_id = ?`,
      [id],
    ),
    all<PendingRow>(
      `SELECT id, subject, body, scheduled_at, error FROM outbox
       WHERE thread_id = ? AND status = 'pending' ORDER BY scheduled_at`,
      [id],
    ),
    all<MessageRow>(
      `SELECT id, direction, from_address, from_name, to_address, subject,
              snippet, body_text, body_html, sent_at
       FROM thread_messages WHERE thread_id = ? ORDER BY sent_at`,
      [id],
    ),
  ]);

  thread.tagIds = tags.map((t) => t.label_id);
  const agg = sends[0];
  if (agg) {
    thread.sendCount = Number(agg.n ?? 0);
    thread.openCount = Number(agg.opens ?? 0);
    thread.firstOpenedAt = agg.first_open;
    thread.errorCount = Number(agg.errors ?? 0);
  }
  thread.scheduledCount = queued.length;
  thread.nextScheduledAt = queued[0]?.scheduled_at ?? null;

  const last = messages[messages.length - 1];
  if (last) {
    thread.preview = last.snippet;
    thread.previewDirection = last.direction === "incoming" ? "incoming" : "outgoing";
  }

  return {
    thread,
    messages: messages.map(messageView),
    pending: queued.map((p) => ({
      id: p.id,
      subject: p.subject,
      body: p.body,
      scheduledAt: p.scheduled_at,
      error: p.error,
    })),
  };
}

interface MessageRow {
  id: string;
  direction: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string | null;
  sent_at: string;
}

interface PendingRow {
  id: string;
  subject: string;
  body: string;
  scheduled_at: string;
  error: string | null;
}

function messageView(m: MessageRow): MessageView {
  return {
    id: m.id,
    direction: m.direction === "incoming" ? "incoming" : "outgoing",
    fromName: m.from_name,
    fromAddress: m.from_address,
    toAddress: m.to_address,
    subject: m.subject,
    snippet: m.snippet,
    text: m.body_text,
    html: m.body_html,
    sentAt: m.sent_at,
  };
}

/** The most recent message in a thread that can be replied to, for follow-ups. */
export async function lastMessage(threadId: string): Promise<MessageView | null> {
  const row = await one<MessageRow>(
    `SELECT id, direction, from_address, from_name, to_address, subject,
            snippet, body_text, body_html, sent_at
     FROM thread_messages WHERE thread_id = ? ORDER BY sent_at DESC LIMIT 1`,
    [threadId],
  );
  return row ? messageView(row) : null;
}

export interface ReplyHeaders {
  gmailThreadId: string | null;
  inReplyTo: string | null;
  /** Space-separated References chain, oldest first. */
  references: string | null;
}

/**
 * What a follow-up needs to land inside the existing conversation.
 *
 * All three are best-effort. Message-IDs only exist once a sync has imported
 * them, so an account without the read grant gets nulls here — the follow-up
 * still sends, Gmail still files it by threadId, and only the recipient's
 * client is left to thread it on subject alone.
 */
export async function replyHeaders(threadId: string): Promise<ReplyHeaders> {
  const thread = await one<{ gmail_thread_id: string | null }>(
    "SELECT gmail_thread_id FROM threads WHERE id = ?",
    [threadId],
  );

  const ids = await all<{ rfc_message_id: string }>(
    `SELECT rfc_message_id FROM thread_messages
     WHERE thread_id = ? AND rfc_message_id IS NOT NULL AND rfc_message_id <> ''
     ORDER BY sent_at`,
    [threadId],
  );

  const chain = ids.map((r) => r.rfc_message_id);
  return {
    gmailThreadId: thread?.gmail_thread_id ?? null,
    inReplyTo: chain[chain.length - 1] ?? null,
    // Long chains get trimmed from the front. Some servers cap the header
    // length, and the oldest ids are the least useful for threading.
    references: chain.length ? chain.slice(-10).join(" ") : null,
  };
}

/* ----------------------------------------------------------- categorising -- */

export async function listLabels(): Promise<LabelView[]> {
  const rows = await all<{
    id: string;
    kind: string;
    name: string;
    color: string;
    position: number;
  }>("SELECT id, kind, name, color, position FROM labels ORDER BY position, name");
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === "tag" ? "tag" : "folder",
    name: r.name,
    color: r.color,
  }));
}

export async function createLabel(input: {
  kind: LabelKind;
  name: string;
  color?: string;
}): Promise<LabelView> {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error("A name is required.");

  const existing = await one<{ id: string; color: string }>(
    "SELECT id, color FROM labels WHERE kind = ? AND name = ?",
    [input.kind, name],
  );
  if (existing) {
    return { id: existing.id, kind: input.kind, name, color: existing.color };
  }

  const color = isColor(input.color) ? input.color : "slate";
  const id = newId(input.kind === "folder" ? "fld" : "tag");
  const next = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM labels WHERE kind = ?",
    [input.kind],
  );

  await run(
    "INSERT INTO labels (id, kind, name, color, position, created_at) VALUES (?,?,?,?,?,?)",
    [id, input.kind, name, color, Number(next?.n ?? 0), nowStamp()],
  );
  return { id, kind: input.kind, name, color };
}

export async function renameLabel(
  id: string,
  name: string,
  color?: string,
): Promise<void> {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("A name is required.");
  if (isColor(color)) {
    await run("UPDATE labels SET name = ?, color = ? WHERE id = ?", [
      trimmed,
      color,
      id,
    ]);
    return;
  }
  await run("UPDATE labels SET name = ? WHERE id = ?", [trimmed, id]);
}

/**
 * Removes a folder or tag without touching the conversations in it. Deleting a
 * label is a filing decision, and it must never read as "delete these threads".
 */
export async function deleteLabel(id: string): Promise<void> {
  // threads.folder_id carries no foreign key (it would need one of the two
  // dialects' deferred-constraint spellings to survive the backfill order), so
  // the cleanup is explicit here.
  await run("UPDATE threads SET folder_id = NULL WHERE folder_id = ?", [id]);
  await run("DELETE FROM thread_tags WHERE label_id = ?", [id]);
  await run("DELETE FROM labels WHERE id = ?", [id]);
}

export async function setFolder(
  threadIds: string[],
  folderId: string | null,
): Promise<void> {
  if (!threadIds.length) return;
  await run(
    `UPDATE threads SET folder_id = ? WHERE id IN (${placeholders(threadIds.length)})`,
    [folderId, ...threadIds],
  );
}

export async function setArchived(
  threadIds: string[],
  archived: boolean,
): Promise<void> {
  if (!threadIds.length) return;
  await run(
    `UPDATE threads SET archived = ? WHERE id IN (${placeholders(threadIds.length)})`,
    [archived ? 1 : 0, ...threadIds],
  );
}

export async function addTag(threadIds: string[], labelId: string): Promise<void> {
  for (const threadId of threadIds) {
    await run(
      "INSERT OR IGNORE INTO thread_tags (thread_id, label_id) VALUES (?,?)",
      [threadId, labelId],
    );
  }
}

export async function removeTag(
  threadIds: string[],
  labelId: string,
): Promise<void> {
  if (!threadIds.length) return;
  await run(
    `DELETE FROM thread_tags WHERE label_id = ?
      AND thread_id IN (${placeholders(threadIds.length)})`,
    [labelId, ...threadIds],
  );
}
