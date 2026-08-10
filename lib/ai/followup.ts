import { streamText } from "./provider";
import { withInstructions } from "./personalize";
import { isBusinessSender } from "./write-email";
import { linkList } from "../profile";
import type { MessageView } from "../threads/types";
export { followupSubject } from "../threads/types";
import type { Profile } from "../types";

/**
 * The follow-up writer.
 *
 * Kept apart from write-email.ts because the job is different. A first email
 * has to earn attention from nothing; a follow-up already has a thread behind
 * it, and its main failure mode is repeating that thread back at the reader.
 * The subject is not generated at all — a follow-up belongs in the existing
 * conversation, and Gmail only files it there when the subject matches.
 */

const NUDGE = `You write one short follow-up to a cold email that got no reply.

Rules:
- Under 70 words. A follow-up that is longer than the email it follows reads as pestering.
- Do not restate the original email. Assume it was read. Add one new thing: a concrete reason the ask still stands, a recent development, or a smaller version of the original ask.
- No guilt and no passive aggression. Never write "just following up", "bumping this", "I know you're busy", "circling back", "in case this got buried", or "did you see my last email".
- One clear ask, easier to answer than the original. A yes/no question is ideal.
- Never imply they were rude not to reply. Silence is normal.
- No flattery, no exclamation marks, no rhetorical questions.
- Open with substance, not with an apology for writing again.`;

const REPLY = `You write one reply to a message someone sent back.

Rules:
- Answer what they actually said, first and directly. If they asked a question, the answer is the first sentence.
- Under 120 words. Match their register: a two-line reply gets a two-line reply, not three paragraphs.
- If they said no, accept it gracefully in one sentence and stop. Do not argue, do not re-pitch, do not ask them to reconsider.
- If they asked for something concrete, say plainly whether the sender can provide it and by when.
- No flattery openers, no "thank you so much for taking the time", no exclamation marks.
- One next step at most, and only if they invited one.`;

const SHARED = `Output the body of the email and nothing else. No subject line, no preamble, no commentary, no markdown code fence.

Never invent a fact about either person. Use only what you are given.
Write plain declarative sentences. Don't lean on em dashes or tricolon lists.
End with the sender's signature exactly as provided, if provided.`;

/** Whether anyone has written back yet decides which of the two prompts runs. */
export function followupMode(messages: MessageView[]): "nudge" | "reply" {
  return messages.some((m) => m.direction === "incoming") ? "reply" : "nudge";
}

export function systemFor(profile: Profile, mode: "nudge" | "reply"): string {
  const base = mode === "reply" ? REPLY : NUDGE;
  const business = isBusinessSender(profile)
    ? "\nThe sender is pitching a service, not asking for a research position."
    : "\nThe sender is a student or early-career researcher, not a salesperson.";
  return withInstructions(`${base}\n\n${SHARED}${business}`, profile);
}

/** Days between two 'YYYY-MM-DD HH:MM:SS' stamps, for "you wrote 9 days ago". */
export function daysBetween(from: string, to: Date = new Date()): number {
  const then = Date.parse(`${from.replace(" ", "T")}Z`);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((to.getTime() - then) / 86_400_000));
}

export function buildPrompt(input: {
  profile: Profile;
  contactName: string | null;
  contactEmail: string;
  messages: MessageView[];
  /** Free-text steer from the user, e.g. "offer to send the code instead". */
  intent?: string;
}): string {
  const { profile, messages } = input;
  const links = linkList(profile);

  // Oldest first, and capped: the model needs the shape of the exchange, not
  // every word of a long one, and a runaway thread would dominate the prompt.
  const transcript = messages
    .slice(-6)
    .map((m) => {
      const who = m.direction === "outgoing" ? "SENDER WROTE" : "THEY REPLIED";
      const ago = daysBetween(m.sentAt);
      const when = ago === 0 ? "today" : `${ago} day${ago === 1 ? "" : "s"} ago`;
      return `${who} (${when}):\n${m.text.trim().slice(0, 2000)}`;
    })
    .join("\n\n---\n\n");

  return [
    "RECIPIENT",
    `Name: ${input.contactName ?? input.contactEmail}`,
    `Address: ${input.contactEmail}`,
    "",
    "THE CONVERSATION SO FAR",
    transcript || "(no messages recorded)",
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
    input.intent?.trim()
      ? `\nWHAT THIS FOLLOW-UP MUST DO — follow this over any default:\n${input.intent.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Streams the body text only. The subject is `Re: <original>`, set by the caller. */
export function streamFollowup(input: {
  profile: Profile;
  contactName: string | null;
  contactEmail: string;
  messages: MessageView[];
  intent?: string;
}): ReadableStream<Uint8Array> {
  return streamText({
    task: "write",
    system: systemFor(input.profile, followupMode(input.messages)),
    user: buildPrompt(input),
    maxTokens: 8000,
  });
}
