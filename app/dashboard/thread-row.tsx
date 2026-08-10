"use client";

import { useCallback, useEffect, useState } from "react";
import {
  STATE_LABEL,
  colorHex,
  followupSubject,
  threadState,
  type LabelView,
  type MessageView,
  type PendingView,
  type ThreadDetail,
  type ThreadView,
} from "@/lib/threads/types";
import { Spinner, Swap } from "../ui/bits";
import RelativeTime, { useMounted } from "./relative-time";
import { fullTime, localInput } from "./utils";

const STATE_STYLE: Record<string, string> = {
  replied: "border-[#cfe0d8] bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  opened: "border-[#cfe0d8] bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  scheduled: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-red-200 bg-red-50 text-red-800",
  awaiting: "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-faint)]",
};

type SendStatus = "idle" | "sending" | "sent" | "scheduled" | "error";

/**
 * One conversation: a single line until you open it, then the whole exchange
 * plus a place to write the next message.
 *
 * The detail is fetched on first expand rather than shipped with the list. Full
 * message bodies are most of the weight of this page, and the collapsed row
 * shows one line of them.
 */
export default function ThreadRow({
  thread,
  index,
  compact,
  folders,
  tagLabels,
  labelById,
  selected,
  onSelect,
  expanded,
  onExpand,
  onUpdate,
  onLocalPatch,
  canReadMail,
}: {
  thread: ThreadView;
  index: number;
  compact: boolean;
  folders: LabelView[];
  tagLabels: LabelView[];
  labelById: Map<string, LabelView>;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  expanded: boolean;
  onExpand: (open: boolean) => void;
  onUpdate: (
    ids: string[],
    body: Record<string, unknown>,
    local: Partial<ThreadView> | ((t: ThreadView) => Partial<ThreadView>),
  ) => void;
  onLocalPatch: (ids: string[], change: Partial<ThreadView>) => void;
  canReadMail: boolean;
}) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [intent, setIntent] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [mode, setMode] = useState<"now" | "at" | "peak">("now");
  const [when, setWhen] = useState("");
  const [send, setSend] = useState<{ status: SendStatus; message?: string }>({
    status: "idle",
  });

  const mounted = useMounted();
  const state = threadState(thread);
  const subject = followupSubject(thread.subject);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/threads/${thread.id}`);
      const data = (await res.json()) as
        | ({ ok: true } & ThreadDetail)
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error);
      setDetail({
        thread: data.thread,
        messages: data.messages,
        pending: data.pending,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [thread.id]);

  useEffect(() => {
    if (expanded && !detail && !loading) void load();
    // `loading` is intentionally not a dependency: including it would re-fire
    // the moment the fetch settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, detail, load]);

  async function draftFollowup() {
    if (drafting) return;
    setDrafting(true);
    setBody("");
    setSend({ status: "idle" });
    try {
      const res = await fetch("/api/followup/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, intent: intent.trim() || undefined }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setBody(acc);
      }
    } catch (e) {
      setBody("");
      setSend({
        status: "error",
        message: `Could not draft: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setDrafting(false);
    }
  }

  async function sendFollowup() {
    if (!body.trim() || send.status === "sending") return;
    setSend({ status: "sending" });
    try {
      const res = await fetch("/api/followup/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          body,
          mode,
          scheduledAt:
            mode === "at" && when ? new Date(when).toISOString() : undefined,
          // getTimezoneOffset is minutes *behind* UTC, so it is negated to
          // become minutes to add — the same convention /api/send uses.
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
      setBody("");
      setIntent("");
      // Counters on the collapsed row move immediately; the timeline is
      // reloaded so the new message appears where it belongs.
      onLocalPatch(
        [thread.id],
        data.scheduled
          ? { scheduledCount: thread.scheduledCount + 1 }
          : { sendCount: thread.sendCount + 1 },
      );
      await load();
    } catch (e) {
      setSend({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function cancelPending(id: string) {
    setDetail((d) =>
      d ? { ...d, pending: d.pending.filter((p) => p.id !== id) } : d,
    );
    onLocalPatch([thread.id], {
      scheduledCount: Math.max(0, thread.scheduledCount - 1),
    });
    await fetch("/api/outbox/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  const sendDisabled =
    drafting ||
    !body.trim() ||
    send.status === "sending" ||
    send.status === "sent" ||
    send.status === "scheduled";

  return (
    <article
      className="card overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]"
      style={
        { "--enter-delay": `${Math.min(index, 10) * 30}ms` } as React.CSSProperties
      }
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(thread.id, e.target.checked)}
          aria-label={`Select conversation with ${thread.contactName ?? thread.contactEmail}`}
          className="mt-1 size-3.5 shrink-0 accent-[var(--color-accent)]"
        />

        <button
          type="button"
          onClick={() => onExpand(!expanded)}
          aria-expanded={expanded}
          className="pressable pressable-subtle min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[14px] font-medium">
              {thread.contactName ?? thread.contactEmail}
            </span>

            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${STATE_STYLE[state]}`}
            >
              {STATE_LABEL[state]}
              {state === "replied" && thread.replyCount > 1
                ? ` ${thread.replyCount}×`
                : ""}
              {state === "opened" && thread.openCount > 1
                ? ` ${thread.openCount}×`
                : ""}
            </span>

            {thread.folderId && labelById.get(thread.folderId) && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  color: colorHex(labelById.get(thread.folderId)!.color),
                  background: "var(--color-paper)",
                }}
              >
                {labelById.get(thread.folderId)!.name}
              </span>
            )}

            {thread.tagIds.map((id) => {
              const label = labelById.get(id);
              if (!label) return null;
              return (
                <span
                  key={id}
                  title={label.name}
                  aria-label={label.name}
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: colorHex(label.color) }}
                />
              );
            })}

            <RelativeTime
              stamp={thread.lastReplyAt ?? thread.lastSentAt}
              className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--color-faint)]"
            />
          </div>

          <p className="mt-0.5 truncate text-[12px] text-[var(--color-muted)]">
            {thread.subject || "(no subject)"}
          </p>

          {!compact && thread.preview && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--color-faint)]">
              {thread.previewDirection === "incoming" ? "↩ " : ""}
              {thread.preview}
            </p>
          )}
        </button>
      </div>

      {/* Always mounted so the collapse animates in both directions. */}
      <div className="collapsible" data-open={expanded}>
        <div>
          <div className="space-y-4 border-t border-[var(--color-line)] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono text-[var(--color-muted)]">
                {thread.contactEmail}
              </span>

              {thread.openCount > 0 && (
                <span
                  className="text-[var(--color-faint)]"
                  // Same locale problem as RelativeTime: withheld until mount.
                  title={
                    mounted
                      ? `First pixel load ${fullTime(thread.firstOpenedAt)}. Proxies and privacy prefetch make this approximate.`
                      : undefined
                  }
                >
                  opened {thread.openCount}×
                </span>
              )}

              <select
                aria-label="Folder"
                value={thread.folderId ?? ""}
                onChange={(e) => {
                  const value = e.target.value || null;
                  onUpdate([thread.id], { folderId: value }, { folderId: value });
                }}
                className="field ml-auto rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px]"
              >
                <option value="">Unfiled</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() =>
                  onUpdate(
                    [thread.id],
                    { archived: !thread.archived },
                    { archived: !thread.archived },
                  )
                }
                className="pressable rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px]"
              >
                {thread.archived ? "Unarchive" : "Archive"}
              </button>
            </div>

            {tagLabels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {tagLabels.map((t) => {
                  const on = thread.tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() =>
                        onUpdate(
                          [thread.id],
                          on ? { removeTag: t.id } : { addTag: t.id },
                          (cur) => ({
                            tagIds: on
                              ? cur.tagIds.filter((x) => x !== t.id)
                              : [...cur.tagIds, t.id],
                          }),
                        )
                      }
                      aria-pressed={on}
                      className="chip pressable pressable-subtle inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                      style={{
                        borderColor: on ? colorHex(t.color) : "var(--color-line)",
                        color: on ? colorHex(t.color) : "var(--color-faint)",
                      }}
                    >
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{
                          background: on ? colorHex(t.color) : "var(--color-line)",
                        }}
                      />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}

            {loading && (
              <p className="flex items-center gap-2 text-[12px] text-[var(--color-muted)]">
                <Spinner /> Loading the conversation
              </p>
            )}

            {loadError && <p className="text-[12px] text-red-700">{loadError}</p>}

            {detail && (
              <>
                <ol className="space-y-2">
                  {detail.messages.map((m) => (
                    <Message key={m.id} message={m} />
                  ))}
                </ol>

                {detail.messages.length === 0 && (
                  <p className="text-[12px] text-[var(--color-faint)]">
                    Nothing recorded in this conversation yet.
                  </p>
                )}

                {!canReadMail && (
                  <p className="text-[11px] text-[var(--color-faint)]">
                    New replies will not appear here — the connected account can
                    send but not read mail.
                  </p>
                )}

                {detail.pending.map((p) => (
                  <Pending
                    key={p.id}
                    pending={p}
                    onCancel={() => void cancelPending(p.id)}
                  />
                ))}

                <div className="space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
                      Follow up
                    </p>
                    <p className="font-mono text-[11px] text-[var(--color-muted)]">
                      {subject}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={intent}
                      onChange={(e) => setIntent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void draftFollowup();
                        }
                      }}
                      disabled={drafting}
                      placeholder="offer a shorter call, mention the new paper, take the hint and close it out…"
                      className="field min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px]"
                    />
                    <button
                      type="button"
                      onClick={() => void draftFollowup()}
                      disabled={drafting}
                      className="pressable shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40"
                    >
                      <span className="flex items-center gap-1.5">
                        {drafting && <Spinner />}
                        <Swap
                          showing={drafting ? "b" : "a"}
                          a={body ? "Redraft" : "Draft"}
                          b="Writing"
                        />
                      </span>
                    </button>
                  </div>

                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={body ? 8 : 3}
                    placeholder="Write it yourself, or let the model draft one from the thread above."
                    className="field w-full resize-y rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs leading-relaxed"
                  />

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
                    <label htmlFor={`fu-when-${thread.id}`}>Send</label>
                    <select
                      id={`fu-when-${thread.id}`}
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
                      className="field rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[11px]"
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
                        className="field rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[11px]"
                      />
                    )}

                    {mode === "peak" && (
                      <span className="text-[10px] text-[var(--color-faint)]">
                        Next Tue&ndash;Thu mid-morning, your timezone
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => void sendFollowup()}
                      disabled={sendDisabled}
                      className="pressable ml-auto rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                    >
                      <span className="flex items-center gap-1.5">
                        {send.status === "sending" && <Spinner />}
                        {sendLabel(send.status, mode)}
                      </span>
                    </button>
                  </div>

                  {send.status === "scheduled" && send.message && (
                    <p className="text-[11px] text-[var(--color-muted)]">
                      Queued for {send.message}.
                    </p>
                  )}
                  {send.status === "error" && (
                    <p className="text-[11px] text-red-700">{send.message}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function sendLabel(status: SendStatus, mode: "now" | "at" | "peak"): string {
  if (status === "sending") return "Sending";
  if (status === "sent") return "Sent";
  if (status === "scheduled") return "Scheduled";
  return mode === "now" ? "Send" : "Schedule";
}

function Message({ message }: { message: MessageView }) {
  const incoming = message.direction === "incoming";
  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        incoming
          ? "border-[#cfe0d8] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-paper)]"
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[11px]">
        <span className="font-medium">
          {incoming ? (message.fromName ?? message.fromAddress) : "You"}
        </span>
        <span className="text-[var(--color-faint)]">{fullTime(message.sentAt)}</span>
      </div>

      {/* Sanitized in lib/gmail/read.ts before it was ever stored: scripts,
          styles and images are already gone. Rendering it as markup is what
          makes a formatted reply readable instead of a wall of tags. */}
      {incoming && message.html ? (
        <div
          className="prose-reply text-[12px] leading-relaxed break-words"
          dangerouslySetInnerHTML={{ __html: message.html }}
        />
      ) : (
        <p className="text-[12px] leading-relaxed whitespace-pre-wrap">
          {message.text || message.snippet}
        </p>
      )}
    </li>
  );
}

function Pending({
  pending,
  onCancel,
}: {
  pending: PendingView;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
        <span className="font-medium text-amber-900">Queued</span>
        <span className="text-amber-800">{fullTime(pending.scheduledAt)}</span>
        <button
          type="button"
          onClick={onCancel}
          className="pressable pressable-subtle ml-auto rounded px-1.5 py-0.5 text-[11px] text-amber-900 hover:text-red-700"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed whitespace-pre-wrap text-amber-950">
        {pending.body}
      </p>
      {pending.error && (
        <p className="mt-1 text-[11px] text-red-700">{pending.error}</p>
      )}
    </div>
  );
}
