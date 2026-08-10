import { streamText } from "./provider";
import type { Dossier, Profile } from "../types";

const SYSTEM = `You write one cold email from a student or early-career researcher to a specific academic. Output plain text in exactly this shape:

Subject: <subject line>

<body>

Nothing else — no preamble, no commentary, no markdown.

What makes these emails work:
- Open with the actual reason you are writing to THIS person. Name a specific paper, project, or lab of theirs and say something concrete about it — what it does, what problem it solves, how it connects to what the sender has done. One sentence of real substance beats a paragraph of admiration.
- Say who the sender is in one line, using the details in their profile. Concrete beats impressive: a named project or technology the sender actually worked on.
- Make one small, clear, easy-to-answer ask. "Are you taking students this summer?" is answerable. "I would love to discuss opportunities" is not.
- 120-160 words in the body. Academics skim.

Hard rules:
- Never invent a fact about either person. Use only what you are given. If you have nothing specific about their work, say plainly that you follow the lab's area rather than fabricating a paper.
- No flattery openers: no "I hope this finds you well", "I was blown away", "your groundbreaking work", "I am reaching out to express my strong interest".
- No filler transitions ("Moreover", "Furthermore", "That said"). No rhetorical questions. No exclamation marks.
- Write plain declarative sentences. Don't lean on em dashes or tricolon lists.
- The subject line is 4-8 words, specific and factual. Not clickbait, not just "Research opportunity".
- End with the sender's signature exactly as provided, if provided.`;

export function buildPrompt(
  profile: Profile,
  person: { name: string; title: string | null; org: string | null },
  dossier: Dossier | null,
): string {
  const theirWork = dossier
    ? [
        dossier.lab ? `Lab: ${dossier.lab}` : null,
        dossier.researchAreas.length
          ? `Research areas: ${dossier.researchAreas.join(", ")}`
          : null,
        dossier.papers.length
          ? `Recent papers:\n${dossier.papers
              .slice(0, 4)
              .map((p) => `  - ${p.year ?? "n.d."}: ${p.title}`)
              .join("\n")}`
          : null,
        dossier.notes.length
          ? `Specific notes:\n${dossier.notes.map((n) => `  - ${n}`).join("\n")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "(no details found)";

  return [
    "RECIPIENT",
    `Name: ${person.name}`,
    person.title ? `Title: ${person.title}` : "",
    person.org ? `Institution: ${person.org}` : "",
    theirWork,
    "",
    "SENDER",
    `Name: ${profile.full_name || "(not set)"}`,
    profile.headline ? `Headline: ${profile.headline}` : "",
    profile.background ? `Background:\n${profile.background}` : "",
    profile.goal ? `What they want: ${profile.goal}` : "",
    `Tone: ${profile.tone}`,
    profile.signature ? `Signature:\n${profile.signature}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Streams the raw `Subject: ...` line followed by a blank line and the body. */
export function streamEmail(
  profile: Profile,
  person: { name: string; title: string | null; org: string | null },
  dossier: Dossier | null,
): ReadableStream<Uint8Array> {
  return streamText({
    task: "write",
    system: SYSTEM,
    user: buildPrompt(profile, person, dossier),
    maxTokens: 16000,
  });
}
