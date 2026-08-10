import { createHash } from "node:crypto";
import * as z from "zod";
import { generateObject } from "./provider";
import { withInstructions } from "./personalize";
import { getProfile } from "../profile";
import { resolveTask } from "../settings";
import { cached, DAY } from "../cache";
import type { ParsedQuery } from "../types";

const Schema = z.object({
  route: z
    .enum(["academic", "corporate", "alumni"])
    .describe(
      "academic: university researchers/faculty. corporate: people currently at a company by role/title. alumni: people defined by a PAST school or employer.",
    ),
  institutions: z
    .array(z.string())
    .describe("Universities or research institutions, full official names."),
  topics: z
    .array(z.string())
    .describe(
      "Research areas or fields, as short canonical phrases like 'robotics', 'computer vision'.",
    ),
  titles: z
    .array(z.string())
    .describe("Job titles or seniority terms mentioned, e.g. 'professor'."),
  companies: z.array(z.string()).describe("Current employers named."),
  pastEmployers: z
    .array(z.string())
    .describe("Past employers or schools used as a filter."),
  location: z.string().nullable().describe("City, region, or country, or null."),
  limit: z
    .number()
    .int()
    .describe("How many people to return. Default 20 if unspecified."),
  rationale: z.string().describe("One sentence on how you read the query."),
});

const SYSTEM = `You convert a natural-language people-search query into structured filters.

Rules:
- Pick exactly one route. If the query names a university and a research area, it is "academic". If it filters on where someone USED to work or study, it is "alumni". Otherwise, if it names a current company, it is "corporate".
- Expand institution abbreviations to official names ("UofT" -> "University of Toronto", "McMaster" -> "McMaster University").
- Split compound research areas into separate canonical topics ("robotics and computer vision" -> ["robotics", "computer vision"]).
- Leave arrays empty rather than inventing values.
- limit defaults to 20 unless the user asks for a specific number.`;

export async function parseQuery(query: string): Promise<ParsedQuery> {
  const { model } = await resolveTask("parse");
  const profile = await getProfile();
  const system = withInstructions(SYSTEM, profile);

  // The instructions are part of the prompt, so they are part of the cache
  // identity. Without this, editing "focus on Canada" in Settings would leave
  // every previously-run query resolving to its pre-edit filters for 30 days.
  const fingerprint = createHash("sha256")
    .update(profile.instructions.trim())
    .digest("hex")
    .slice(0, 12);

  const key = `parse:${model}:${fingerprint}:${query}`;
  return cached<ParsedQuery>(key, 30 * DAY, async () => {
    const parsed = await generateObject(
      Schema,
      { task: "parse", system, user: query, maxTokens: 4000 },
      "search_intent",
    );
    if (!parsed) {
      throw new Error("Could not understand that query — try rephrasing it.");
    }
    return { ...parsed, limit: Math.min(Math.max(parsed.limit || 20, 1), 50) };
  });
}
