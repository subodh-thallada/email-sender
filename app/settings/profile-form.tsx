"use client";

import { useState } from "react";
import { Spinner, Swap } from "../ui/bits";
import SubmitButton from "../ui/submit-button";
import type { Profile, ProfileDraft } from "@/lib/types";

const field =
  "field w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm";
const label = "block text-[13px] font-medium mb-1.5";
const hint = "mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]";
const heading =
  "text-[11px] font-semibold uppercase tracking-widest text-[var(--color-faint)]";

/**
 * The memory profile: what every draft is written from.
 *
 * Controlled rather than uncontrolled because the builder writes into these
 * fields after the fact. It fills them in and stops there — nothing is saved
 * until the user has read what the model inferred and pressed Save, since
 * these values end up in mail sent to strangers under their name.
 */
export default function ProfileForm({
  action,
  profile,
}: {
  action: (formData: FormData) => void | Promise<void>;
  profile: Profile;
}) {
  const [p, setP] = useState<Profile>(profile);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [building, setBuilding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filled, setFilled] = useState<string[]>([]);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setP((prev) => ({ ...prev, [key]: value }));
  }

  async function build() {
    if (building || description.trim().length < 20) return;
    setBuilding(true);
    setNote(null);
    setFilled([]);

    try {
      const res = await fetch("/api/profile/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, url: url.trim() || undefined }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        profile?: ProfileDraft;
      };
      if (!res.ok || !data.ok || !data.profile) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const d = data.profile;
      const changed: string[] = [];

      // Only fill blanks. Overwriting something the user typed by hand with a
      // model's paraphrase of it is the fastest way to lose their trust in
      // this button.
      setP((prev) => {
        const next = { ...prev };
        const apply = (key: keyof Profile, value: string | undefined) => {
          if (!value?.trim()) return;
          if (String(next[key]).trim()) return;
          (next[key] as string) = value.trim();
          changed.push(key);
        };

        apply("full_name", d.full_name);
        apply("headline", d.headline);
        apply("offer", d.offer);
        apply("audience", d.audience);
        apply("background", d.background);
        apply("goal", d.goal);
        apply("signature", d.signature);
        apply("links", d.links?.join("\n"));
        if (d.tone && !prev.tone) next.tone = d.tone;
        return next;
      });

      setFilled(changed);
      setNote(
        changed.length
          ? "Read these over, then save. Anything already filled in was left alone."
          : "Nothing new to add — every field it could fill was already set.",
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  const wasFilled = (k: string) =>
    filled.includes(k) ? " border-[var(--color-accent)]" : "";

  return (
    <form action={action} className="space-y-8">
      <div>
        <h2 className={heading}>Your profile</h2>
        <p className="mt-2 text-[13px] text-[var(--color-muted)]">
          This is the memory every draft is written from. Describe your business
          once and let it fill the fields in, or write them yourself.
        </p>
      </div>

      {/* ---------------------------------------------------------- builder */}
      <div className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
        <div>
          <label className={label} htmlFor="describe">
            Describe what you do
          </label>
          <textarea
            id="describe"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="I build Shopify stores for independent skincare brands. Been doing it three years, last one took a client from 40k to 120k a month. I want intro calls with founders who are still on a default theme."
            className={`${field} resize-y`}
          />
          <p className={hint}>
            Plain English is fine. Concrete numbers, client names and tools are
            what make the drafts specific.
          </p>
        </div>

        <div>
          <label className={label} htmlFor="site">
            Your website <span className="font-normal text-[var(--color-faint)]">(optional)</span>
          </label>
          <input
            id="site"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="acme.com"
            className={field}
          />
          <p className={hint}>Read once for extra context. Never stored.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void build()}
            disabled={building || description.trim().length < 20}
            className="pressable rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5">
              {building && <Spinner />}
              <Swap showing={building ? "b" : "a"} a="Fill in my profile" b="Reading" />
            </span>
          </button>
          {note && (
            <span className="text-[11px] text-[var(--color-muted)]">{note}</span>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- fields */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="full_name">
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            className={field + wasFilled("full_name")}
            value={p.full_name}
            onChange={(e) => set("full_name", e.target.value)}
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
            className={field + wasFilled("headline")}
            value={p.headline}
            onChange={(e) => set("headline", e.target.value)}
            placeholder="3rd-year Computer Engineering at McMaster"
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="offer">
            What you offer
          </label>
          <textarea
            id="offer"
            name="offer"
            rows={3}
            className={`${field} resize-y${wasFilled("offer")}`}
            value={p.offer}
            onChange={(e) => set("offer", e.target.value)}
            placeholder="Shopify storefront rebuilds for skincare brands doing under $200k/month."
          />
        </div>
        <div>
          <label className={label} htmlFor="audience">
            Who you serve
          </label>
          <textarea
            id="audience"
            name="audience"
            rows={3}
            className={`${field} resize-y${wasFilled("audience")}`}
            value={p.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder="Founders and heads of ecommerce at independent DTC brands, North America."
          />
        </div>
      </div>

      <p className={hint}>
        Filling both of these switches the writer from academic outreach to a
        client pitch. Leave them blank if you are writing to researchers.
      </p>

      <div>
        <label className={label} htmlFor="background">
          Background / resume
        </label>
        <textarea
          id="background"
          name="background"
          rows={10}
          className={`${field} resize-y${wasFilled("background")}`}
          value={p.background}
          onChange={(e) => set("background", e.target.value)}
          placeholder="Paste your resume, case studies, or a few paragraphs: past clients, results, projects, tools."
        />
        <p className={hint}>
          Specificity is the whole game. Named projects and real numbers give
          the writer something to connect to the recipient&apos;s situation.
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
          className={`${field} resize-y${wasFilled("goal")}`}
          value={p.goal}
          onChange={(e) => set("goal", e.target.value)}
          placeholder="A 15-minute call about rebuilding their storefront."
        />
      </div>

      <div>
        <label className={label} htmlFor="links">
          Links
        </label>
        <textarea
          id="links"
          name="links"
          rows={3}
          className={`${field} resize-y font-mono text-xs${wasFilled("links")}`}
          value={p.links}
          onChange={(e) => set("links", e.target.value)}
          placeholder={"https://yoursite.com\nhttps://github.com/you"}
        />
        <p className={hint}>
          One per line. These are the only URLs a draft may cite &mdash; it is
          told never to invent one.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="tone">
            Tone
          </label>
          <select
            id="tone"
            name="tone"
            className={field}
            value={p.tone}
            onChange={(e) => set("tone", e.target.value)}
          >
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
            value={p.daily_send_cap}
            onChange={(e) => set("daily_send_cap", Number(e.target.value))}
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
          className={`${field} resize-y${wasFilled("signature")}`}
          value={p.signature}
          onChange={(e) => set("signature", e.target.value)}
          placeholder={"Subodh Thallada\nComputer Engineering, McMaster University\nlinkedin.com/in/..."}
        />
      </div>

      {/* ------------------------------------------------------ personalize */}
      <div className="border-t border-[var(--color-line)] pt-8">
        <h2 className={heading}>Personalize</h2>
        <label className={`${label} mt-3`} htmlFor="instructions">
          Standing instructions
        </label>
        <textarea
          id="instructions"
          name="instructions"
          rows={5}
          className={`${field} resize-y`}
          value={p.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder={
            "Never open with a question.\nAlways mention that the first consultation is free.\nOnly target people in Canada.\nKeep it under 100 words."
          }
        />
        <p className={hint}>
          These outrank every built-in rule, everywhere in the app &mdash; when
          drafting, when revising, and when deciding who is worth writing to.
          The one thing they cannot do is authorise inventing a fact about
          someone.
        </p>
      </div>

      <SubmitButton />
    </form>
  );
}
