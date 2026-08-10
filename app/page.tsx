import Link from "next/link";
import { all } from "@/lib/db";
import { getProfile } from "@/lib/profile";
import { listTemplates } from "@/lib/templates";
import { senderVars } from "@/lib/template-fill";
import SearchBox from "./search-box";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  query: string;
  status: string;
  created_at: string;
  people: number;
}

export default async function HomePage() {
  const recent = await all<Row>(
    `SELECT s.id, s.query, s.status, s.created_at,
            (SELECT COUNT(*) FROM people p WHERE p.search_id = s.id) AS people
     FROM searches s ORDER BY s.created_at DESC LIMIT 8`,
  );
  const templates = await listTemplates();
  const sender = senderVars(await getProfile());

  return (
    <div className="space-y-9">
      <div className="enter">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance">
          Who are you trying to reach?
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
          Describe them in plain English. Academic searches run on OpenAlex and
          work best.
        </p>
      </div>

      <SearchBox templates={templates} sender={sender} />

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-[var(--color-faint)] uppercase">
            Recent
          </h2>
          <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            {recent.map((r, i) => (
              <li
                key={r.id}
                className="enter"
                style={{ "--enter-delay": `${i * 30}ms` } as React.CSSProperties}
              >
                <Link
                  href={`/results/${r.id}`}
                  className="pressable pressable-subtle flex items-center justify-between gap-4 px-4 py-2.5 text-[13px] hover:bg-[var(--color-paper)]"
                >
                  <span className="truncate">{r.query}</span>
                  <span
                    className={`shrink-0 text-[11px] tabular-nums ${
                      r.status === "error"
                        ? "text-red-600"
                        : "text-[var(--color-faint)]"
                    }`}
                  >
                    {r.status === "error" ? "failed" : `${r.people}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
