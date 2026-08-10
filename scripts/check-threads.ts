import { all, newId, run } from "../lib/db";
import {
  addTag,
  attachGmailThread,
  backfillThreads,
  createLabel,
  createThread,
  deleteLabel,
  getThreadDetail,
  listLabels,
  listThreads,
  recordOutgoing,
  removeTag,
  replyHeaders,
  setArchived,
  setFolder,
} from "../lib/threads/store";
import { followupSubject, threadState } from "../lib/threads/types";
import {
  buildPrompt,
  daysBetween,
  followupMode,
  systemFor,
} from "../lib/ai/followup";
import { parseAddress, sanitizeReplyHtml } from "../lib/gmail/read";
import { enqueue } from "../lib/send/outbox";

/**
 * Exercises the dashboard's data layer against the local database. Touches no
 * network: the Gmail half is covered by the pure parsers, and everything else
 * is store round-trips.
 */

let fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
};

const MARK = "threads-test.invalid";

async function cleanup() {
  const rows = await all<{ id: string }>(
    "SELECT id FROM threads WHERE contact_email LIKE ?",
    [`%@${MARK}`],
  );
  for (const r of rows) {
    await run("DELETE FROM thread_messages WHERE thread_id = ?", [r.id]);
    await run("DELETE FROM thread_tags WHERE thread_id = ?", [r.id]);
    await run("DELETE FROM outbox WHERE thread_id = ?", [r.id]);
    await run("DELETE FROM sends WHERE thread_id = ?", [r.id]);
    await run("DELETE FROM threads WHERE id = ?", [r.id]);
  }
  await run("DELETE FROM labels WHERE name LIKE 'ztest-%'");
  await run("DELETE FROM sends WHERE to_address LIKE ?", [`%@${MARK}`]);
  await run("DELETE FROM outbox WHERE to_address LIKE ?", [`%@${MARK}`]);
}

async function main() {
  await cleanup();

  /* ------------------------------------------------------------ threads -- */

  const threadId = await createThread({
    contactEmail: `ada@${MARK}`,
    contactName: "Ada Lovelace",
    subject: "Summer research in analytical engines",
  });
  await recordOutgoing({
    threadId,
    gmailId: "gm_test_1",
    fromAddress: `me@${MARK}`,
    toAddress: `ada@${MARK}`,
    subject: "Summer research in analytical engines",
    body: "Hello, I read your note on Bernoulli numbers.",
  });

  const listed = (await listThreads()).find((t) => t.id === threadId);
  check("thread appears in the list", Boolean(listed));
  check("preview comes from the last message", Boolean(listed?.preview));
  check("state with no reply is awaiting", listed ? threadState(listed) === "awaiting" : false);

  // Recording the same Gmail message twice must not duplicate the timeline —
  // the sync and the send path both write it.
  await recordOutgoing({
    threadId,
    gmailId: "gm_test_1",
    fromAddress: `me@${MARK}`,
    toAddress: `ada@${MARK}`,
    subject: "Summer research in analytical engines",
    body: "Hello again.",
  });
  const detail = await getThreadDetail(threadId);
  check("a repeated gmail id is not duplicated", detail?.messages.length === 1);

  await attachGmailThread(threadId, "gthread_test_1");
  const second = await createThread({
    contactEmail: `charles@${MARK}`,
    subject: "Difference engine",
  });
  await attachGmailThread(second, "gthread_test_1");
  const clash = await all<{ gmail_thread_id: string | null }>(
    "SELECT gmail_thread_id FROM threads WHERE id = ?",
    [second],
  );
  check(
    "a gmail thread id is not stolen from another thread",
    clash[0]?.gmail_thread_id === null,
  );

  /* ------------------------------------------------------------- replies -- */

  await run(
    `INSERT INTO thread_messages (id, thread_id, gmail_id, direction, from_address,
       from_name, to_address, subject, snippet, body_text, rfc_message_id, sent_at, created_at)
     VALUES (?,?,?, 'incoming', ?,?,?,?,?,?,?,?,?)`,
    [
      newId("msg"),
      threadId,
      "gm_test_2",
      `ada@${MARK}`,
      "Ada Lovelace",
      `me@${MARK}`,
      "Re: Summer research in analytical engines",
      "Happy to talk.",
      "Happy to talk. Tuesday works.",
      "<reply-1@mail.test>",
      "2026-08-01 09:00:00",
      "2026-08-01 09:00:00",
    ],
  );
  await run(
    "UPDATE threads SET reply_count = 1, last_reply_at = ? WHERE id = ?",
    ["2026-08-01 09:00:00", threadId],
  );

  const replied = (await listThreads()).find((t) => t.id === threadId);
  check("state flips to replied", replied ? threadState(replied) === "replied" : false);

  const withReply = await getThreadDetail(threadId);
  check("timeline holds both directions", withReply?.messages.length === 2);
  check(
    "follow-up mode switches to reply once they write back",
    followupMode(withReply?.messages ?? []) === "reply",
  );

  const headers = await replyHeaders(threadId);
  check("in-reply-to is the newest message id", headers.inReplyTo === "<reply-1@mail.test>");
  check("gmail thread id is carried through", headers.gmailThreadId === "gthread_test_1");

  /* ------------------------------------------------------------ queueing -- */

  const queuedId = await enqueue({
    personId: null,
    from: `me@${MARK}`,
    to: `ada@${MARK}`,
    subject: "Re: Summer research in analytical engines",
    body: "Tuesday at ten works.",
    scheduledAt: new Date(Date.now() + 86_400_000),
    threadId,
    gmailThreadId: headers.gmailThreadId,
    inReplyTo: headers.inReplyTo,
    references: headers.references,
    kind: "followup",
  });
  const queuedRow = await all<{ kind: string; in_reply_to: string; refs: string }>(
    "SELECT kind, in_reply_to, refs FROM outbox WHERE id = ?",
    [queuedId],
  );
  check("a queued follow-up keeps its threading headers", queuedRow[0]?.in_reply_to === "<reply-1@mail.test>");
  check("a queued follow-up is marked as one", queuedRow[0]?.kind === "followup");

  const scheduled = (await listThreads()).find((t) => t.id === threadId);
  check("a queued message shows on the row", scheduled?.scheduledCount === 1);
  check(
    "scheduled outranks replied in the state",
    scheduled ? threadState(scheduled) === "scheduled" : false,
  );

  /* -------------------------------------------------------- categorising -- */

  const folder = await createLabel({ kind: "folder", name: "ztest-Research", color: "green" });
  const tag = await createLabel({ kind: "tag", name: "ztest-warm", color: "amber" });
  const dupe = await createLabel({ kind: "folder", name: "ztest-Research" });
  check("creating the same folder twice reuses it", dupe.id === folder.id);

  await setFolder([threadId], folder.id);
  await addTag([threadId], tag.id);
  const filed = (await listThreads()).find((t) => t.id === threadId);
  check("folder sticks", filed?.folderId === folder.id);
  check("tag sticks", filed?.tagIds.includes(tag.id) === true);

  await removeTag([threadId], tag.id);
  const untagged = (await listThreads()).find((t) => t.id === threadId);
  check("tag comes off", untagged?.tagIds.includes(tag.id) === false);

  await setArchived([threadId], true);
  const archived = (await listThreads()).find((t) => t.id === threadId);
  check("archive sticks", archived?.archived === true);
  await setArchived([threadId], false);

  await deleteLabel(folder.id);
  const afterDelete = (await listThreads()).find((t) => t.id === threadId);
  check("deleting a folder keeps the thread", Boolean(afterDelete));
  check("deleting a folder clears the assignment", afterDelete?.folderId === null);
  check(
    "deleted label is gone from the list",
    (await listLabels()).every((l) => l.id !== folder.id),
  );

  /* ------------------------------------------------------------ backfill -- */

  const orphanDraft = newId("d");
  const orphanSend = newId("snd");
  await run(
    `INSERT INTO sends (id, draft_id, person_id, to_address, subject, message_id, status, sent_at)
     VALUES (?,?,?,?,?,?, 'sent', ?)`,
    [
      orphanSend,
      orphanDraft,
      "",
      `legacy@${MARK}`,
      "An email sent before threads existed",
      "gm_legacy_1",
      "2026-07-01 12:00:00",
    ],
  );
  await backfillThreads();
  const adopted = await all<{ thread_id: string | null }>(
    "SELECT thread_id FROM sends WHERE id = ?",
    [orphanSend],
  );
  check("an old send is adopted into a thread", Boolean(adopted[0]?.thread_id));

  const before = (await listThreads()).length;
  await backfillThreads();
  check("backfill is idempotent", (await listThreads()).length === before);

  /* --------------------------------------------------------------- pure -- */

  check("subject gains exactly one Re:", followupSubject("Hello") === "Re: Hello");
  check("existing Re: is not stacked", followupSubject("Re: Re: Hello") === "Re: Hello");
  check("empty subject degrades cleanly", followupSubject("   ") === "Re:");

  const addr = parseAddress('"Ada Lovelace" <Ada@Example.COM>');
  check("display name is split off", addr.name === "Ada Lovelace");
  check("address is lowercased", addr.address === "ada@example.com");
  check("a bare address parses", parseAddress("x@y.z").address === "x@y.z");

  const dirty = '<p onclick="x()">hi <script>steal()</script><img src="http://track/p.gif"></p>';
  const clean = sanitizeReplyHtml(dirty);
  check("scripts are stripped", !/script/i.test(clean), clean);
  check("tracking images are stripped", !/<img/i.test(clean), clean);
  check("event handlers are stripped", !/onclick/i.test(clean), clean);
  check("text survives", clean.includes("hi"), clean);

  check("days are counted from a UTC stamp", daysBetween("2026-08-01 00:00:00", new Date("2026-08-11T00:00:00Z")) === 10);

  /* ------------------------------------------------ follow-up prompting -- */

  const profile = {
    full_name: "Test Sender",
    headline: "third-year CS undergrad",
    background: "Built a lidar pipeline and a quadrotor controller.",
    goal: "a summer research position",
    tone: "warm-professional",
    signature: "— Test",
    daily_send_cap: 25,
    offer: "",
    audience: "",
    links: "https://example.com",
    instructions: "Always mention I can start in May.",
  };

  const messages = (await getThreadDetail(threadId))?.messages ?? [];
  const prompt = buildPrompt({
    profile,
    contactName: "Ada Lovelace",
    contactEmail: `ada@${MARK}`,
    messages,
    intent: "offer to send the code",
  });
  check("the prompt carries the conversation", prompt.includes("THEY REPLIED"));
  check("the prompt carries the sender", prompt.includes("Test Sender"));
  check("the intent is passed through", prompt.includes("offer to send the code"));
  check("links are offered verbatim", prompt.includes("https://example.com"));

  const nudge = systemFor(profile, "nudge");
  check("a nudge forbids the bumping cliches", nudge.includes("just following up"));
  check("standing instructions outrank the house style", nudge.includes("start in May"));
  check(
    "a reply prompt accepts a no gracefully",
    systemFor(profile, "reply").includes("If they said no"),
  );
  check(
    "no follow-up prompt asks for a subject line",
    !nudge.includes("Subject:") && !systemFor(profile, "reply").includes("Subject:"),
  );

  await cleanup();
  console.log(fail ? `\n${fail} FAILED` : "\nAll thread checks passed.");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
