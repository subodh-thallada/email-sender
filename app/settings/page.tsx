import { revalidatePath } from "next/cache";
import { getProfile, saveProfile } from "@/lib/profile";
import { dialect } from "@/lib/db";
import {
  PROVIDER_LABEL,
  TASKS,
  UPGRADES,
  defaultModel,
  providerConfigured,
  type Provider,
  type Task,
} from "@/lib/ai/models";
import { getSettings, saveSettings, type Settings } from "@/lib/settings";
import { listAccounts } from "@/lib/google/accounts";
import { oauthConfigured } from "@/lib/google/oauth";
import { encryptionConfigured } from "@/lib/crypto";
import SubmitButton from "./submit-button";
import AiForm from "./ai-form";

export const dynamic = "force-dynamic";

async function save(formData: FormData) {
  "use server";
  await saveProfile({
    full_name: String(formData.get("full_name") ?? ""),
    headline: String(formData.get("headline") ?? ""),
    background: String(formData.get("background") ?? ""),
    goal: String(formData.get("goal") ?? ""),
    tone: String(formData.get("tone") ?? "warm-professional"),
    signature: String(formData.get("signature") ?? ""),
    daily_send_cap: Number(formData.get("daily_send_cap") ?? 25) || 25,
  });
  revalidatePath("/settings");
}

async function saveAi(formData: FormData) {
  "use server";
  const taskProvider: Partial<Record<Task, Provider>> = {};
  const taskModel: Partial<Record<Task, string>> = {};
  for (const t of TASKS) {
    const p = formData.get(`provider_${t}`);
    const m = formData.get(`model_${t}`);
    if (typeof p === "string" && p) taskProvider[t] = p as Provider;
    if (typeof m === "string" && m) taskModel[t] = m;
  }
  const next: Settings = {
    taskProvider,
    taskModel,
    sources: {
      serper: formData.get("src_serper") === "on",
      hunter: formData.get("src_hunter") === "on",
      exa: formData.get("src_exa") === "on",
    },
    exaMaxPerSearch: Number(formData.get("exa_cap") ?? 3) || 3,
  };
  await saveSettings(next);
  revalidatePath("/settings");
}

const field =
  "field w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm";
const label = "block text-[13px] font-medium mb-1.5";
const hint = "mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]";
const heading =
  "text-[11px] font-semibold uppercase tracking-widest text-[var(--color-faint)]";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    gconnected?: string;
    gdisconnected?: string;
    gerror?: string;
  }>;
}) {
  const { gconnected, gdisconnected, gerror } = await searchParams;
  const p = await getProfile();
  const accounts = await listAccounts();
  const sendingReady = oauthConfigured() && encryptionConfigured();
  const settings = await getSettings();
  const providers = (["anthropic", "openai", "openrouter"] as Provider[]).map(
    (id) => ({ id, label: PROVIDER_LABEL[id], configured: providerConfigured(id) }),
  );
  const defaults = Object.fromEntries(
    providers.map((p) => [
      p.id,
      Object.fromEntries(TASKS.map((t) => [t, defaultModel(t, p.id)])),
    ]),
  ) as Record<Provider, Record<Task, string>>;
  const keys: [string, string | undefined, boolean][] = [
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY, false],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY, false],
    ["OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY, false],
    ["EXA_API_KEY", process.env.EXA_API_KEY, false],
    ["SERPER_API_KEY", process.env.SERPER_API_KEY, false],
    ["HUNTER_API_KEY", process.env.HUNTER_API_KEY, false],
    ["GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID, true],
    ["GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET, true],
    ["TOKEN_ENCRYPTION_KEY", process.env.TOKEN_ENCRYPTION_KEY, true],
  ];

  return (
    <div className="space-y-10">
      <div className="enter">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
          Your profile is what makes a draft sound like you rather than a
          template.
        </p>
      </div>

      <section
        className="enter"
        style={{ "--enter-delay": "40ms" } as React.CSSProperties}
      >
        <h2 className={heading}>Environment</h2>
        <ul className="mt-3 divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
          {keys.map(([name, value, required]) => (
            <li key={name} className="flex items-center gap-2.5 px-4 py-2.5">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${
                  value
                    ? "bg-[var(--color-accent)]"
                    : required
                      ? "bg-red-500"
                      : "bg-[var(--color-line)]"
                }`}
              />
              <code className="text-[11px]">{name}</code>
              <span className="ml-auto text-[11px] text-[var(--color-faint)]">
                {value ? "set" : required ? "required" : "optional"}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[11px]">
          <span className="text-[var(--color-faint)]">Database</span>
          <span>
            {dialect() === "postgres" ? "Postgres / Supabase" : "SQLite (local file)"}
          </span>
        </div>

        <p className={hint}>
          Set these in <code>.env.local</code> and restart the dev server. Only
          one LLM key is needed &mdash; set <code>AI_PROVIDER</code> to pick when
          both are present. <code>SERPER_API_KEY</code> is only used when a query
          has no address in it. The three Google values are what let you connect
          a Gmail account below.
        </p>
      </section>

      <section
        className="enter"
        style={{ "--enter-delay": "50ms" } as React.CSSProperties}
      >
        <h2 className={heading}>Sending</h2>

        {gconnected && (
          <p className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px]">
            Connected <strong>{gconnected}</strong>. Mail will be sent from this
            account.
          </p>
        )}
        {gdisconnected && (
          <p className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px]">
            Disconnected <strong>{gdisconnected}</strong>.
          </p>
        )}
        {gerror && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
            {gerror}
          </p>
        )}

        {accounts.length > 0 ? (
          <ul className="mt-3 divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            {accounts.map((a, i) => (
              <li key={a.email} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{a.email}</p>
                  <p className="text-[11px] text-[var(--color-faint)]">
                    {i === 0 ? "Sends from this account" : "Connected"}
                    {a.name ? ` · ${a.name}` : ""}
                  </p>
                </div>
                <form
                  action="/api/google/disconnect"
                  method="post"
                  className="ml-auto"
                >
                  <input type="hidden" name="email" value={a.email} />
                  <button
                    type="submit"
                    className="pressable rounded-md border border-[var(--color-line)] px-2.5 py-1 text-[11px]"
                  >
                    Disconnect
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-[var(--color-muted)]">
            No account connected yet, so nothing can be sent.
          </p>
        )}

        <div className="mt-3">
          {sendingReady ? (
            <a
              href="/api/google/connect"
              className="pressable inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-medium"
            >
              {accounts.length ? "Connect another account" : "Connect Gmail"}
            </a>
          ) : (
            <p className="text-[12px] text-red-700">
              Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>{" "}
              and <code>TOKEN_ENCRYPTION_KEY</code> before connecting.
            </p>
          )}
        </div>

        <p className={hint}>
          Grants only <code>gmail.send</code> &mdash; this app can send as you and
          cannot read your mailbox. Revoke it any time here or at{" "}
          <code>myaccount.google.com/permissions</code>. Scheduled mail is held in
          this app and released by the cron job; Gmail&apos;s own &ldquo;schedule
          send&rdquo; is a feature of the Gmail website and is not available
          through any API.
        </p>
      </section>

      <div className="enter" style={{ "--enter-delay": "60ms" } as React.CSSProperties}>
        <AiForm
          action={saveAi}
          settings={settings}
          providers={providers}
          upgrades={UPGRADES}
          defaults={defaults}
        />
      </div>

      <form
        action={save}
        className="enter space-y-6"
        style={{ "--enter-delay": "80ms" } as React.CSSProperties}
      >
        <h2 className={heading}>Your profile</h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="full_name">
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              className={field}
              defaultValue={p.full_name}
              placeholder="Subodh Thallada"
            />
          </div>
          <div>
            <label className={label} htmlFor="headline">
              Headline
            </label>
            <input
              id="headline"
              name="headline"
              className={field}
              defaultValue={p.headline}
              placeholder="3rd-year Computer Engineering at McMaster"
            />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="background">
            Background / resume
          </label>
          <textarea
            id="background"
            name="background"
            rows={10}
            className={`${field} resize-y`}
            defaultValue={p.background}
            placeholder="Paste your resume or a few paragraphs: coursework, projects, publications, internships, technical skills."
          />
          <p className={hint}>
            Specificity is the whole game. Project names and technologies give
            the writer something real to connect to the recipient&apos;s work.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="goal">
            What you&apos;re asking for
          </label>
          <textarea
            id="goal"
            name="goal"
            rows={3}
            className={`${field} resize-y`}
            defaultValue={p.goal}
            placeholder="A summer 2027 undergraduate research position in robotics / SLAM."
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tone">
              Tone
            </label>
            <select id="tone" name="tone" className={field} defaultValue={p.tone}>
              <option value="warm-professional">Warm &amp; professional</option>
              <option value="concise-direct">Concise &amp; direct</option>
              <option value="formal-academic">Formal / academic</option>
              <option value="casual">Casual</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="daily_send_cap">
              Daily send cap
            </label>
            <input
              id="daily_send_cap"
              name="daily_send_cap"
              type="number"
              min={1}
              max={200}
              className={`${field} tabular-nums`}
              defaultValue={p.daily_send_cap}
            />
            <p className={hint}>
              Gmail allows 500 recipients/day, but ~25&ndash;50 is the safe
              ceiling for cold outreach before deliverability suffers.
            </p>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="signature">
            Signature
          </label>
          <textarea
            id="signature"
            name="signature"
            rows={4}
            className={`${field} resize-y`}
            defaultValue={p.signature}
            placeholder={
              "Subodh Thallada\nComputer Engineering, McMaster University\nlinkedin.com/in/..."
            }
          />
        </div>

        <SubmitButton />
      </form>
    </div>
  );
}
