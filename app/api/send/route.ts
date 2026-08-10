import { newId, one, run, todayStamp } from "@/lib/db";
import { getProfile } from "@/lib/profile";
import { gmailConfigured, sendMail } from "@/lib/send/gmail";
import { syntaxOk } from "@/lib/email/verify";
import { enqueue } from "@/lib/send/outbox";

export const runtime = "nodejs";

function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const { personId, to, subject, body, scheduledAt } = (await req.json()) as {
    personId?: string;
    to?: string;
    subject?: string;
    body?: string;
    /** ISO string. When present the message is queued instead of sent now. */
    scheduledAt?: string;
  };

  if (!personId || !to || !subject?.trim() || !body?.trim()) {
    return fail("personId, to, subject and body are all required.");
  }
  if (!syntaxOk(to)) return fail(`"${to}" is not a valid address.`);
  if (!gmailConfigured()) {
    return fail(
      "Gmail is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local.",
    );
  }

  const profile = await getProfile();

  // Daily cap. Gmail permits 500 recipients/day but cold outreach above
  // ~25-50 damages deliverability, so the cap is enforced here, not advisory.
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

  // Don't email the same person twice by accident.
  const already = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sends WHERE person_id = ? AND status = 'sent'",
    [personId],
  );
  if (Number(already?.n ?? 0) > 0) {
    return fail("You already emailed this person.");
  }

  // Scheduled: queue it and return. The cron runner enforces the same cap.
  if (scheduledAt) {
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return fail("Invalid scheduled time.");
    if (when.getTime() < Date.now() - 60_000) {
      return fail("That time is in the past.");
    }
    if (!process.env.CRON_SECRET) {
      return fail(
        "Scheduling needs CRON_SECRET set and a cron job hitting /api/cron/send-due.",
      );
    }
    const id = await enqueue({ personId, to, subject, body, scheduledAt: when });
    return Response.json({ ok: true, scheduled: true, id, scheduledAt: when.toISOString() });
  }

  const draftId = newId("d");
  await run(
    "INSERT INTO drafts (id, person_id, subject, body, edited) VALUES (?,?,?,?,1)",
    [draftId, personId, subject, body],
  );

  const sendId = newId("snd");
  try {
    const { messageId } = await sendMail({
      to,
      subject,
      body,
      fromName: profile.full_name || undefined,
    });
    await run(
      `INSERT INTO sends (id, draft_id, person_id, to_address, subject, message_id, status)
       VALUES (?,?,?,?,?,?, 'sent')`,
      [sendId, draftId, personId, to, subject, messageId],
    );
    return Response.json({
      ok: true,
      messageId,
      sentToday: sentToday + 1,
      cap: profile.daily_send_cap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      `INSERT INTO sends (id, draft_id, person_id, to_address, subject, status, error)
       VALUES (?,?,?,?,?, 'error', ?)`,
      [sendId, draftId, personId, to, subject, message],
    );
    return fail(message, 502);
  }
}
