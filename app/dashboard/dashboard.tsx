"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  STATE_LABEL,
  threadState,
  type LabelView,
  type ThreadState,
  type ThreadView,
} from "@/lib/threads/types";
import { Spinner, Swap } from "../ui/bits";
import LabelBar from "./label-bar";
import ThreadRow from "./thread-row";

const STATES: (ThreadState | "all")[] = [
  "all",
  "awaiting",
  "opened",
  "replied",
  "scheduled",
  "error",
];

/**
 * Everything you have sent, in one list you can file, filter and reply from.
 *
 * All state lives here rather than in the URL. The filters are a way of looking
 * at the list, not places you navigate to — and keeping them local means
 * archiving a row or filing it into a folder repaints instantly instead of
 * making a round trip to re-render the page.
 */
export default function Dashboard({
  threads: initialThreads,
  labels: initialLabels,
  canReadMail,
  hasAccount,
}: {
  threads: ThreadView[];
  labels: LabelView[];
  canReadMail: boolean;
  hasAccount: boolean;
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [labels, setLabels] = useState(initialLabels);

  const [query, setQuery] = useState("");
  const [state, setState] = useState<ThreadState | "all">("all");
  const [folder, setFolder] = useState<"all" | "unfiled" | string>("all");
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [compact, setCompact] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const folders = labels.filter((l) => l.kind === "folder");
  const tagLabels = labels.filter((l) => l.kind === "tag");
  const labelById = useMemo(
    () => new Map(labels.map((l) => [l.id, l])),
    [labels],
  );

  /** The archive split comes first: every count below is of what you can see. */
  const visible = useMemo(
    () => threads.filter((t) => t.archived === showArchived),
    [threads, showArchived],
  );

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = { all: visible.length };
    for (const t of visible) {
      const s = threadState(t);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visible.filter((t) => {
      if (state !== "all" && threadState(t) !== state) return false;
      if (folder === "unfiled" && t.folderId) return false;
      if (folder !== "all" && folder !== "unfiled" && t.folderId !== folder) {
        return false;
      }
      // Tags are ANDed: picking two narrows to threads carrying both, which is
      // what a second click on a filter is asking for.
      for (const tag of tags) if (!t.tagIds.includes(tag)) return false;
      if (!needle) return true;
      return (
        (t.contactName ?? "").toLowerCase().includes(needle) ||
        t.contactEmail.toLowerCase().includes(needle) ||
        t.subject.toLowerCase().includes(needle) ||
        t.preview.toLowerCase().includes(needle)
      );
    });
  }, [visible, state, folder, tags, query]);

  const chosen = [...selected].filter((id) =>
    filtered.some((t) => t.id === id),
  );

  function patchLocal(ids: string[], change: Partial<ThreadView>) {
    const set = new Set(ids);
    setThreads((prev) =>
      prev.map((t) => (set.has(t.id) ? { ...t, ...change } : t)),
    );
  }

  /**
   * Applies a filing change locally first, then to the server. The optimistic
   * repaint is the point — filing twenty conversations should feel like moving
   * paper, not like submitting twenty forms.
   */
  async function update(
    ids: string[],
    body: Record<string, unknown>,
    local: Partial<ThreadView> | ((t: ThreadView) => Partial<ThreadView>),
  ) {
    if (!ids.length) return;
    const before = threads;
    const set = new Set(ids);
    setThreads((prev) =>
      prev.map((t) =>
        set.has(t.id)
          ? { ...t, ...(typeof local === "function" ? local(t) : local) }
          : t,
      ),
    );

    try {
      const res = await fetch("/api/threads/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...body }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    } catch (e) {
      setThreads(before);
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch("/api/threads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        scanned: number;
        newReplies: number;
        failed: number;
      };
      if (!data.ok) {
        setNotice(data.reason ?? "Sync failed.");
        return;
      }
      setNotice(
        data.newReplies > 0
          ? `${data.newReplies} new ${data.newReplies === 1 ? "reply" : "replies"} across ${data.scanned} conversations.`
          : `No new replies across ${data.scanned} conversations.`,
      );
      // The counters and previews all changed server-side; a reload is simpler
      // and more honest than patching a dozen fields by hand.
      if (data.newReplies > 0) window.location.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const pill =
    "pressable pressable-subtle rounded-full border px-2.5 py-1 text-[11px] transition-colors";
  const pillOff =
    "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]";
  const pillOn =
    "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]";

  return (
    <div className="space-y-5">
      <header className="enter flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
            Outreach
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
            {threads.length === 0
              ? "Nothing sent yet. Run a search, draft an email, and it will show up here."
              : "Every conversation you have started, with replies, follow-ups and what is still queued."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          className="pressable rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          <span className="flex items-center gap-1.5">
            {syncing && <Spinner />}
            <Swap showing={syncing ? "b" : "a"} a="Check for replies" b="Checking" />
          </span>
        </button>
      </header>

      {!canReadMail && threads.length > 0 && (
        <p
          className="enter rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900"
          style={{ "--enter-delay": "30ms" } as React.CSSProperties}
        >
          {hasAccount
            ? "Your connected Gmail account can send but not read, so replies cannot be shown."
            : "No Gmail account is connected, so nothing can be sent or read."}{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            {hasAccount ? "Reconnect it in Settings" : "Connect one in Settings"}
          </Link>{" "}
          to pull replies into this page. Everything else here works without it.
        </p>
      )}

      {notice && (
        <p className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-[12px] text-[var(--color-muted)]">
          {notice}
        </p>
      )}

      {threads.length > 0 && (
        <div
          className="enter space-y-3"
          style={{ "--enter-delay": "40ms" } as React.CSSProperties}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, address, subject…"
              className="field min-w-[12rem] flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px]"
            />
            <button
              type="button"
              onClick={() => setCompact((c) => !c)}
              className={`${pill} ${compact ? pillOn : pillOff}`}
              title="Hide the preview line and show more rows at once"
            >
              {compact ? "Compact" : "Cozy"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowArchived((a) => !a);
                setSelected(new Set());
                setExpanded(null);
              }}
              className={`${pill} ${showArchived ? pillOn : pillOff}`}
            >
              {showArchived ? "Archived" : "Active"}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STATES.map((s) => {
              const count = stateCounts[s] ?? 0;
              if (s !== "all" && count === 0) return null;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState(s)}
                  className={`${pill} ${state === s ? pillOn : pillOff}`}
                >
                  {s === "all" ? "All" : STATE_LABEL[s]}
                  <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
                </button>
              );
            })}
          </div>

          <LabelBar
            labels={labels}
            onLabelsChange={setLabels}
            folder={folder}
            onFolderChange={setFolder}
            tags={tags}
            onTagsChange={setTags}
            counts={visible}
          />
        </div>
      )}

      {chosen.length > 0 && (
        <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-[12px] shadow-[0_1px_2px_rgb(20_22_26/0.04)]">
          <span className="text-[var(--color-faint)]">
            {chosen.length} selected
          </span>

          <select
            aria-label="Move selected to folder"
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              const folderId = value === "__none" ? null : value;
              void update(chosen, { folderId }, { folderId });
              setSelected(new Set());
            }}
            className="field rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px]"
          >
            <option value="">Move to…</option>
            <option value="__none">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          {tagLabels.length > 0 && (
            <select
              aria-label="Tag selected"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                void update(chosen, { addTag: id }, (t) => ({
                  tagIds: t.tagIds.includes(id) ? t.tagIds : [...t.tagIds, id],
                }));
                setSelected(new Set());
              }}
              className="field rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px]"
            >
              <option value="">Tag…</option>
              {tagLabels.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => {
              void update(
                chosen,
                { archived: !showArchived },
                { archived: !showArchived },
              );
              setSelected(new Set());
            }}
            className="pressable rounded-md border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-medium"
          >
            {showArchived ? "Unarchive" : "Archive"}
          </button>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="pressable pressable-subtle ml-auto rounded px-1.5 py-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Clear
          </button>
        </div>
      )}

      {threads.length > 0 && filtered.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-8 text-center text-[13px] text-[var(--color-faint)]">
          Nothing matches these filters.
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((t, i) => (
          <ThreadRow
            key={t.id}
            thread={t}
            index={i}
            compact={compact}
            folders={folders}
            tagLabels={tagLabels}
            labelById={labelById}
            selected={selected.has(t.id)}
            onSelect={toggleSelect}
            expanded={expanded === t.id}
            onExpand={(open) => setExpanded(open ? t.id : null)}
            onUpdate={update}
            onLocalPatch={patchLocal}
            canReadMail={canReadMail}
          />
        ))}
      </div>

      {threads.length > 0 && (
        <p className="pt-2 text-center text-[11px] text-[var(--color-faint)]">
          Opens are weak evidence — image proxies and privacy prefetch both fire
          the pixel without anyone reading. Silence is not a no.
        </p>
      )}
    </div>
  );
}
