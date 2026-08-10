import { one } from "@/lib/db";
import { getProfile, profileIsUsable } from "@/lib/profile";
import { getTemplate } from "@/lib/templates";
import { fillFor, senderVars, templateVars } from "@/lib/template-fill";
import { streamEmail, type DraftTemplate } from "@/lib/ai/write-email";
import type { Dossier } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { personId, templateId } = (await req.json()) as {
    personId?: string;
    templateId?: string;
  };
  if (!personId) return new Response("Missing personId", { status: 400 });

  const person = await one<{
    name: string;
    title: string | null;
    org: string | null;
    dept: string | null;
    dossier: string | null;
  }>("SELECT name, title, org, dept, dossier FROM people WHERE id = ?", [
    personId,
  ]);

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

  // Placeholders are resolved here rather than left for the model: it is the
  // one part of a template that has a single correct answer, and asking a
  // model to do it is how {{first_name}} ends up in someone's inbox.
  let template: DraftTemplate | null = null;
  if (templateId) {
    const saved = await getTemplate(templateId);
    if (saved) {
      // Same address the card shows first, so a template using {{email}} reads
      // identically whether it was applied by hand or written by the model.
      const addr = await one<{ address: string }>(
        "SELECT address FROM emails WHERE person_id = ? ORDER BY created_at LIMIT 1",
        [personId],
      );
      const filled = fillFor(
        saved,
        templateVars(
          { ...person, email: addr?.address ?? null },
          senderVars(profile),
        ),
      );
      template = { name: saved.name, notes: saved.notes, ...filled };
    }
  }

  return new Response(
    streamEmail(
      profile,
      { name: person.name, title: person.title, org: person.org },
      dossier,
      template,
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
