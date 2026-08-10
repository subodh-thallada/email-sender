/**
 * The one cost switch in the app.
 *
 * A ~20-person search extracts profiles from 40-60 fetched pages, so EXTRACTION
 * dominates spend. Rough per-search cost at ~500k input tokens:
 *   claude-opus-5   ~$2.50   (default — best at reading messy faculty pages)
 *   claude-haiku-4-5 ~$0.60  (set EXTRACTION_MODEL=claude-haiku-4-5 to switch)
 *
 * PARSE and WRITE are single small calls; leave them on Opus 5.
 */
export const MODELS = {
  /** Natural-language query -> structured search intent. */
  PARSE: "claude-opus-5",
  /** Filtering/scoring candidates from the discovery step. */
  RERANK: "claude-opus-5",
  /** Page text -> person dossier + email. The high-volume step. */
  EXTRACT: process.env.EXTRACTION_MODEL ?? "claude-opus-5",
  /** Drafting the cold email. Quality matters most here. */
  WRITE: "claude-opus-5",
} as const;
