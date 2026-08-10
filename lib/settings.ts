import { nowStamp, one, run } from "./db";
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
  /** Hard ceiling on Exa calls per search, so one run cannot drain the pool. */
  exaMaxPerSearch: number;
}

const DEFAULTS: Settings = {
  taskProvider: {},
  taskModel: {},
  sources: { serper: true, hunter: true, exa: false },
  exaMaxPerSearch: 3,
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
