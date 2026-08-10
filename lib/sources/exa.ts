import { cached, DAY } from "../cache";
import { getSettings } from "../settings";
import type { SearchHit } from "./serper";

/**
 * Exa is the fallback, not a peer of Serper. The credit pool is small, so it
 * only runs when Serper is disabled or out of quota, it is off by default, and
 * a per-search counter stops one run from draining the pool.
 */

const used = new Map<string, number>();

export function resetExaBudget(searchId: string): void {
  used.delete(searchId);
}

export async function exaSearch(
  query: string,
  searchId: string,
  num = 5,
): Promise<SearchHit[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];

  const settings = await getSettings();
  if (!settings.sources.exa) return [];

  const spent = used.get(searchId) ?? 0;
  if (spent >= settings.exaMaxPerSearch) return [];
  used.set(searchId, spent + 1);

  return cached<SearchHit[]>(`exa:${num}:${query}`, 14 * DAY, async () => {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        numResults: num,
        type: "auto",
        contents: { text: false },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Exa ${res.status}`);
    const data = (await res.json()) as {
      results?: { title?: string; url?: string; text?: string }[];
    };
    return (data.results ?? [])
      .filter((r): r is { url: string } & typeof r => Boolean(r.url))
      .map((r) => ({
        title: r.title ?? "",
        link: r.url,
        snippet: (r.text ?? "").slice(0, 300),
      }));
  });
}
