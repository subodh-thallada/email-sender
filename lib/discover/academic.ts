import pLimit from "p-limit";
import {
  authorPapers,
  resolveInstitution,
  resolveTopics,
  searchAuthors,
  shortId,
  type OpenAlexAuthor,
} from "../sources/openalex";
import { registrableDomain } from "../email/discover";
import { resolveDepth } from "../settings";
import type { Candidate, ParsedQuery } from "../types";

/**
 * Academic discovery. OpenAlex is free and has real coverage here, so this is
 * the strongest route in the app.
 *
 * Two known weaknesses of the raw data, both handled downstream by rerank():
 *   - `last_known_institutions` can be stale (people who moved).
 *   - Prolific grad students rank alongside faculty.
 */
export async function discoverAcademic(
  intent: ParsedQuery,
  onStatus: (msg: string) => void,
): Promise<Candidate[]> {
  const instName = intent.institutions[0];
  if (!instName) {
    throw new Error(
      "No institution recognised in that query. Try naming a university.",
    );
  }

  onStatus(`Resolving ${instName}…`);
  const institution = await resolveInstitution(instName);
  if (!institution) {
    throw new Error(`Could not find an institution matching "${instName}".`);
  }

  onStatus(`Matching research topics…`);
  const topics = intent.topics.length ? await resolveTopics(intent.topics) : [];
  if (topics.length === 0) {
    throw new Error(
      "No research topic recognised in that query. Try naming a field, e.g. 'robotics'.",
    );
  }

  onStatus(`Searching OpenAlex for ${institution.display_name}…`);
  // Over-fetch: rerank will discard stale affiliations and grad students. How
  // far to over-fetch is the depth dial — OpenAlex is free, so a deeper tier
  // costs only the rerank tokens spent judging the extra candidates.
  const { candidateMultiplier } = await resolveDepth();
  const authors = await searchAuthors({
    institutionId: institution.id,
    topicIds: topics.map((t) => t.id),
    perPage: Math.min(
      Math.max(intent.limit * (candidateMultiplier + 1), 40),
      100,
    ),
  });

  const topicIds = new Set(topics.map((t) => shortId(t.id)));
  const ranked = authors
    .map((a) => ({ author: a, fit: topicFit(a, topicIds) }))
    .sort((x, y) => y.fit - x.fit)
    .slice(0, Math.min(intent.limit * candidateMultiplier, 60));

  onStatus(`Pulling recent publications for ${ranked.length} researchers…`);
  const orgDomain = domainFromUrl(institution.homepage_url);
  const limit = pLimit(5);
  return Promise.all(
    ranked.map(({ author, fit }) =>
      limit(async () =>
        toCandidate(author, institution.display_name, orgDomain, fit),
      ),
    ),
  );
}

/**
 * The institution's own domain. Without this, a lab site that only exposes a
 * bare `mailto:surname` would have its address inferred against the lab's
 * domain (dynsyslab.org) rather than the university's (utoronto.ca).
 */
function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return registrableDomain(new URL(url).host);
  } catch {
    return null;
  }
}

/** Share of the author's topical output that sits in the requested topics. */
function topicFit(a: OpenAlexAuthor, topicIds: Set<string>): number {
  const total = a.topics.reduce((s, t) => s + t.count, 0);
  if (!total) return 0;
  const hit = a.topics
    .filter((t) => topicIds.has(shortId(t.id)))
    .reduce((s, t) => s + t.count, 0);
  return hit / total;
}

async function toCandidate(
  a: OpenAlexAuthor,
  fallbackOrg: string,
  orgDomain: string | null,
  fit: number,
): Promise<Candidate> {
  const papers = await authorPapers(a.id, 5).catch(() => []);
  return {
    id: shortId(a.id),
    name: a.display_name,
    title: null,
    org: a.last_known_institutions[0]?.display_name ?? fallbackOrg,
    orgDomain,
    dept: null,
    location: a.last_known_institutions[0]?.country_code ?? null,
    homepage: null,
    openalexId: a.id,
    orcid: a.orcid,
    worksCount: a.works_count,
    citedBy: a.cited_by_count,
    topics: a.topics.slice(0, 8).map((t) => t.display_name),
    recentPapers: papers,
    score: fit,
  };
}
