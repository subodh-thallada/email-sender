import { generateText, streamText } from "./provider";
import { withInstructions } from "./personalize";
import { linkList } from "../profile";
import type { Dossier, Profile } from "../types";

/** Rules that hold whoever is writing to whoever. */
const SHARED = `Output plain text in exactly this shape:

Subject: <subject line>

<body>

Nothing else — no preamble, no commentary, no markdown code fence.

Hard rules:
- Never invent a fact about either person. Use only what you are given. If you have nothing specific about them, say plainly what drew you to their area rather than fabricating a detail.
- No flattery openers: no "I hope this finds you well", "I was blown away", "your groundbreaking work", "I am reaching out to express my strong interest".
- No filler transitions ("Moreover", "Furthermore", "That said"). No rhetorical questions. No exclamation marks.
- Write plain declarative sentences. Don't lean on em dashes or tricolon lists.
- The subject line is 4-8 words, specific and factual. Not clickbait.
- End with the sender's signature exactly as provided, if provided.`;

const ACADEMIC = `You write one cold email from a student or early-career researcher to a specific academic.

${SHARED}

What makes these emails work:
- Open with the actual reason you are writing to THIS person. Name a specific paper, project, or lab of theirs and say something concrete about it — what it does, what problem it solves, how it connects to what the sender has done. One sentence of real substance beats a paragraph of admiration.
- Say who the sender is in one line, using the details in their profile. Concrete beats impressive: a named project or technology the sender actually worked on.
- Make one small, clear, easy-to-answer ask. "Are you taking students this summer?" is answerable. "I would love to discuss opportunities" is not.
- 120-160 words in the body. Academics skim.`;

const BUSINESS = `You write one cold outreach email from a freelancer or small business to a specific prospective client.

${SHARED}

What makes these emails work:
- Open with the actual reason you are writing to THIS company or person — something you can see about their business, site, role, or recent work — and connect it in one sentence to the problem the sender solves. Specific observation first, pitch second.
- State what the sender does in one line, in the recipient's terms: the outcome they get, not the sender's job title. Name a comparable client or a concrete result only if you were given one.
- Make one small, clear, easy-to-answer ask. "Worth a 15-minute call next week?" is answerable. "Let me know if you'd like to explore synergies" is not.
- 90-130 words in the body. A stranger selling something gets less patience than a student asking a question.
- Never claim to have used their product, visited their store, or spoken to them before unless you were told so.`;

/**
 * Which of the two the sender is. The memory profile decides: someone who has
 * described an offer and an audience is pitching a service, and the academic
 * framing would make them sound like a student asking for a lab position.
 */
export function isBusinessSender(profile: Profile): boolean {
  return profile.offer.trim().length > 15 && profile.audience.trim().length > 5;
}

/**
 * Added when the sender picked a template. It sits between the house style and
 * the user's own instructions: a saved template is a decision already made
 * about shape and length, so the word counts above stop applying — but it is
 * still not a licence to keep a sentence that is not true of this recipient.
 */
const TEMPLATE_RULE = `The sender has chosen a template, given below. Follow it:
- Keep its structure, its order, its length and its voice. Reuse its wording wherever the wording still fits.
- Its placeholders are already filled in for this recipient. Leave those values alone.
- Replace only what is generic or bracketed with something true about THIS recipient, drawn from the details you were given. If you have nothing specific, cut the sentence rather than padding it.
- Do not add sections, sign-offs or paragraphs the template does not have.
- Its length overrides the word count above.`;

/** A saved template, placeholders already resolved for this recipient. */
export interface DraftTemplate {
  name: string;
  subject: string;
  body: string;
  notes: string;
}

export function systemFor(
  profile: Profile,
  template: DraftTemplate | null = null,
): string {
  const base = isBusinessSender(profile) ? BUSINESS : ACADEMIC;
  return withInstructions(
    template ? `${base}\n\n${TEMPLATE_RULE}` : base,
    profile,
  );
}

export function buildPrompt(
  profile: Profile,
  person: { name: string; title: string | null; org: string | null },
  dossier: Dossier | null,
  template: DraftTemplate | null = null,
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

  const links = linkList(profile);

  return [
    "RECIPIENT",
    `Name: ${person.name}`,
    person.title ? `Title: ${person.title}` : "",
    person.org ? `Institution / company: ${person.org}` : "",
    theirWork,
    "",
    "SENDER",
    `Name: ${profile.full_name || "(not set)"}`,
    profile.headline ? `Headline: ${profile.headline}` : "",
    profile.offer ? `What they offer: ${profile.offer}` : "",
    profile.audience ? `Who they serve: ${profile.audience}` : "",
    profile.background ? `Background:\n${profile.background}` : "",
    profile.goal ? `What they want: ${profile.goal}` : "",
    links.length
      ? `Links they may cite (use verbatim, never invent one):\n${links
          .map((l) => `  - ${l}`)
          .join("\n")}`
      : "",
    `Tone: ${profile.tone}`,
    profile.signature ? `Signature:\n${profile.signature}` : "",
    // Last, so it is the freshest thing in the model's context when it starts
    // writing — this is the shape the output has to come out in.
    template
      ? [
          "",
          `TEMPLATE — "${template.name}"`,
          template.subject ? `Subject: ${template.subject}` : "",
          "Body:",
          template.body,
          template.notes ? `\nSender's notes on this template:\n${template.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Streams the raw `Subject: ...` line followed by a blank line and the body. */
export function streamEmail(
  profile: Profile,
  person: { name: string; title: string | null; org: string | null },
  dossier: Dossier | null,
  template: DraftTemplate | null = null,
): ReadableStream<Uint8Array> {
  return streamText({
    task: "write",
    system: systemFor(profile, template),
    user: buildPrompt(profile, person, dossier, template),
    maxTokens: 16000,
  });
}

export interface WrittenEmail {
  subject: string;
  body: string;
}

/**
 * Splits the model's `Subject: ...\n\n<body>` output.
 *
 * Tolerant on purpose: a model that forgets the blank line, or the label, is
 * still holding a usable email, and throwing it away over formatting would
 * lose a paid generation. Only a completely empty body is a failure.
 */
export function parseEmail(raw: string): WrittenEmail {
  const text = raw.trim().replace(/^```(?:\w+)?\s*|\s*```$/g, "");
  const match = text.match(/^\s*subject:\s*(.+?)\s*(?:\n|$)/i);

  if (!match) return { subject: "", body: text };

  return {
    subject: match[1].trim(),
    body: text.slice(match[0].length).replace(/^\s*\n/, "").trim(),
  };
}

/** One complete draft, written in a single non-streaming call. */
export async function writeEmail(
  profile: Profile,
  person: { name: string; title: string | null; org: string | null },
  dossier: Dossier | null,
  template: DraftTemplate | null = null,
): Promise<WrittenEmail> {
  const raw = await generateText({
    task: "write",
    system: systemFor(profile, template),
    user: buildPrompt(profile, person, dossier, template),
    maxTokens: 16000,
  });

  const parsed = parseEmail(raw);
  if (!parsed.body.trim()) throw new Error("The model returned an empty draft.");
  return parsed;
}
