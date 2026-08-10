import * as z from "zod";
import { generateObject } from "./provider";
import { fetchPage } from "../sources/fetch-page";
import type { ProfileDraft } from "../types";

/**
 * Turns a freeform description — plus, optionally, the sender's own website —
 * into the structured memory profile every later draft reads from.
 *
 * The point is that this runs once. Asking someone to fill in eight labelled
 * boxes before they have seen a single draft is where outreach tools lose
 * people; asking them to say what they do in their own words is not.
 */

const Schema = z.object({
  full_name: z
    .string()
    .describe("The sender's own name, or empty if never stated."),
  headline: z
    .string()
    .describe(
      "One line placing the sender: role plus company or institution. Empty if unclear.",
    ),
  offer: z
    .string()
    .describe(
      "What they sell or do, concretely, in one or two sentences. The thing a recipient would be buying.",
    ),
  audience: z
    .string()
    .describe(
      "Who they serve: the kind of person, role, or company worth writing to. Include industry and size when stated.",
    ),
  background: z
    .string()
    .describe(
      "Proof they can do it: named projects, clients, results, tools, credentials. This is what makes a draft specific, so keep every concrete detail given.",
    ),
  goal: z
    .string()
    .describe(
      "What they want out of an email — the ask. E.g. 'a 15-minute intro call about redesigning their store'.",
    ),
  tone: z
    .enum(["warm-professional", "concise-direct", "formal-academic", "casual"])
    .describe("Closest match to how they write. Default warm-professional."),
  links: z
    .array(z.string())
    .describe("Any URLs given or found: site, portfolio, case studies, LinkedIn."),
  signature: z
    .string()
    .describe("An email sign-off block if one can be assembled, else empty."),
});

const SYSTEM = `You turn a person's description of themselves and their business into a structured profile that a cold-email writer will use for every future email.

Rules:
- Use only what you are given. Never invent a client name, a metric, a credential, or a URL. An empty field is strictly better than a plausible guess — a fabricated detail will be sent to a stranger over this person's name.
- Keep concrete nouns exactly as written: company names, tools, numbers, job titles. Those are the only things that make a cold email specific.
- Summarise, don't embellish. No marketing adjectives the person didn't use themselves. If they said "I build Shopify stores", the offer is "builds Shopify stores", not "crafts bespoke commerce experiences".
- background is where detail belongs. Prefer keeping too much there over trimming it into something generic.
- If the description is mostly about a person rather than a business (a student, a researcher), fill offer/audience with what they are looking for and from whom, and put their experience in background.`;

export interface BuildProfileInput {
  /** What the user typed about themselves. */
  description: string;
  /** Optional site to read for extra context. */
  url?: string | null;
}

export async function buildProfile({
  description,
  url,
}: BuildProfileInput): Promise<ProfileDraft | null> {
  let site = "";

  if (url?.trim()) {
    // Their own site is the highest-value context available and costs one
    // fetch. A failure here is not worth failing the whole build over.
    const page = await fetchPage(normalizeUrl(url)).catch(() => null);
    if (page?.ok && page.text.length > 200) {
      site = [
        "",
        "THEIR WEBSITE",
        `URL: ${page.url}`,
        page.title ? `Title: ${page.title}` : "",
        page.text.slice(0, 8000),
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  const out = await generateObject(
    Schema,
    {
      task: "extract",
      system: SYSTEM,
      user: `WHAT THEY WROTE\n${description.trim()}${site}`,
      maxTokens: 4000,
    },
    "profile",
  );

  if (!out) return null;

  return {
    ...out,
    links: [...new Set(out.links.map((l) => l.trim()).filter(Boolean))],
  };
}

/** Accepts "acme.com" as readily as a full URL — nobody types the scheme. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
