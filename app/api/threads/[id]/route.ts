import { getThreadDetail } from "@/lib/threads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The full conversation for one thread, fetched when a row is expanded.
 *
 * Kept out of the list payload on purpose: message bodies are the bulk of the
 * data and the collapsed list shows one line of each.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = await getThreadDetail(id);
  if (!detail) {
    return Response.json({ ok: false, error: "Unknown thread." }, { status: 404 });
  }
  return Response.json({ ok: true, ...detail });
}
