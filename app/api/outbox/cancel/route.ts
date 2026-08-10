import { cancel } from "@/lib/send/outbox";

export const runtime = "nodejs";

/** Cancels a queued message. Only pending rows move; anything already sent is
 *  left alone by the underlying UPDATE, so a late click cannot unsend. */
export async function POST(req: Request) {
  const { id } = (await req.json()) as { id?: string };
  if (!id) {
    return Response.json({ ok: false, error: "An id is required." }, { status: 400 });
  }
  await cancel(id);
  return Response.json({ ok: true });
}
