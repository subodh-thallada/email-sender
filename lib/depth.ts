/**
 * Research depth tiers.
 *
 * These live apart from lib/settings.ts because the Settings form is a client
 * component and needs the labels. Importing them from settings.ts would pull
 * the database driver into the browser bundle — `import type` is erased at
 * compile time, but a value import is not.
 *
 * Nothing here may import anything with a server-only dependency.
 */

/** How hard the discovery pipeline digs per person. */
export type Depth = "basic" | "deeper" | "deepest";

export const DEPTHS: Depth[] = ["basic", "deeper", "deepest"];

export interface DepthProfile {
  /** Pages fetched and read per person. The dominant cost — each one is a
   *  fetch plus a slice of LLM extraction context. */
  pagesPerPerson: number;
  /** Web results requested before ranking down to pagesPerPerson. */
  searchResults: number;
  /** Candidates pulled from OpenAlex, as a multiple of the requested count.
   *  Rerank throws most of them away; a bigger pool means better survivors. */
  candidateMultiplier: number;
  /** Exa calls allowed per search, still clamped by exaMaxPerSearch. */
  exaCalls: number;
  /** Whether Exa runs alongside Serper rather than only when Serper is dry.
   *  Exa surfaces personal sites and lab pages that Google ranks poorly. */
  exaSupplements: boolean;
}

export const DEPTH_PROFILE: Record<Depth, DepthProfile> = {
  basic: {
    pagesPerPerson: 2,
    searchResults: 6,
    candidateMultiplier: 2,
    exaCalls: 0,
    exaSupplements: false,
  },
  deeper: {
    pagesPerPerson: 4,
    searchResults: 8,
    candidateMultiplier: 3,
    exaCalls: 3,
    exaSupplements: false,
  },
  deepest: {
    pagesPerPerson: 6,
    searchResults: 12,
    candidateMultiplier: 4,
    exaCalls: 8,
    exaSupplements: true,
  },
};

export const DEPTH_LABEL: Record<Depth, string> = {
  basic: "Basic — 2 pages per person, fastest and cheapest",
  deeper: "Deeper — 4 pages per person, better hooks to write from",
  deepest: "Deepest — 6 pages per person plus Exa, slowest and priciest",
};
