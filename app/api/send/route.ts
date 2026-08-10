import { newId, one, run, todayStamp } from "@/lib/db";
import { getProfile } from "@/lib/profile";
import { sendMail } from "@/lib/send/gmail";
import { syntaxOk } from "@/lib/email/verify";
import { enqueue } from "@/lib/send/outbox";
import { defaultAccount, sendingConfigured } from "@/lib/google/accounts";
import { trackingFor } from "@/lib/send/tracking";
import { describeSlot, nextPeakSlot, readOffset } from "@/lib/send/peak";

export const runtime = "nodejs";

function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const { personId, to, subject, body, scheduledAt, mode, tzOffsetMinutes } =
    (await req.json()) as {
      personId?: string;
      to?: string;
      subject?: string;
      body?: string;
      /** ISO string. When present the message is queued instead of sent now. */
      scheduledAt?: string;
      /** "peak" asks the server to choose the time. */
      mode?: "now" | "at" | "peak";
      /** Browser's UTC offset in minutes, for the peak-time calculation. */
      tzOffsetMinutes?: number;
    };

  if (!personId || !to || !subject?.trim() || !body?.trim()) {
    return fail("personId, to, subject and body are all required.");
  }
  if (!syntaxOk(to)) return fail(`"${to}" is not a valid address.`);
  if (!sendingConfigured()) {
    return fail(
      "Sending is not set up. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.",
    );
  }

  const account = await defaultAccount();
  if (!account) {
    return fail("No Gmail account is connected. Connect one in Settings.");
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

  // Peak mode has the server pick the time; "at" uses the one supplied.
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
    if (when.getTime() < Date.now() - 60_000) {
      return fail("That time is in the past.");
    }
  }

  // Scheduled: queue it and return. The cron runner enforces the same cap and
  // mints the tracking token at flush time, since the body it sends is built
  // there rather than here.
  if (when) {
    if (!process.env.CRON_SECRET) {
      return fail(
        "Scheduling needs CRON_SECRET set and a cron job hitting /api/cron/send-due.",
      );
    }
    const id = await enqueue({
      personId,
      from: account.email,
      to,
      subject,
      body,
      scheduledAt: when,
    });
    return Response.json({
      ok: true,
      scheduled: true,
      id,
      from: account.email,
      scheduledAt: when.toISOString(),
      when: offset === null ? null : describeSlot(when, offset),
    });
  }

  const draftId = newId("d");
  await run(
    "INSERT INTO drafts (id, person_id, subject, body, edited) VALUES (?,?,?,?,1)",
    [draftId, personId, subject, body],
  );

  const sendId = newId("snd");
  // Minted before the send, because the token has to be inside the message.
  const tracking = await trackingFor();

  try {
    const { messageId } = await sendMail({
      from: account.email,
      to,
      subject,
      body,
      fromName: profile.full_name || undefined,
      pixelUrl: tracking?.url,
    });
    await run(
      `INSERT INTO sends (id, draft_id, person_id, to_address, subject, message_id, status, track_token)
       VALUES (?,?,?,?,?,?, 'sent', ?)`,
      [sendId, draftId, personId, to, subject, messageId, tracking?.token ?? null],
    );
    return Response.json({
      ok: true,
      messageId,
      tracked: Boolean(tracking),
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
