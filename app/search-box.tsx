"use client";

import { useState } from "react";
import Link from "next/link";
import type { PersonPayload, SearchEvent } from "@/lib/types";
import PersonCard from "./person-card";
import { Spinner, Swap } from "./ui/bits";

const EXAMPLES = [
  "professors at University of Toronto who do robotics research",
  "machine learning faculty at Waterloo working on reinforcement learning",
  "computational biology PIs at UBC",
];

export default function SearchBox() {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [people, setPeople] = useState<PersonPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);

  async function run(q: string) {
    if (!q.trim() || running) return;
    setRunning(true);
    setPeople([]);
    setError(null);
    setSearchId(null);
    setTotal(0);
    setStatus("Reading your query");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: SearchEvent;
          try {
            evt = JSON.parse(line.slice(5).trim()) as SearchEvent;
          } catch {
            continue;
          }

          switch (evt.type) {
            case "status":
              setStatus(evt.message.replace(/…$/, ""));
              break;
            case "candidates":
              setTotal(evt.count);
              break;
            case "person":
              setPeople((prev) => [...prev, evt.person]);
              break;
            case "done":
              setSearchId(evt.searchId);
              setStatus(null);
              break;
            case "error":
              setError(evt.message);
              setStatus(null);
              break;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setStatus(null);
    }
  }

  const progress = total > 0 ? Math.min(people.length / total, 1) : 0;
  const withEmail = people.filter((p) => p.emails.length > 0).length;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="professors at University of Toronto who do robotics research"
          className="field min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm"
        />
        <button
          type="submit"
          disabled={running || !query.trim()}
          className="pressable shrink-0 rounded-lg bg-[var(--color-accent)] px-5 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          <span className="flex items-center gap-2">
            {running && <Spinner />}
            <Swap showing={running ? "b" : "a"} a="Search" b="Searching" />
          </span>
        </button>
      </form>

      {!running && people.length === 0 && !error && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex}
              onClick={() => {
                setQuery(ex);
                void run(ex);
              }}
              className="chip rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
              style={{ "--enter-delay": `${i * 40}ms` } as React.CSSProperties}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {status && (
        <div className="space-y-2">
          {/*
            The status string changes ~20 times per search, so it is
            deliberately not animated — a transition on every update would read
            as flicker, not polish.
          */}
          <p className="text-[13px] text-[var(--color-muted)]">
            {status}
            {total > 0 && (
              <span className="ml-1.5 tabular-nums text-[var(--color-faint)]">
                {people.length}/{total}
              </span>
            )}
          </p>
          <div className="h-0.5 overflow-hidden rounded-full bg-[var(--color-line)]">
            {/* scaleX, not width — width would trigger layout on every tick. */}
            <div
              className="h-full origin-left bg-[var(--color-accent)]"
              style={{
                transform: `scaleX(${total > 0 ? progress : 0.06})`,
                transition: "transform 300ms var(--ease-out)",
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="enter rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {people.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
              {people.length} {people.length === 1 ? "person" : "people"}
              <span className="ml-2 font-normal tracking-normal normal-case">
                {withEmail} with an address
              </span>
            </h2>
            {searchId && (
              <Link
                href={`/results/${searchId}`}
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                Full results &rarr;
              </Link>
            )}
          </div>
          {/* No stagger here: results arrive over the wire seconds apart, so
              the network already provides the cascade. */}
          {people.map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </section>
      )}
    </div>
  );
}
