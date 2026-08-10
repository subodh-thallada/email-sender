import { newId, one, run, todayStamp } from "@/lib/db";
import { getProfile } from "@/lib/profile";
import { sendMail } from "@/lib/send/gmail";
import { enqueue } from "@/lib/send/outbox";
import { defaultAccount, sendingConfigured } from "@/lib/google/accounts";
import { trackingFor } from "@/lib/send/tracking";
import { describeSlot, nextPeakSlot, readOffset } from "@/lib/send/peak";
import { followupSubject } from "@/lib/ai/followup";
import {
  attachGmailThread,
  getThreadDetail,
  recordOutgoing,
  replyHeaders,
} from "@/lib/threads/store";

export const runtime = "nodejs";

function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

/**
 * Sends or schedules a follow-up inside an existing conversation.
 *
 * Separate from /api/send rather than a flag on it: that route refuses to email
 * the same person twice, which is exactly the behaviour a follow-up needs to
 * skip, and threading a second message onto the first is different enough that
 * one branchy handler would be harder to read than two.
 */
export async function POST(req: Request) {
  const { threadId, body, subject, mode, scheduledAt, tzOffsetMinutes } =
    (await req.json()) as {
      threadId?: string;
      body?: string;
      /** Optional override. Defaults to "Re: <the thread's subject>". */
      subject?: string;
      mode?: "now" | "at" | "peak";
      scheduledAt?: string;
      tzOffsetMinutes?: number;
    };

  if (!threadId || !body?.trim()) {
    return fail("threadId and body are both required.");
  }
  if (!sendingConfigured()) {
    return fail(
      "Sending is not set up. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.",
    );
  }

  const detail = await getThreadDetail(threadId);
  if (!detail) return fail("Unknown thread.", 404);

  const account = await defaultAccount();
  if (!account) {
    return fail("No Gmail account is connected. Connect one in Settings.");
  }

  const profile = await getProfile();

  // A follow-up is a real send and counts against the same cap. Skipping it
  // here would let a day of follow-ups quietly double the day's volume.
  const today = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sends
     WHERE status = 'sent' AND substr(sent_at, 1, 10) = ?`,
    [todayStamp()],
  );
  const sentToday = Number(today?.n ?? 0);
  if (sentToday >= profile.daily_send_cap) {
    return fail(
      `Daily cap reached (${sentToday}/${profile.daily_send_cap}). Raise it in Settings or continue tomorrow.`,
    );
  }

  const thread = detail.thread;
  const base =
    thread.subject ||
    detail.messages.find((m) => m.direction === "outgoing")?.subject ||
    "";
  const finalSubject = subject?.trim() || followupSubject(base);
  const headers = await replyHeaders(threadId);

  const offset = readOffset(tzOffsetMinutes);
  let when: Date | null = null;

  if (mode === "peak") {
    if (offset === null) {
      return fail("Could not read your timezone, so no peak time can be picked.");
    }
    when = nextPeakSlot({ offsetMinutes: offset });
  } else if (scheduledAt) {
    when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return fail("Invalid scheduled time.");
    if (when.getTime() < Date.now() - 60_000) return fail("That time is in the past.");
  }

  if (when) {
    if (!process.env.CRON_SECRET) {
      return fail(
        "Scheduling needs CRON_SECRET set and a cron job hitting /api/cron/send-due.",
      );
    }
    const id = await enqueue({
      personId: thread.personId,
      from: account.email,
      to: thread.contactEmail,
      subject: finalSubject,
      body,
      scheduledAt: when,
      threadId,
      gmailThreadId: headers.gmailThreadId,
      inReplyTo: headers.inReplyTo,
      references: headers.references,
      kind: "followup",
    });
    return Response.json({
      ok: true,
      scheduled: true,
      id,
      subject: finalSubject,
      scheduledAt: when.toISOString(),
      when: offset === null ? null : describeSlot(when, offset),
    });
  }

  // A draft is recorded when there is still a person to hang it off. Deleting
  // the search that found this contact takes their `people` row with it, and a
  // follow-up to someone in that state simply has no draft — `sends.draft_id`
  // is nullable precisely for this case.
  let draftId: string | null = null;
  if (thread.personId) {
    const person = await one<{ id: string }>(
      "SELECT id FROM people WHERE id = ?",
      [thread.personId],
    );
    if (person) {
      draftId = newId("d");
      await run(
        "INSERT INTO drafts (id, person_id, subject, body, edited) VALUES (?,?,?,?,1)",
        [draftId, thread.personId, finalSubject, body],
      );
    }
  }

  const sendId = newId("snd");
  const tracking = await trackingFor();

  try {
    const { messageId, threadId: gmailThreadId } = await sendMail({
      from: account.email,
      to: thread.contactEmail,
      subject: finalSubject,
      body,
      fromName: profile.full_name || undefined,
      pixelUrl: tracking?.url,
      threadId: headers.gmailThreadId,
      inReplyTo: headers.inReplyTo,
      references: headers.references,
    });

    await run(
      `INSERT INTO sends (id, draft_id, person_id, to_address, subject, message_id,
         status, track_token, thread_id, gmail_thread_id, kind)
       VALUES (?,?,?,?,?,?, 'sent', ?,?,?, 'followup')`,
      [
        sendId,
        draftId,
        thread.personId ?? "",
        thread.contactEmail,
        finalSubject,
        messageId,
        tracking?.token ?? null,
        threadId,
        gmailThreadId,
      ],
    );
    if (gmailThreadId) await attachGmailThread(threadId, gmailThreadId);
    await recordOutgoing({
      threadId,
      gmailId: messageId,
      fromAddress: account.email,
      toAddress: thread.contactEmail,
      subject: finalSubject,
      body,
    });

    return Response.json({
      ok: true,
      messageId,
      subject: finalSubject,
      tracked: Boolean(tracking),
      sentToday: sentToday + 1,
      cap: profile.daily_send_cap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      `INSERT INTO sends (id, draft_id, person_id, to_address, subject, status,
         error, thread_id, kind)
       VALUES (?,?,?,?,?, 'error', ?,?, 'followup')`,
      [
        sendId,
        draftId,
        thread.personId ?? "",
        thread.contactEmail,
        finalSubject,
        message,
        threadId,
      ],
    );
    return fail(message, 502);
  }
}
