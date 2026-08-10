export type Provider = "anthropic" | "openai" | "openrouter";
export type Task = "parse" | "rerank" | "extract" | "write" | "chat";

export const TASKS: Task[] = ["parse", "rerank", "extract", "write", "chat"];

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export function providerConfigured(p: Provider): boolean {
  if (p === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (p === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function configuredProviders(): Provider[] {
  return (["anthropic", "openai", "openrouter"] as Provider[]).filter(
    providerConfigured,
  );
}

/**
 * Default provider when a task has no explicit override.
 * AI_PROVIDER wins, else the first configured one.
 */
export function defaultProvider(): Provider {
  const forced = process.env.AI_PROVIDER?.toLowerCase() as Provider | undefined;
  if (forced && providerConfigured(forced)) return forced;
  const found = configuredProviders()[0];
  if (!found) {
    throw new Error(
      "No LLM key set. Add ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.",
    );
  }
  return found;
}

/**
 * Model per task, sized to the task rather than to the vendor's top tier.
 *
 * Nothing here needs a frontier model. Parsing one sentence into filters and
 * reading contact details off a page are cheap-tier work; only reranking and
 * the final draft benefit from a mid tier, and even that is a judgement call.
 * Flagships were the wrong default for a high-volume sender — opt in per task
 * if you want one.
 *
 * Rough cost for a ~20-person search (extraction dominates, ~500k input):
 *   anthropic   ~$0.55      openai   ~$0.12      openrouter  $0.00
 */
const DEFAULTS: Record<Provider, Record<Task, string>> = {
  anthropic: {
    parse: "claude-haiku-4-5",
    rerank: "claude-sonnet-5",
    extract: "claude-haiku-4-5",
    write: "claude-sonnet-5",
    chat: "claude-haiku-4-5",
  },
  openai: {
    parse: "gpt-5.6-luna",
    rerank: "gpt-5.6-terra",
    extract: "gpt-5.6-luna",
    write: "gpt-5.6-terra",
    chat: "gpt-5.6-luna",
  },
  // Free tiers. Every one of these supports structured outputs — the ones that
  // don't are unusable for parse/rerank/extract.
  openrouter: {
    parse: "google/gemma-4-31b-it:free",
    rerank: "nvidia/nemotron-3-super-120b-a12b:free",
    extract: "google/gemma-4-31b-it:free",
    write: "nvidia/nemotron-3-super-120b-a12b:free",
    chat: "nvidia/nemotron-3-super-120b-a12b:free",
  },
};

/** Upgrade path, surfaced in Settings so the tradeoff is visible. */
export const UPGRADES: Record<Provider, Record<Task, string[]>> = {
  anthropic: {
    parse: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
    rerank: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
    extract: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
    write: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
    chat: ["claude-haiku-4-5", "claude-sonnet-5"],
  },
  openai: {
    parse: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6"],
    rerank: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6"],
    extract: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6"],
    write: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6"],
    chat: ["gpt-5.6-luna", "gpt-5.6-terra"],
  },
  openrouter: {
    parse: [
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "openai/gpt-oss-20b:free",
      "nvidia/nemotron-nano-9b-v2:free",
    ],
    rerank: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
    ],
    extract: [
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "openai/gpt-oss-20b:free",
    ],
    write: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
    ],
    chat: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
    ],
  },
};

export function defaultModel(task: Task, provider: Provider): string {
  return DEFAULTS[provider][task];
}

/** Reasoning depth. Cheap tiers get less, since they charge for it too. */
export const EFFORT: Record<Task, "low" | "medium" | "high"> = {
  parse: "low",
  rerank: "medium",
  extract: "low",
  write: "medium",
  chat: "low",
};
