"use client";

import { useState } from "react";
import type { Provider, Task } from "@/lib/ai/models";
import type { Settings } from "@/lib/settings";
import SubmitButton from "./submit-button";

const TASK_LABEL: Record<Task, string> = {
  parse: "Understand query",
  rerank: "Filter candidates",
  extract: "Read pages for contact info",
  write: "Draft the email",
  chat: "Chat about a draft",
};

const TASK_NOTE: Record<Task, string> = {
  parse: "One short sentence in, filters out. Cheapest tier is plenty.",
  rerank: "Judgement call — drops stale affiliations and grad students.",
  extract: "Highest volume by far. This one choice sets most of your bill.",
  write: "Quality shows here more than anywhere else.",
  chat: "You iterate a lot, so free is the right default.",
};

export default function AiForm({
  action,
  settings,
  providers,
  upgrades,
  defaults,
}: {
  action: (fd: FormData) => Promise<void>;
  settings: Settings;
  providers: { id: Provider; label: string; configured: boolean }[];
  upgrades: Record<Provider, Record<Task, string[]>>;
  defaults: Record<Provider, Record<Task, string>>;
}) {
  const available = providers.filter((p) => p.configured);
  const tasks = Object.keys(TASK_LABEL) as Task[];

  // Local state so the model dropdown re-populates when provider changes.
  const [picked, setPicked] = useState<Record<string, Provider>>(() => {
    const init: Record<string, Provider> = {};
    for (const t of tasks) {
      init[t] = settings.taskProvider[t] ?? available[0]?.id ?? "anthropic";
    }
    return init;
  });

  const field =
    "field w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs";

  return (
    <form action={action} className="space-y-8">
      <section>
        <h2 className="text-[11px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
          Models per task
        </h2>
        <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
          Nothing here needs a frontier model. Defaults are the cheap tier for
          every task; upgrade only where you can see the difference.
        </p>

        {available.length === 0 ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            No LLM key detected. Set <code>ANTHROPIC_API_KEY</code>,{" "}
            <code>OPENAI_API_KEY</code>, or <code>OPENROUTER_API_KEY</code>.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {tasks.map((t) => {
              const prov = picked[t];
              const models = upgrades[prov]?.[t] ?? [];
              const current = settings.taskModel[t] ?? defaults[prov]?.[t];
              return (
                <div
                  key={t}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium">
                      {TASK_LABEL[t]}
                    </span>
                    <span className="text-[10px] text-[var(--color-faint)]">
                      {TASK_NOTE[t]}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      name={`provider_${t}`}
                      className={field}
                      value={prov}
                      onChange={(e) =>
                        setPicked((p) => ({
                          ...p,
                          [t]: e.target.value as Provider,
                        }))
                      }
                    >
                      {available.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <select
                      name={`model_${t}`}
                      className={field}
                      defaultValue={
                        models.includes(current ?? "") ? current : models[0]
                      }
                      key={`${t}-${prov}`}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                          {m === defaults[prov]?.[t] ? "  (default)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
          Data sources
        </h2>
        <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
          Off means never called, so a quota can&apos;t be spent by accident.
          None of these run when your query already contains an address.
        </p>

        <div className="mt-3 divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
          <Toggle
            name="src_serper"
            label="Serper (Google search)"
            note="2,500/month free. Finds faculty and homepages."
            defaultChecked={settings.sources.serper}
            configured={Boolean(providers.length)}
          />
          <Toggle
            name="src_hunter"
            label="Hunter.io"
            note="50/month free. Last resort in the email waterfall."
            defaultChecked={settings.sources.hunter}
          />
          <Toggle
            name="src_exa"
            label="Exa (semantic search)"
            note="Small credit pool. Only used as a Serper fallback, and capped per search."
            defaultChecked={settings.sources.exa}
          />
        </div>

        <label className="mt-3 block text-[11px]">
          <span className="text-[var(--color-muted)]">Max Exa calls per search</span>
          <input
            type="number"
            name="exa_cap"
            min={1}
            max={20}
            defaultValue={settings.exaMaxPerSearch}
            className={`${field} mt-1 w-28 tabular-nums`}
          />
        </label>
      </section>

      <SubmitButton label="Save configuration" />
    </form>
  );
}

function Toggle({
  name,
  label,
  note,
  defaultChecked,
}: {
  name: string;
  label: string;
  note: string;
  defaultChecked: boolean;
  configured?: boolean;
}) {
  return (
    <label className="pressable pressable-subtle flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-[var(--color-paper)]">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[13px]">{label}</span>
        <span className="block text-[11px] text-[var(--color-faint)]">{note}</span>
      </span>
    </label>
  );
}
