"use client";

import { useState } from "react";
import {
  LABEL_COLOR_KEYS,
  colorHex,
  type LabelKind,
  type LabelView,
  type ThreadView,
} from "@/lib/threads/types";

/**
 * Folders and tags, as two rows of chips you can filter by and edit in place.
 *
 * A folder is the one bucket a conversation lives in; tags are free-form and
 * stack. Both are edited here rather than on a settings page — you find out you
 * need a folder while looking at the thing that belongs in it.
 */
export default function LabelBar({
  labels,
  onLabelsChange,
  folder,
  onFolderChange,
  tags,
  onTagsChange,
  counts,
}: {
  labels: LabelView[];
  onLabelsChange: (next: LabelView[]) => void;
  folder: "all" | "unfiled" | string;
  onFolderChange: (next: "all" | "unfiled" | string) => void;
  tags: Set<string>;
  onTagsChange: (next: Set<string>) => void;
  /** The currently visible threads, for the per-label counts. */
  counts: ThreadView[];
}) {
  const [adding, setAdding] = useState<LabelKind | null>(null);
  const [name, setName] = useState("");
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folders = labels.filter((l) => l.kind === "folder");
  const tagLabels = labels.filter((l) => l.kind === "tag");

  const unfiled = counts.filter((t) => !t.folderId).length;
  const folderCount = (id: string) =>
    counts.filter((t) => t.folderId === id).length;
  const tagCount = (id: string) => counts.filter((t) => t.tagIds.includes(id)).length;

  async function create(kind: LabelKind) {
    const trimmed = name.trim();
    if (!trimmed) {
      setAdding(null);
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          kind,
          name: trimmed,
          // Cycled by position so a new label is visually distinct from the
          // last one without anyone having to pick a colour.
          color:
            LABEL_COLOR_KEYS[
              labels.filter((l) => l.kind === kind).length % LABEL_COLOR_KEYS.length
            ],
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        label?: LabelView;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.label) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (!labels.some((l) => l.id === data.label!.id)) {
        onLabelsChange([...labels, data.label]);
      }
      setName("");
      setAdding(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(label: LabelView) {
    onLabelsChange(labels.filter((l) => l.id !== label.id));
    if (folder === label.id) onFolderChange("all");
    if (tags.has(label.id)) {
      const next = new Set(tags);
      next.delete(label.id);
      onTagsChange(next);
    }
    await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: label.id }),
    }).catch(() => {});
  }

  function toggleTag(id: string) {
    const next = new Set(tags);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onTagsChange(next);
  }

  const chip =
    "chip pressable pressable-subtle inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]";
  const off =
    "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[10px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
          Folders
        </span>

        <button
          type="button"
          onClick={() => onFolderChange("all")}
          className={`${chip} ${
            folder === "all"
              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : off
          }`}
        >
          All
        </button>

        {unfiled > 0 && (
          <button
            type="button"
            onClick={() => onFolderChange("unfiled")}
            className={`${chip} ${
              folder === "unfiled"
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : off
            }`}
          >
            Unfiled
            <span className="tabular-nums opacity-60">{unfiled}</span>
          </button>
        )}

        {folders.map((f) => (
          <span key={f.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onFolderChange(folder === f.id ? "all" : f.id)}
              className={`${chip} ${off}`}
              style={
                folder === f.id
                  ? {
                      borderColor: colorHex(f.color),
                      color: colorHex(f.color),
                      background: "var(--color-surface)",
                    }
                  : undefined
              }
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: colorHex(f.color) }}
              />
              {f.name}
              <span className="tabular-nums opacity-60">{folderCount(f.id)}</span>
            </button>
            {managing && (
              <button
                type="button"
                onClick={() => void remove(f)}
                aria-label={`Delete folder ${f.name}`}
                title="Delete this folder. The conversations in it are kept."
                className="pressable pressable-subtle -ml-1 rounded px-1 text-[11px] text-[var(--color-faint)] hover:text-red-700"
              >
                ×
              </button>
            )}
          </span>
        ))}

        {adding === "folder" ? (
          <NameInput
            value={name}
            onChange={setName}
            onCommit={() => void create("folder")}
            onCancel={() => {
              setAdding(null);
              setName("");
            }}
            placeholder="Folder name"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding("folder");
              setName("");
            }}
            className={`${chip} ${off}`}
          >
            + Folder
          </button>
        )}

        {(folders.length > 0 || tagLabels.length > 0) && (
          <button
            type="button"
            onClick={() => setManaging((m) => !m)}
            className="pressable pressable-subtle ml-auto rounded px-1.5 py-1 text-[11px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
          >
            {managing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[10px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
          Tags
        </span>

        {tagLabels.map((t) => (
          <span key={t.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => toggleTag(t.id)}
              className={`${chip} ${off}`}
              style={
                tags.has(t.id)
                  ? { borderColor: colorHex(t.color), color: colorHex(t.color) }
                  : undefined
              }
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: colorHex(t.color) }}
              />
              {t.name}
              <span className="tabular-nums opacity-60">{tagCount(t.id)}</span>
            </button>
            {managing && (
              <button
                type="button"
                onClick={() => void remove(t)}
                aria-label={`Delete tag ${t.name}`}
                title="Delete this tag. The conversations carrying it are kept."
                className="pressable pressable-subtle -ml-1 rounded px-1 text-[11px] text-[var(--color-faint)] hover:text-red-700"
              >
                ×
              </button>
            )}
          </span>
        ))}

        {adding === "tag" ? (
          <NameInput
            value={name}
            onChange={setName}
            onCommit={() => void create("tag")}
            onCancel={() => {
              setAdding(null);
              setName("");
            }}
            placeholder="Tag name"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding("tag");
              setName("");
            }}
            className={`${chip} ${off}`}
          >
            + Tag
          </button>
        )}

        {tags.size > 0 && (
          <button
            type="button"
            onClick={() => onTagsChange(new Set())}
            className="pressable pressable-subtle rounded px-1.5 py-1 text-[11px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
          >
            Clear tags
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}

function NameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder: string;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
        if (e.key === "Escape") onCancel();
      }}
      // Committing on blur means clicking away saves rather than discarding,
      // which is what a one-field inline form should do.
      onBlur={onCommit}
      placeholder={placeholder}
      maxLength={40}
      className="field w-32 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px]"
    />
  );
}
