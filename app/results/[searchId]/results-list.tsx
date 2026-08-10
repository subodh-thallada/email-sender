"use client";

import { useMemo, useState } from "react";
import PersonCard, { type OpenInfo, type PushedDraft } from "../../person-card";
import { Spinner, Swap } from "../../ui/bits";
import type { PersonPayload } from "@/lib/types";

interface BulkResult {
  personId: string;
  subject?: string;
  body?: string;
  error?: string;
}

/**
 * Owns selection for the whole list, because the bulk bar needs the count and
 * the cards each need to know whether they are in it. Everything else about a
 * person still lives inside its own card.
 */
export default function ResultsList({
  people,
  drafts,
  opens,
  bulkLimit,
}: {
  people: PersonPayload[];
  drafts: Record<string, { subject: string; body: string }>;
  opens: Record<string, OpenInfo>;
  bulkLimit: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [pushed, setPushed] = useState<Record<string, PushedDraft>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Nobody can be drafted to without an address, so they are not selectable
  // and must not count toward "select all".
  const selectable = useMemo(
    () => people.filter((p) => p.emails.length > 0).map((p) => p.id),
    [people],
  );

  const chosen = [...selected].slice(0, bulkLimit);
  const overLimit = selected.size > bulkLimit;

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === selectable.length ? new Set() : new Set(selectable),
    );
  }

  async function draftSelected() {
    if (!chosen.length || running) return;
    setRunning(true);
    setNotice(null);

    try {
      const res = await fetch("/api/draft/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds: chosen }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        results?: BulkResult[];
        drafted?: number;
        failed?: number;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // One nonce for the whole run: every card that got text opens at once,
      // and a later run always beats an earlier one.
      const nonce = Date.now();
      const next: Record<string, PushedDraft> = {};
      for (const r of data.results ?? []) {
        if (r.subject !== undefined && r.body !== undefined) {
          next[r.personId] = { subject: r.subject, body: r.body, nonce };
        }
      }
      setPushed((prev) => ({ ...prev, ...next }));

      const failed = data.failed ?? 0;
      setNotice(
        failed
          ? `Drafted ${data.drafted}, ${failed} failed. Redraft those individually to see why.`
          : `Drafted ${data.drafted}.`,
      );
      setSelected(new Set());
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-[12px]">
          <button
            type="button"
            onClick={toggleAll}
            className="pressable pressable-subtle rounded px-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            {selected.size === selectable.length ? "Clear" : "Select all"}
          </button>

          <span className="text-[var(--color-faint)]">
            {selected.size} selected
          </span>

          <button
            type="button"
            onClick={() => void draftSelected()}
            disabled={running || chosen.length === 0}
            className="pressable ml-auto rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5">
              {running && <Spinner />}
              <Swap
                showing={running ? "b" : "a"}
                a={`Draft ${chosen.length || ""}`.trim()}
                b="Writing"
              />
            </span>
          </button>
        </div>
      )}

      {overLimit && (
        <p className="text-[11px] text-amber-700">
          Only the first {bulkLimit} will be drafted — raise the bulk limit in
          Settings to do more at once.
        </p>
      )}

      {notice && (
        <p className="text-[11px] text-[var(--color-muted)]">{notice}</p>
      )}

      {people.map((p, i) => (
        <PersonCard
          key={p.id}
          person={p}
          index={i}
          initialDraft={drafts[p.id] ?? null}
          pushedDraft={pushed[p.id] ?? null}
          opens={opens[p.id] ?? null}
          selected={selected.has(p.id)}
          onSelect={toggle}
        />
      ))}
    </div>
  );
}
