import { cached, DAY } from "../cache";
import type { Paper } from "../types";

const BASE = "https://api.openalex.org";

/** OpenAlex ids come back as full URLs; filters read nicer with the short form. */
export function shortId(url: string | null | undefined): string {
  if (!url) return "";
  return url.split("/").pop() ?? "";
}

function mailto(): string {
  return process.env.OPENALEX_MAILTO ?? "";
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params);
  const m = mailto();
  if (m) qs.set("mailto", m);
  const url = `${BASE}${path}?${qs.toString()}`;

  return cached<T>(`openalex:${url}`, 7 * DAY, async () => {
    const res = await fetch(url, {
      headers: {
        // OpenAlex asks for a contactable UA to keep you in the polite pool.
        "User-Agent": `email-agent/0.1 (${m || "no-contact-provided"})`,
      },
    });
    if (!res.ok) {
      throw new Error(`OpenAlex ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  });
}

interface ListResponse<T> {
  meta: { count: number };
  results: T[];
}

export interface Institution {
  id: string;
  ror: string | null;
  display_name: string;
  country_code: string | null;
  works_count: number;
  /** e.g. "https://www.utoronto.ca" — the basis for the institution's mail domain. */
  homepage_url: string | null;
}

export async function resolveInstitution(
  name: string,
): Promise<Institution | null> {
  const data = await get<ListResponse<Institution>>("/institutions", {
    search: name,
    per_page: "5",
  });
  return data.results[0] ?? null;
}

export interface Topic {
  id: string;
  display_name: string;
  works_count: number;
}

/** Map free-text research terms to OpenAlex topic ids. */
export async function resolveTopics(
  terms: string[],
  perTerm = 4,
): Promise<Topic[]> {
  const found = new Map<string, Topic>();
  for (const term of terms) {
    const data = await get<ListResponse<Topic>>("/topics", {
      search: term,
      per_page: String(perTerm),
    });
    for (const t of data.results) found.set(t.id, t);
  }
  return [...found.values()];
}

export interface OpenAlexAuthor {
  id: string;
  display_name: string;
  orcid: string | null;
  works_count: number;
  cited_by_count: number;
  last_known_institutions: {
    id: string;
    display_name: string;
    country_code: string | null;
    type: string;
  }[];
  affiliations: {
    institution: { id: string; display_name: string };
    years: number[];
  }[];
  topics: { id: string; display_name: string; count: number }[];
  summary_stats?: { h_index?: number };
}

export async function searchAuthors(opts: {
  institutionId?: string | null;
  topicIds?: string[];
  nameSearch?: string | null;
  perPage?: number;
}): Promise<OpenAlexAuthor[]> {
  const filters: string[] = [];
  if (opts.institutionId) {
    filters.push(`last_known_institutions.id:${shortId(opts.institutionId)}`);
  }
  if (opts.topicIds?.length) {
    filters.push(`topics.id:${opts.topicIds.map(shortId).join("|")}`);
  }
  if (!filters.length) return [];

  const params: Record<string, string> = {
    filter: filters.join(","),
    sort: "cited_by_count:desc",
    per_page: String(opts.perPage ?? 50),
  };
  if (opts.nameSearch) params.search = opts.nameSearch;

  const data = await get<ListResponse<OpenAlexAuthor>>("/authors", params);
  return data.results;
}

interface Work {
  id: string;
  display_name: string;
  publication_year: number | null;
  cited_by_count: number;
  doi: string | null;
  primary_location: { source: { display_name: string } | null } | null;
}

/** Recent, well-cited work — the hooks a cold email actually needs. */
export async function authorPapers(
  authorId: string,
  limit = 5,
): Promise<Paper[]> {
  const data = await get<ListResponse<Work>>("/works", {
    filter: `authorships.author.id:${shortId(authorId)}`,
    sort: "publication_date:desc",
    per_page: String(Math.max(limit * 3, 15)),
    select:
      "id,display_name,publication_year,cited_by_count,doi,primary_location",
  });

  return data.results
    .filter((w) => w.display_name)
    .sort((a, b) => {
      const ya = a.publication_year ?? 0;
      const yb = b.publication_year ?? 0;
      if (yb !== ya) return yb - ya;
      return b.cited_by_count - a.cited_by_count;
    })
    .slice(0, limit)
    .map((w) => ({
      title: w.display_name,
      year: w.publication_year,
      venue: w.primary_location?.source?.display_name ?? null,
      citations: w.cited_by_count,
      url: w.doi ?? w.id,
    }));
}
