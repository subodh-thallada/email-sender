import { syncReplies } from "@/lib/threads/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Pulls replies in from Gmail.
 *
 * Never returns an error status for "no read permission" — that is a normal,
 * expected state for an account connected before the read scope was asked for,
 * and the dashboard shows `reason` as a prompt to reconnect rather than as a
 * failure.
 */
export async function POST(req: Request) {
  const { threadId, limit } = (await req
    .json()
    .catch(() => ({}))) as { threadId?: string; limit?: number };

  const result = await syncReplies({
    threadId,
    limit: Number.isFinite(limit) ? Math.min(Number(limit), 200) : undefined,
  });
  return Response.json(result);
}
