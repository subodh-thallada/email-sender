import { getProfile, profileIsUsable } from "@/lib/profile";
import { streamFollowup } from "@/lib/ai/followup";
import { getThreadDetail } from "@/lib/threads/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { threadId, intent } = (await req.json()) as {
    threadId?: string;
    intent?: string;
  };
  if (!threadId) return new Response("Missing threadId", { status: 400 });

  const detail = await getThreadDetail(threadId);
  if (!detail) return new Response("Unknown thread", { status: 404 });
  if (!detail.messages.length) {
    return new Response(
      "There is nothing in this conversation to follow up on yet.",
      { status: 400 },
    );
  }

  const profile = await getProfile();
  if (!profileIsUsable(profile)) {
    return new Response(
      "Fill in your name and background on the Settings page first — without them the follow-up has nothing real to work with.",
      { status: 400 },
    );
  }

  return new Response(
    streamFollowup({
      profile,
      contactName: detail.thread.contactName,
      contactEmail: detail.thread.contactEmail,
      messages: detail.messages,
      intent,
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
