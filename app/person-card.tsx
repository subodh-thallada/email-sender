"use client";

import { useState } from "react";
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

type SendStatus = "idle" | "confirm" | "sending" | "sent" | "error";

export default function PersonCard({
  person,
  index = 0,
}: {
  person: PersonPayload;
  /** Drives the entry stagger on server-rendered lists. */
  index?: number;
}) {
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [send, setSend] = useState<{ status: SendStatus; message?: string }>({
    status: "idle",
  });

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
        body: JSON.stringify({ personId: person.id, to: best.address, subject, body }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSend({ status: "sent" });
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
    send.status === "sent";

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
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-medium">
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
                      {CONFIDENCE_LABEL[e.confidence]}
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
              placeholder="Body"
              className="field w-full resize-y rounded-md border border-[var(--color-line)] px-3 py-2 font-mono text-xs leading-relaxed"
            />

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
                  {label(send.status, best?.address)}
                </span>
              </button>

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
    case "confirm":
      return "Send anyway?";
    default:
      return address ? `Send to ${address}` : "No address";
  }
}
