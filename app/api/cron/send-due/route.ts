import { flushDue } from "@/lib/send/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sends everything in the outbox whose scheduled time has passed.
 *
 * Guarded by CRON_SECRET — this endpoint sends real email, so an unguarded
 * public URL would let anyone drain your daily quota. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; a `?secret=` query param is accepted
 * for external schedulers that cannot set headers.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not set; scheduled sending is disabled." },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await flushDue();
  return Response.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
