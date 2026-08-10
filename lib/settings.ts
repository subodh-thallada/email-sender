import { nowStamp, one, run } from "./db";
import {
  DEPTHS,
  DEPTH_LABEL,
  DEPTH_PROFILE,
  type Depth,
  type DepthProfile,
} from "./depth";
import {
  configuredProviders,
  defaultModel,
  defaultProvider,
  providerConfigured,
  type Provider,
  type Task,
} from "./ai/models";

/**
 * Dashboard-editable config, stored in the DB so it survives a redeploy and
 * does not require touching env vars. Env still supplies the keys; this only
 * decides which of them get used and with which model.
 */
export interface Settings {
  /** Per task: which provider, and which model on it. Empty = use defaults. */
  taskProvider: Partial<Record<Task, Provider>>;
  taskModel: Partial<Record<Task, string>>;
  /** Paid/limited data sources. Off means never called. */
  sources: {
    serper: boolean;
    hunter: boolean;
    /** Off by default — the credit pool is small. */
    exa: boolean;
  };
  /** Hard ceiling on Exa calls per search, so one run cannot drain the pool.
   *  Applied on top of the depth tier: the lower of the two wins. */
  exaMaxPerSearch: number;
  /** How hard to dig per person. */
  depth: Depth;
  /** How many drafts one bulk request may write at once. */
  bulkDraftLimit: number;
  /** Concurrent LLM calls during a bulk draft. Kept well under the bulk limit
   *  so a batch of 20 does not trip provider rate limits. */
  bulkDraftConcurrency: number;
  /** Add a tracking pixel to outgoing mail and record opens. */
  trackOpens: boolean;
}

const DEFAULTS: Settings = {
  taskProvider: {},
  taskModel: {},
  sources: { serper: true, hunter: true, exa: false },
  exaMaxPerSearch: 3,
  depth: "deeper",
  bulkDraftLimit: 10,
  bulkDraftConcurrency: 3,
  trackOpens: false,
};

const KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const row = await one<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = ?",
    [KEY],
  );
  if (!row) return DEFAULTS;
  try {
    const parsed = JSON.parse(row.value) as Partial<Settings>;
    return {
      ...DEFAULTS,
      ...parsed,
      sources: { ...DEFAULTS.sources, ...(parsed.sources ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  await run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = excluded.updated_at`,
    [KEY, JSON.stringify(next), nowStamp()],
  );
}

/**
 * Which provider+model actually runs a task. Falls back cleanly when the
 * saved provider's key has since been removed.
 */
export async function resolveTask(
  task: Task,
): Promise<{ provider: Provider; model: string }> {
  const s = await getSettings();
  const wanted = s.taskProvider[task];
  const provider =
    wanted && providerConfigured(wanted) ? wanted : defaultProvider();
  const model = s.taskModel[task] || defaultModel(task, provider);
  return { provider, model };
}

/**
 * The active depth tier, with the Exa allowance already clamped by the user's
 * own ceiling. Callers get one object and never have to remember that the two
 * settings interact.
 */
export async function resolveDepth(): Promise<DepthProfile & { depth: Depth }> {
  const s = await getSettings();
  const depth = DEPTH_PROFILE[s.depth] ? s.depth : DEFAULTS.depth;
  const profile = DEPTH_PROFILE[depth];
  return {
    ...profile,
    depth,
    exaCalls: Math.min(profile.exaCalls, s.exaMaxPerSearch),
  };
}

export async function sourceEnabled(
  name: keyof Settings["sources"],
): Promise<boolean> {
  const s = await getSettings();
  if (!s.sources[name]) return false;
  if (name === "serper") return Boolean(process.env.SERPER_API_KEY);
  if (name === "hunter") return Boolean(process.env.HUNTER_API_KEY);
  return Boolean(process.env.EXA_API_KEY);
}

export { configuredProviders };
/** Re-exported for server-side callers. Client components must import these
 *  from lib/depth directly — reaching them through this module would pull the
 *  database driver into the browser bundle. */
export { DEPTHS, DEPTH_LABEL, DEPTH_PROFILE, type Depth, type DepthProfile };
