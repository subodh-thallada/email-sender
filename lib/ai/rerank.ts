import * as z from "zod";
import { generateObject } from "./provider";
import type { Candidate, ParsedQuery } from "../types";

const Schema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      keep: z.boolean(),
      score: z.number().describe("Relevance 0..1."),
      title: z
        .string()
        .nullable()
        .describe(
          "Best guess at their academic rank if inferable, e.g. 'Professor', 'Associate Professor', else null.",
        ),
      reason: z.string().describe("Under 12 words."),
    }),
  ),
});

const SYSTEM = `You filter a candidate list from a bibliographic database down to the people the user actually asked for.

Drop a candidate when:
- Their affiliation does not match the requested institution (the database's "last known institution" is often stale or wrong).
- They are clearly not the requested seniority — e.g. the user asked for professors and the publication record looks like a graduate student or postdoc (few works, all very recent, no sustained output).
- Their research does not actually overlap the requested topics; a single incidental paper is not enough.

Keep a candidate when their record plausibly matches, even if some fields are missing. Prefer recall on genuine borderline cases, but be decisive about the two failure modes above — they are the common ones.

Score by how central the requested topics are to their overall body of work, not by raw citation count.`;

export async function rerank(
  intent: ParsedQuery,
  candidates: Candidate[],
): Promise<Candidate[]> {
  if (candidates.length === 0) return [];

  const compact = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    institution: c.org,
    works: c.worksCount,
    citations: c.citedBy,
    topics: c.topics.slice(0, 8),
    recentPaperYears: c.recentPapers.map((p) => p.year).filter(Boolean),
  }));

  const user = [
    `User asked for: ${JSON.stringify({
      institutions: intent.institutions,
      topics: intent.topics,
      titles: intent.titles,
      location: intent.location,
    })}`,
    "",
    "Candidates:",
    JSON.stringify(compact, null, 1),
  ].join("\n");

  const out = await generateObject(
    Schema,
    { task: "rerank", system: SYSTEM, user, maxTokens: 16000 },
    "rerank_results",
  );

  const verdicts = new Map((out?.results ?? []).map((r) => [r.id, r]));

  return candidates
    .map((c) => {
      const v = verdicts.get(c.id);
      return {
        ...c,
        score: v?.score ?? 0,
        title: v?.title ?? c.title,
        _keep: v ? v.keep : true,
      };
    })
    .filter((c) => c._keep)
    .sort((a, b) => b.score - a.score)
    .map(({ _keep, ...c }) => c as Candidate);
}
