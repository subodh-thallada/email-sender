import { one } from "@/lib/db";
import { getProfile } from "@/lib/profile";
import { streamMessages, type ChatTurn } from "@/lib/ai/provider";
import { buildPrompt } from "@/lib/ai/write-email";
import { requireUser } from "@/lib/auth";
import type { Dossier } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM = `You revise one cold email in place, following the user's instruction.

Always reply with the complete revised email in exactly this shape, and nothing else:

Subject: <subject line>

<body>

No preamble, no explanation, no markdown code fence around it.

Rules:
- Apply only what was asked. Leave everything else as it was — do not rewrite untouched sentences.
- The body is markdown. Links use [text](url), emphasis uses **bold**. Keep it light: a cold email with heavy formatting reads as bulk mail.
- Never invent a fact about either person. If the instruction needs a URL or detail you were not given, leave a clear [placeholder] rather than making one up.
- No flattery openers, no filler transitions, no exclamation marks.`;

export async function POST(req: Request) {
  const denied = await requireUser();
  if (denied) return denied;

  const { personId, subject, body, instruction, history } =
    (await req.json()) as {
      personId?: string;
      subject?: string;
      body?: string;
      instruction?: string;
      history?: { role: "user" | "assistant"; content: string }[];
    };

  if (!personId || !instruction?.trim()) {
    return new Response("personId and instruction are required", { status: 400 });
  }

  const person = await one<{
    name: string;
    title: string | null;
    org: string | null;
    dossier: string | null;
  }>("SELECT name, title, org, dossier FROM people WHERE id = ?", [personId]);
  if (!person) return new Response("Unknown person", { status: 404 });

  let dossier: Dossier | null = null;
  try {
    dossier = person.dossier ? (JSON.parse(person.dossier) as Dossier) : null;
  } catch {
    dossier = null;
  }

  const profile = await getProfile();

  const messages: ChatTurn[] = [
    { role: "system", content: SYSTEM },
    {
      role: "system",
      content: `Context you may draw on:\n\n${buildPrompt(profile, {
        name: person.name,
        title: person.title,
        org: person.org,
      }, dossier)}`,
    },
    {
      role: "user",
      content: `Current draft:\n\nSubject: ${subject ?? ""}\n\n${body ?? ""}`,
    },
    // Prior turns so "shorter still" refers to something.
    ...(history ?? []).slice(-6),
    { role: "user", content: instruction },
  ];

  return new Response(streamMessages("chat", messages, 8000), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
