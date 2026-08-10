import { nowStamp, one, run } from "../db";

/**
 * Learn a domain's address format from addresses we already found, then apply
 * it to people whose address we couldn't scrape.
 *
 * Learning is deliberately strict (exact token match only). Nicknames are
 * common in academia — "Timothy D. Barfoot" uses tim.barfoot@ — and inferring
 * {first}.{last} from a nickname would poison the pattern for everyone else at
 * that domain. Anything generated this way is labelled "inferred", never
 * presented as confirmed.
 */

const PATTERNS = [
  "{first}.{last}",
  "{f}{last}",
  "{first}{last}",
  "{f}.{last}",
  "{first}_{last}",
  "{last}.{first}",
  "{last}{f}",
  "{last}.{f}",
  "{last}",
  "{first}",
  "{first}.{l}",
  "{f}{l}",
] as const;

export interface NameParts {
  first: string;
  last: string;
}

/** ASCII-fold and strip anything that can't appear in a local part. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function splitName(fullName: string): NameParts | null {
  const parts = fullName
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Drop initials ("D.") and honorifics.
    .filter((p) => !/^(dr|prof|professor|mr|ms|mrs|phd|md)\.?$/i.test(p))
    .filter((p) => !/^[A-Za-z]\.?$/.test(p));

  if (parts.length < 2) return null;
  const first = norm(parts[0]);
  const last = norm(parts[parts.length - 1]);
  if (!first || !last) return null;
  return { first, last };
}

export function applyPattern(
  pattern: string,
  name: NameParts,
  domain: string,
): string {
  const local = pattern
    .replace("{first}", name.first)
    .replace("{last}", name.last)
    .replace("{f}", name.first[0] ?? "")
    .replace("{l}", name.last[0] ?? "");
  return `${local}@${domain}`;
}

/** Which pattern (if any) exactly produces this address for this name. */
export function detectPattern(
  fullName: string,
  address: string,
): { domain: string; pattern: string } | null {
  const name = splitName(fullName);
  if (!name) return null;
  const [local, domain] = address.toLowerCase().split("@");
  if (!local || !domain) return null;

  for (const p of PATTERNS) {
    // Single-token patterns are too ambiguous to learn from.
    if (p === "{last}" || p === "{first}" || p === "{f}{l}") continue;
    if (applyPattern(p, name, domain) === address.toLowerCase()) {
      return { domain, pattern: p };
    }
  }
  return null;
}

export async function learnPattern(
  fullName: string,
  address: string,
): Promise<void> {
  const found = detectPattern(fullName, address);
  if (!found) return;
  await run(
    `INSERT INTO domain_patterns (domain, pattern, samples, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(domain) DO UPDATE SET
       samples = CASE WHEN domain_patterns.pattern = excluded.pattern
                      THEN domain_patterns.samples + 1 ELSE 1 END,
       pattern = excluded.pattern,
       updated_at = ?`,
    [found.domain, found.pattern, nowStamp(), nowStamp()],
  );
}

export async function getPattern(
  domain: string,
): Promise<{ pattern: string; samples: number } | null> {
  const row = await one<{ pattern: string; samples: number }>(
    "SELECT pattern, samples FROM domain_patterns WHERE domain = ?",
    [domain.toLowerCase()],
  );
  return row ? { pattern: row.pattern, samples: Number(row.samples) } : null;
}

/**
 * Guess an address from a learned domain pattern.
 * `localPartHint` covers the bare-`mailto:` case, where the page gave us the
 * local part but stripped the domain — that beats guessing outright.
 */
export async function inferAddress(
  fullName: string,
  domain: string,
  localPartHint?: string,
): Promise<{ address: string; basis: string } | null> {
  if (!domain) return null;

  if (localPartHint) {
    return {
      address: `${localPartHint}@${domain}`.toLowerCase(),
      basis: `local part "${localPartHint}" from a mailto: link, domain from ${domain}`,
    };
  }

  const name = splitName(fullName);
  if (!name) return null;

  const learned = await getPattern(domain);
  if (!learned) return null;

  return {
    address: applyPattern(learned.pattern, name, domain),
    basis: `${domain} uses ${learned.pattern} (${learned.samples} sample${learned.samples === 1 ? "" : "s"})`,
  };
}
