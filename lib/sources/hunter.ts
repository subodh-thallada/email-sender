import { cached, DAY } from "../cache";
import { splitName } from "../email/patterns";

/**
 * Last resort in the waterfall. The free tier is 50 lookups/month, so callers
 * must only reach here after scraping and pattern inference have both failed.
 */
export async function hunterFind(
  fullName: string,
  domain: string,
): Promise<{ address: string; score: number } | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key || !domain) return null;

  const name = splitName(fullName);
  if (!name) return null;

  return cached(`hunter:${name.first}.${name.last}@${domain}`, 30 * DAY, async () => {
    const qs = new URLSearchParams({
      domain,
      first_name: name.first,
      last_name: name.last,
      api_key: key,
    });
    try {
      const res = await fetch(
        `https://api.hunter.io/v2/email-finder?${qs.toString()}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        data?: { email?: string | null; score?: number };
      };
      const address = data.data?.email;
      if (!address) return null;
      return { address: address.toLowerCase(), score: data.data?.score ?? 0 };
    } catch {
      return null;
    }
  });
}
