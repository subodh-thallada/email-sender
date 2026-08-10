import Link from "next/link";
import { notFound } from "next/navigation";
import { all, one } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { openStatsFor } from "@/lib/send/tracking";
import ResultsList from "./results-list";
import type { OpenInfo } from "../../person-card";
import type { Dossier, EmailConfidence, EmailSource, PersonPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SearchRow {
  id: string;
  query: string;
  status: string;
  error: string | null;
  created_at: string;
}

interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  org: string | null;
  dept: string | null;
  homepage: string | null;
  dossier: string | null;
  score: number;
}

interface EmailRow {
  person_id: string;
  address: string;
  source: string;
  confidence: string;
  mx_ok: number | null;
  evidence: string | null;
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ searchId: string }>;
}) {
  const { searchId } = await params;

  const search = await one<SearchRow>(
    "SELECT id, query, status, error, created_at FROM searches WHERE id = ?",
    [searchId],
  );
  if (!search) notFound();

  const rows = await all<PersonRow>(
    `SELECT id, name, title, org, dept, homepage, dossier, score
     FROM people WHERE search_id = ? ORDER BY rank`,
    [searchId],
  );

  const emailRows = rows.length
    ? await all<EmailRow>(
        `SELECT person_id, address, source, confidence, mx_ok, evidence
         FROM emails WHERE person_id IN (${rows.map(() => "?").join(",")})`,
        rows.map((r) => r.id),
      )
    : [];

  const byPerson = new Map<string, EmailRow[]>();
  for (const e of emailRows) {
    const list = byPerson.get(e.person_id) ?? [];
    list.push(e);
    byPerson.set(e.person_id, list);
  }

  const people: PersonPayload[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    org: r.org,
    dept: r.dept,
    homepage: r.homepage,
    score: Number(r.score),
    dossier: parseDossier(r.dossier),
    emails: (byPerson.get(r.id) ?? []).map((e) => ({
      address: e.address,
      source: e.source as EmailSource,
      confidence: e.confidence as EmailConfidence,
      mxOk: e.mx_ok === null ? null : e.mx_ok === 1,
      evidence: e.evidence,
    })),
  }));

  const withEmail = people.filter((p) => p.emails.length > 0).length;

  // Drafts survive a reload, so a bulk run is not lost by navigating away.
  // One row per person — the bulk writer overwrites rather than appending.
  const ids = rows.map((r) => r.id);
  const draftRows = ids.length
    ? await all<{ person_id: string; subject: string; body: string }>(
        `SELECT person_id, subject, body FROM drafts
         WHERE person_id IN (${ids.map(() => "?").join(",")})
         ORDER BY updated_at`,
        ids,
      )
    : [];
  const drafts = Object.fromEntries(
    draftRows.map((d) => [d.person_id, { subject: d.subject, body: d.body }]),
  );

  const openStats = await openStatsFor(ids);
  const opens: Record<string, OpenInfo> = Object.fromEntries(
    [...openStats.values()].map((s) => [
      s.personId,
      { count: s.openCount, firstAt: s.firstOpenedAt },
    ]),
  );

  const { bulkDraftLimit } = await getSettings();

  return (
    <div className="space-y-6">
      <div className="enter">
        <Link
          href="/"
          className="pressable pressable-subtle -mx-1 inline-block rounded px-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          &larr; New search
        </Link>
        <h1 className="mt-2 text-xl leading-snug font-semibold tracking-tight text-balance">
          {search.query}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-muted)]">
          {people.length} {people.length === 1 ? "person" : "people"} ·{" "}
          {withEmail} with an address
          {people.length > 0 &&
            ` (${Math.round((withEmail / people.length) * 100)}%)`}
        </p>
      </div>

      {search.status === "error" && (
        <p className="enter rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {search.error ?? "This search failed."}
        </p>
      )}

      {/* Everything is present at first paint here, so the cascade has to be
          authored. ResultsList passes each card its index for the 40ms
          per-item entry delay. */}
      <ResultsList
        people={people}
        drafts={drafts}
        opens={opens}
        bulkLimit={bulkDraftLimit}
      />
    </div>
  );
}

function parseDossier(raw: string | null): Dossier | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Dossier;
  } catch {
    return null;
  }
}
