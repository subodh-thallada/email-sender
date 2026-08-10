export type Route = "academic" | "corporate" | "alumni";

export type EmailConfidence = "verified" | "high" | "inferred" | "unknown";
export type EmailSource =
  | "provided"
  | "mailto"
  | "regex"
  | "deobfuscated"
  | "llm"
  | "pattern"
  | "hunter";

export interface ParsedQuery {
  route: Route;
  institutions: string[];
  topics: string[];
  titles: string[];
  companies: string[];
  pastEmployers: string[];
  location: string | null;
  limit: number;
  rationale: string;
}

export interface Paper {
  title: string;
  year: number | null;
  venue: string | null;
  citations: number | null;
  url: string | null;
}

export interface Dossier {
  title: string | null;
  dept: string | null;
  lab: string | null;
  researchAreas: string[];
  papers: Paper[];
  homepage: string | null;
  location: string | null;
  /** Short factual notes the email writer can hook into. */
  notes: string[];
  sources: string[];
}

export interface Candidate {
  id: string;
  name: string;
  title: string | null;
  org: string | null;
  /** Registrable domain of the institution, e.g. "utoronto.ca". */
  orgDomain: string | null;
  dept: string | null;
  location: string | null;
  homepage: string | null;
  openalexId: string | null;
  orcid: string | null;
  worksCount: number | null;
  citedBy: number | null;
  topics: string[];
  recentPapers: Paper[];
  score: number;
}

export interface FoundEmail {
  address: string;
  source: EmailSource;
  confidence: EmailConfidence;
  mxOk: boolean | null;
  evidence: string | null;
}

/** Progress events streamed to the browser over SSE. */
export type SearchEvent =
  | { type: "status"; message: string }
  | { type: "intent"; intent: ParsedQuery }
  | { type: "candidates"; count: number }
  | { type: "person"; person: PersonPayload }
  | { type: "done"; searchId: string; count: number }
  | { type: "error"; message: string };

export interface PersonPayload {
  id: string;
  name: string;
  title: string | null;
  org: string | null;
  dept: string | null;
  homepage: string | null;
  score: number;
  dossier: Dossier | null;
  emails: FoundEmail[];
}

export interface Profile {
  full_name: string;
  headline: string;
  background: string;
  goal: string;
  tone: string;
  signature: string;
  daily_send_cap: number;
}
