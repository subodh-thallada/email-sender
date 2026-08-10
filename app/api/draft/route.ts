import { one } from "@/lib/db";
import { getProfile, profileIsUsable } from "@/lib/profile";
import { streamEmail } from "@/lib/ai/write-email";
import type { Dossier } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { personId } = (await req.json()) as { personId?: string };
  if (!personId) return new Response("Missing personId", { status: 400 });

  const person = await one<{
    name: string;
    title: string | null;
    org: string | null;
    dossier: string | null;
  }>("SELECT name, title, org, dossier FROM people WHERE id = ?", [personId]);

  if (!person) return new Response("Unknown person", { status: 404 });

  const profile = await getProfile();
  if (!profileIsUsable(profile)) {
    return new Response(
      "Fill in your name and background on the Settings page first — without them the draft has nothing real to work with.",
      { status: 400 },
    );
  }

  let dossier: Dossier | null = null;
  if (person.dossier) {
    try {
      dossier = JSON.parse(person.dossier) as Dossier;
    } catch {
      dossier = null;
    }
  }

  return new Response(
    streamEmail(
      profile,
      { name: person.name, title: person.title, org: person.org },
      dossier,
    ),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
