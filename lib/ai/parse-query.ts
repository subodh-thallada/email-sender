import * as z from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client";
import { MODELS } from "./models";
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
  return cached<ParsedQuery>(`parse:${MODELS.PARSE}:${query}`, 30 * DAY, async () => {
    const res = await anthropic().messages.parse({
      model: MODELS.PARSE,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: zodOutputFormat(Schema),
      },
      messages: [{ role: "user", content: query }],
    });

    const parsed = res.parsed_output;
    if (!parsed) {
      throw new Error("Could not understand that query — try rephrasing it.");
    }
    return {
      ...parsed,
      limit: Math.min(Math.max(parsed.limit || 20, 1), 50),
    };
  });
}
