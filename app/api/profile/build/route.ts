import { buildProfile } from "@/lib/ai/build-profile";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Turns a freeform description of the user's business into structured profile
 * fields.
 *
 * Deliberately does not save. The user reviews what the model inferred before
 * it becomes the basis of every future email — an extraction that quietly
 * wrote itself into the profile would put invented claims in front of
 * strangers under the user's name.
 */
export async function POST(req: Request) {
  const denied = await requireUser();
  if (denied) return denied;

  const { description, url } = (await req.json()) as {
    description?: string;
    url?: string;
  };

  if (!description?.trim() || description.trim().length < 20) {
    return Response.json(
      {
        ok: false,
        error:
          "Write a couple of sentences about what you do and who you do it for.",
      },
      { status: 400 },
    );
  }

  try {
    const draft = await buildProfile({ description, url });
    if (!draft) {
      return Response.json(
        { ok: false, error: "Could not read that — try describing it differently." },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, profile: draft });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
