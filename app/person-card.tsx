"use client";

import { useEffect, useState } from "react";
import type { EmailConfidence, PersonPayload } from "@/lib/types";
import Tooltip from "./ui/tooltip";
import { CopyButton, Spinner, Swap } from "./ui/bits";

const CONFIDENCE_STYLE: Record<EmailConfidence, string> = {
  verified: "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[#cfe0d8]",
  high: "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[#cfe0d8]",
  inferred: "bg-amber-50 text-amber-800 border-amber-200",
  unknown: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

const CONFIDENCE_LABEL: Record<EmailConfidence, string> = {
  verified: "verified",
  high: "on page",
  inferred: "guessed",
  unknown: "unverified",
};

/** An address you supplied yourself deserves its own label, not "on page". */
function badgeLabel(e: { source: string; confidence: EmailConfidence }): string {
  if (e.source === "provided") return "you supplied";
  return CONFIDENCE_LABEL[e.confidence];
}

type SendStatus = "idle" | "confirm" | "sending" | "sent" | "scheduled" | "error";

/** A draft written elsewhere (bulk) and pushed into this card. */
export interface PushedDraft {
  subject: string;
  body: string;
  /** Bumped on every bulk run so a redraft with identical text still lands. */
  nonce: number;
}

export interface OpenInfo {
  count: number;
  firstAt: string | null;
}

export default function PersonCard({
  person,
  index = 0,
  initialDraft = null,
  pushedDraft = null,
  opens = null,
  selected,
  onSelect,
}: {
  person: PersonPayload;
  /** Drives the entry stagger on server-rendered lists. */
  index?: number;
  /** Draft already saved for this person, loaded server-side. */
  initialDraft?: { subject: string; body: string } | null;
  /** Draft delivered by a bulk run after mount. */
  pushedDraft?: PushedDraft | null;
  /** Read receipts, when this person has already been emailed. */
  opens?: OpenInfo | null;
  /** Selection is owned by the list so the bulk bar can count it. */
  selected?: boolean;
  onSelect?: (personId: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(Boolean(initialDraft));
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [send, setSend] = useState<{ status: SendStatus; message?: string }>({
    status: "idle",
  });
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState<"now" | "at" | "peak">("now");
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [history, setHistory] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  // A bulk run writes into cards that are already mounted. Keyed on nonce so
  // it fires once per run and never clobbers an edit made in between.
  const nonce = pushedDraft?.nonce ?? 0;
  useEffect(() => {
    if (!pushedDraft) return;
    setSubject(pushedDraft.subject);
    setBody(pushedDraft.body);
    setOpen(true);
    setSend({ status: "idle" });
    setHistory([]);
    // pushedDraft is a fresh object each render; nonce is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const best = person.emails[0];
  const dossier = person.dossier;
  const needsConfirm = best?.confidence === "inferred" || best?.confidence === "unknown";

  async function draft() {
    setDrafting(true);
    setOpen(true);
    setSubject("");
    setBody("");
    setSend({ status: "idle" });
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: person.id }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const idx = acc.indexOf("\n\n");
        if (idx === -1) {
          setSubject(acc.replace(/^Subject:\s*/i, ""));
        } else {
          setSubject(acc.slice(0, idx).replace(/^Subject:\s*/i, "").trim());
          setBody(acc.slice(idx + 2));
        }
      }
    } catch (e) {
      setBody(`Could not draft: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDrafting(false);
    }
  }

  /** Chat that edits the draft in place, on the cheap/free chat model. */
  async function revise() {
    const ask = instruction.trim();
    if (!ask || revising) return;
    setRevising(true);
    setInstruction("");
    setHistory((h) => [...h, { role: "user", content: ask }]);
    const prevSubject = subject;
    const prevBody = body;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: person.id,
          subject,
          body,
          instruction: ask,
          history,
        }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const idx = acc.indexOf("\n\n");
        if (idx === -1) {
          setSubject(acc.replace(/^Subject:\s*/i, ""));
        } else {
          setSubject(acc.slice(0, idx).replace(/^Subject:\s*/i, "").trim());
          setBody(acc.slice(idx + 2));
        }
      }
      setHistory((h) => [...h, { role: "assistant", content: acc }]);
    } catch (e) {
      // Never leave the editor holding a half-written revision.
      setSubject(prevSubject);
      setBody(prevBody);
      setHistory((h) => [
        ...h,
        { role: "assistant", content: `(failed: ${e instanceof Error ? e.message : String(e)})` },
      ]);
    } finally {
      setRevising(false);
    }
  }

  async function doSend() {
    if (!best) return;
    // A guessed address gets one extra beat of friction. The confidence is
    // lower, and the action can't be taken back.
    if (needsConfirm && send.status === "idle") {
      setSend({ status: "confirm" });
      return;
    }
    setSend({ status: "sending" });
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: person.id,
          to: best.address,
          subject,
          body,
          mode,
          // datetime-local has no zone; the browser's own offset is what the
          // user meant, so build the instant locally and send it as ISO.
          scheduledAt:
            mode === "at" && when ? new Date(when).toISOString() : undefined,
          // Peak times are computed in the sender's timezone, which only the
          // browser knows. getTimezoneOffset is minutes *behind* UTC, so it
          // is negated to become minutes to add.
          tzOffsetMinutes: -new Date().getTimezoneOffset(),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        scheduled?: boolean;
        when?: string | null;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSend({
        status: data.scheduled ? "scheduled" : "sent",
        message: data.when ?? undefined,
      });
    } catch (e) {
      setSend({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const sendDisabled =
    !best ||
    drafting ||
    !subject.trim() ||
    !body.trim() ||
    send.status === "sending" ||
    send.status === "sent" ||
    send.status === "scheduled";

  return (
    <article
      className="card overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]"
      // Capped so a long list never stalls behind its own choreography.
      // --enter-delay, not transition-delay: this must not postpone hover.
      style={
        { "--enter-delay": `${Math.min(index, 10) * 40}ms` } as React.CSSProperties
      }
    >
      <div className="flex items-start justify-between gap-4 p-4">
        {onSelect && (
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={(e) => onSelect(person.id, e.target.checked)}
            disabled={person.emails.length === 0}
            aria-label={`Select ${person.name} for bulk drafting`}
            title={
              person.emails.length === 0
                ? "No address found, so there is nobody to draft to"
                : `Select ${person.name}`
            }
            className="mt-1 size-3.5 shrink-0 accent-[var(--color-accent)] disabled:opacity-30"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-[15px] leading-snug font-medium">
            {opens && opens.count > 0 && (
              <Tooltip
                label={`Pixel loaded ${opens.count} time${opens.count === 1 ? "" : "s"}${
                  opens.firstAt ? `, first at ${opens.firstAt} UTC` : ""
                }. Proxies and image prefetch make this approximate.`}
              >
                <span className="order-last rounded-full border border-[#cfe0d8] bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]">
                  opened{opens.count > 1 ? ` ${opens.count}×` : ""}
                </span>
              </Tooltip>
            )}
            {person.homepage ? (
              <a
                href={person.homepage}
                target="_blank"
                rel="noreferrer noopener"
                className="decoration-[var(--color-line)] underline-offset-4 hover:underline"
              >
                {person.name}
              </a>
            ) : (
              person.name
            )}
          </h3>

          <p className="mt-1 text-[13px] text-[var(--color-muted)]">
            {[person.title, person.dept, person.org].filter(Boolean).join(" · ") || "—"}
          </p>

          {dossier && dossier.researchAreas.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {dossier.researchAreas.slice(0, 4).map((a) => (
                <span
                  key={a}
                  className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                >
                  {a}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 space-y-1">
            {person.emails.length === 0 ? (
              <p className="text-[11px] text-[var(--color-faint)]">
                No address found — try their homepage.
              </p>
            ) : (
              person.emails.map((e) => (
                <div key={e.address} className="flex items-center gap-1.5">
                  <CopyButton value={e.address} />
                  <Tooltip label={e.evidence ?? ""}>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${CONFIDENCE_STYLE[e.confidence]}`}
                    >
                      {badgeLabel(e)}
                    </span>
                  </Tooltip>
                </div>
              ))
            )}
          </div>

          {dossier && dossier.papers.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-[var(--color-line)] pt-3">
              {dossier.papers.slice(0, 3).map((p) => (
                <li
                  key={p.title}
                  className="truncate text-[11px] text-[var(--color-faint)]"
                >
                  <span className="tabular-nums">{p.year ?? "—"}</span>
                  <span className="mx-1.5">·</span>
                  {p.title}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={() => void draft()}
          disabled={drafting}
          className="pressable shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5">
            {drafting && <Spinner />}
            <Swap
              showing={drafting ? "b" : "a"}
              a={open ? "Redraft" : "Draft email"}
              b="Writing"
            />
          </span>
        </button>
      </div>

      {/* Always mounted so the collapse can animate both directions. */}
      <div className="collapsible" data-open={open}>
        <div>
          <div className="space-y-3 border-t border-[var(--color-line)] p-4">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="field w-full rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Body — markdown: **bold**, [link](https://…), - lists"
              className="field w-full resize-y rounded-md border border-[var(--color-line)] px-3 py-2 font-mono text-xs leading-relaxed"
            />

            <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] p-2">
              {history.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {history
                    .filter((m) => m.role === "user")
                    .slice(-3)
                    .map((m, i) => (
                      <li key={i} className="text-[11px] text-[var(--color-faint)]">
                        &ldquo;{m.content}&rdquo;
                      </li>
                    ))}
                </ul>
              )}
              <div className="flex gap-2">
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void revise();
                    }
                  }}
                  disabled={revising || drafting}
                  placeholder="shorter, mention my ROS2 project, add a link to my repo…"
                  className="field min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => void revise()}
                  disabled={revising || drafting || !instruction.trim()}
                  className="pressable shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
                >
                  <span className="flex items-center gap-1.5">
                    {revising && <Spinner />}
                    <Swap showing={revising ? "b" : "a"} a="Revise" b="Revising" />
                  </span>
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-[var(--color-faint)]">
                Edits the draft in place. Runs on the chat model from Settings —
                free on OpenRouter.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <label htmlFor={`when-${person.id}`}>Send</label>
              <select
                id={`when-${person.id}`}
                className="field rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px]"
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as "now" | "at" | "peak";
                  setMode(next);
                  setWhen(
                    next === "at"
                      ? localInput(new Date(Date.now() + 3600_000))
                      : "",
                  );
                }}
              >
                <option value="now">now</option>
                <option value="peak">at the next peak time</option>
                <option value="at">at a time</option>
              </select>
              {mode === "at" && (
                <input
                  type="datetime-local"
                  value={when}
                  min={localInput(new Date())}
                  onChange={(e) => setWhen(e.target.value)}
                  className="field rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px]"
                />
              )}
              {mode === "peak" && (
                <span className="text-[10px] text-[var(--color-faint)]">
                  Next Tue&ndash;Thu mid-morning, your timezone
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void doSend()}
                disabled={sendDisabled}
                className={`pressable rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
                  send.status === "confirm"
                    ? "bg-amber-700"
                    : "bg-[var(--color-accent)]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {send.status === "sending" && <Spinner />}
                  {send.status === "idle" && mode !== "now"
                    ? "Schedule"
                    : label(send.status, best?.address)}
                </span>
              </button>

              {send.status === "scheduled" && send.message && (
                <span className="text-xs text-[var(--color-muted)]">
                  {send.message}
                </span>
              )}

              {send.status === "confirm" && (
                <button
                  onClick={() => setSend({ status: "idle" })}
                  className="pressable pressable-subtle rounded-md px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  Cancel
                </button>
              )}

              {send.status === "error" && (
                <span className="text-xs text-red-700">{send.message}</span>
              )}

              {send.status === "idle" && needsConfirm && best && (
                <span className="text-xs text-amber-700">
                  This address was guessed, not found.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function label(status: SendStatus, address?: string): string {
  switch (status) {
    case "sending":
      return "Sending";
    case "sent":
      return "Sent";
    case "scheduled":
      return "Scheduled";
    case "confirm":
      return "Send anyway?";
    default:
      return address ? `Send to ${address}` : "No address";
  }
}

/** datetime-local wants local wall-clock, not ISO/UTC. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
