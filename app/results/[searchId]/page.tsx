import Link from "next/link";
import { notFound } from "next/navigation";
import { all, one } from "@/lib/db";
import PersonCard from "../../person-card";
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

      <div className="space-y-3">
        {/* Everything is present at first paint here, so the cascade has to be
            authored. Index drives a 40ms-per-item entry delay. */}
        {people.map((p, i) => (
          <PersonCard key={p.id} person={p} index={i} />
        ))}
      </div>
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
