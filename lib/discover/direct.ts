import * as z from "zod";
import { generateObject } from "../ai/provider";
import { extractEmailsTrusted } from "../email/deobfuscate";
import { verifyAddress } from "../email/verify";
import { splitName } from "../email/patterns";
import type { Candidate, Dossier, FoundEmail } from "../types";

/**
 * When the query already contains addresses, there is nothing to search for.
 * No OpenAlex, no Serper, no page fetches — one cheap call to pull the
 * name/org/context apart, and that is the whole pipeline.
 */

const Schema = z.object({
  recipients: z.array(
    z.object({
      email: z.string().describe("The address exactly as it should be sent to."),
      name: z
        .string()
        .describe(
          "Their name if the text gives one. If not, derive a plausible display name from the local part, e.g. 'j.doe@' -> 'J. Doe'.",
        ),
      title: z.string().nullable(),
      org: z.string().nullable(),
      notes: z
        .array(z.string())
        .describe(
          "Anything the user said about this person that a cold email could reference. Empty if they said nothing.",
        ),
    }),
  ),
});

const SYSTEM = `The user pasted text containing one or more email addresses of people they want to contact.

Extract one entry per address. Use only what the text says — never invent an employer, title, or fact about them. If the text says nothing beyond the address, return an empty notes array and null for title and org.

De-obfuscate addresses into normal form: "jane [at] mit.edu" is jane@mit.edu.`;

/** Addresses present in the raw query, de-obfuscated. Empty if none. */
export function addressesInText(text: string): string[] {
  return extractEmailsTrusted(text);
}

export async function discoverDirect(
  query: string,
  onStatus: (msg: string) => void,
): Promise<{ candidate: Candidate; dossier: Dossier; emails: FoundEmail[] }[]> {
  onStatus("Address supplied — skipping search");

  // Best effort. If there is no LLM key, or the call fails, the bare addresses
  // below are still a complete answer — the user already told us who to email.
  const parsed = await generateObject(
    Schema,
    { task: "parse", system: SYSTEM, user: query, maxTokens: 4000 },
    "recipients",
  ).catch(() => null);

  const entries =
    parsed?.recipients?.length
      ? parsed.recipients
      : addressesInText(query).map((email) => ({
          email,
          name: displayNameFrom(email),
          title: null,
          org: null,
          notes: [] as string[],
        }));

  const out = [];
  for (const r of entries) {
    const address = r.email.trim().toLowerCase();
    const v = await verifyAddress(address);

    const dossier: Dossier = {
      title: r.title,
      dept: null,
      lab: null,
      researchAreas: [],
      papers: [],
      homepage: null,
      location: null,
      notes: r.notes ?? [],
      sources: [],
    };

    const candidate: Candidate = {
      id: address,
      name: r.name || displayNameFrom(address),
      title: r.title,
      org: r.org,
      orgDomain: address.split("@")[1] ?? null,
      dept: null,
      location: null,
      homepage: null,
      openalexId: null,
      orcid: null,
      worksCount: null,
      citedBy: null,
      topics: [],
      recentPapers: [],
      score: 1,
    };

    const emails: FoundEmail[] = [
      {
        address,
        source: "provided",
        // You typed it, so it is as good as the page-scraped tier. MX still
        // has to pass — a typo'd domain is worth catching before sending.
        confidence: v.mxOk ? "high" : "unknown",
        mxOk: v.mxOk,
        evidence: v.mxOk ? "supplied in your query" : (v.reason ?? "unverified"),
      },
    ];

    out.push({ candidate, dossier, emails });
  }
  return out;
}

function displayNameFrom(address: string): string {
  const local = address.split("@")[0] ?? "";
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const guess = words.join(" ");
  return splitName(guess) ? guess : guess || address;
}
