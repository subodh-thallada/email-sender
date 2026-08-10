export type Provider = "anthropic" | "openai";
export type Task = "parse" | "rerank" | "extract" | "write";

/**
 * Pick the provider. Explicit AI_PROVIDER wins; otherwise whichever key exists.
 * Anthropic first when both are set.
 */
export function activeProvider(): Provider {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  if (forced === "openai" || forced === "anthropic") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  throw new Error(
    "No LLM key set. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.",
  );
}

/**
 * EXTRACT is the high-volume task — a ~20-person search reads 40-60 pages.
 * The others are single small calls, so they stay on the flagship.
 *
 * Per ~20-person search, roughly:
 *   anthropic  claude-opus-5    ~$2.50   |  claude-haiku-4-5  ~$0.60
 *   openai     gpt-5.6-sol      ~$2.50   |  gpt-5.6-luna      ~$0.10
 *
 * Override the extraction model alone with EXTRACTION_MODEL.
 */
const DEFAULTS: Record<Provider, Record<Task, string>> = {
  anthropic: {
    parse: "claude-opus-5",
    rerank: "claude-opus-5",
    extract: "claude-opus-5",
    write: "claude-opus-5",
  },
  openai: {
    parse: "gpt-5.6",
    rerank: "gpt-5.6",
    extract: "gpt-5.6",
    write: "gpt-5.6",
  },
};

export function modelFor(task: Task, provider = activeProvider()): string {
  if (task === "extract" && process.env.EXTRACTION_MODEL) {
    return process.env.EXTRACTION_MODEL;
  }
  return DEFAULTS[provider][task];
}

/** Reasoning depth per task. Both providers accept these level names. */
export const EFFORT: Record<Task, "low" | "medium" | "high"> = {
  parse: "low",
  rerank: "medium",
  extract: "low",
  write: "medium",
};
