import { cached, DAY } from "../cache";

export interface SearchHit {
  title: string;
  link: string;
  snippet: string;
}

/**
 * Google results via Serper (2,500 free/month). Every call is cached for 14
 * days — the free tier is the app's real throughput ceiling, so a repeated
 * search must not spend it again.
 */
export async function googleSearch(
  query: string,
  num = 6,
): Promise<SearchHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];

  return cached<SearchHit[]>(`serper:${num}:${query}`, 14 * DAY, async () => {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Serper quota exhausted for this month.");
      }
      throw new Error(`Serper ${res.status}`);
    }
    const data = (await res.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
    };
    return (data.organic ?? [])
      .filter((r): r is { link: string } & typeof r => Boolean(r.link))
      .map((r) => ({
        title: r.title ?? "",
        link: r.link,
        snippet: r.snippet ?? "",
      }));
  });
}

/**
 * Rank a person's likely homepage above directory/aggregator noise.
 * ResearchGate/Academia.edu pages are scrapeable but rarely list an address.
 */
const DEPRIORITISE = [
  "researchgate.net", "academia.edu", "semanticscholar.org", "scholar.google",
  "linkedin.com", "twitter.com", "x.com", "facebook.com", "wikipedia.org",
  "dblp.org", "orcid.org", "youtube.com", "amazon.com", "sciencedirect.com",
  "springer.com", "ieee.org", "arxiv.org", "researchoutreach.org",
];

export function rankPersonPages(hits: SearchHit[], org: string | null): SearchHit[] {
  const orgTokens = (org ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);

  return [...hits].sort((a, b) => score(b) - score(a));

  function score(h: SearchHit): number {
    const url = h.link.toLowerCase();
    let s = 0;
    if (DEPRIORITISE.some((d) => url.includes(d))) s -= 10;
    if (/\.(edu|ac\.[a-z]{2})(\/|$)/.test(url)) s += 5;
    if (/\.(edu|ac\.[a-z]{2})/.test(url)) s += 3;
    if (orgTokens.some((t) => url.includes(t))) s += 3;
    if (/(people|faculty|profile|staff|~|member|directory)/.test(url)) s += 2;
    if (/(contact|about)/.test(url)) s += 1;
    return s;
  }
}
