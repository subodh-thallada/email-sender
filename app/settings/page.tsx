import { revalidatePath } from "next/cache";
import { getProfile, saveProfile } from "@/lib/profile";
import SubmitButton from "./submit-button";

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

const field =
  "field w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm";
const label = "block text-[13px] font-medium mb-1.5";
const hint = "mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]";
const heading =
  "text-[11px] font-semibold uppercase tracking-widest text-[var(--color-faint)]";

export default async function SettingsPage() {
  const p = await getProfile();
  const gmailReady = Boolean(
    process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD,
  );
  const keys: [string, string | undefined, boolean][] = [
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY, true],
    ["SERPER_API_KEY", process.env.SERPER_API_KEY, true],
    ["EXA_API_KEY", process.env.EXA_API_KEY, false],
    ["HUNTER_API_KEY", process.env.HUNTER_API_KEY, false],
    ["GMAIL_USER + GMAIL_APP_PASSWORD", gmailReady ? "set" : undefined, false],
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
        <p className={hint}>
          Set these in <code>.env.local</code> and restart the dev server. The
          Gmail value is a 16-character App Password, not your account password
          &mdash; Google Account &rarr; Security &rarr; 2-Step Verification
          &rarr; App passwords.
        </p>
      </section>

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
