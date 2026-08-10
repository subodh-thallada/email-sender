import pLimit from "p-limit";
import { parseQuery } from "./ai/parse-query";
import { rerank } from "./ai/rerank";
import { newId, run } from "./db";
import { discoverAcademic } from "./discover/academic";
import { addressesInText, discoverDirect } from "./discover/direct";
import { discoverPerson } from "./email/discover";
import type {
  Candidate,
  Dossier,
  FoundEmail,
  PersonPayload,
  SearchEvent,
} from "./types";

const ENRICH_CONCURRENCY = 4;

export async function runSearch(
  query: string,
  emit: (e: SearchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const searchId = newId("s");
  await run("INSERT INTO searches (id, query) VALUES (?, ?)", [searchId, query]);

  try {
    // Fast path: the query already contains addresses, so there is nothing to
    // look up. Costs one small LLM call and zero search-API quota.
    const supplied = addressesInText(query);
    if (supplied.length > 0) {
      await run("UPDATE searches SET route = 'direct' WHERE id = ?", [searchId]);
      const rows = await discoverDirect(query, (m) =>
        emit({ type: "status", message: m }),
      );
      emit({ type: "candidates", count: rows.length });

      for (let i = 0; i < rows.length; i++) {
        const { candidate, dossier, emails } = rows[i];
        emit({
          type: "person",
          person: await persist(searchId, i, candidate, dossier, emails),
        });
      }

      await run("UPDATE searches SET status = 'done' WHERE id = ?", [searchId]);
      emit({ type: "done", searchId, count: rows.length });
      return;
    }

    emit({ type: "status", message: "Reading your query…" });
    const intent = await parseQuery(query);
    await run("UPDATE searches SET intent = ?, route = ? WHERE id = ?", [
      JSON.stringify(intent),
      intent.route,
      searchId,
    ]);
    emit({ type: "intent", intent });

    if (intent.route !== "academic") {
      throw new Error(
        `This build only handles academic searches. That query looks like a "${intent.route}" search — try naming a university and a research area, or paste the addresses directly.`,
      );
    }

    let candidates: Candidate[] = await discoverAcademic(intent, (m) =>
      emit({ type: "status", message: m }),
    );
    if (candidates.length === 0) {
      throw new Error("No researchers matched those filters.");
    }

    emit({
      type: "status",
      message: `Filtering ${candidates.length} candidates…`,
    });
    candidates = (await rerank(intent, candidates)).slice(0, intent.limit);

    if (candidates.length === 0) {
      throw new Error(
        "Every candidate was filtered out — the affiliations in the source data may all be stale. Try a broader topic.",
      );
    }

    emit({ type: "candidates", count: candidates.length });

    const limit = pLimit(ENRICH_CONCURRENCY);
    let done = 0;

    await Promise.all(
      candidates.map((c, i) =>
        limit(async () => {
          if (signal?.aborted) return;
          try {
            const { dossier, emails } = await discoverPerson(c);
            emit({
              type: "person",
              person: await persist(searchId, i, c, dossier, emails),
            });
          } catch (err) {
            // One person failing must not sink the whole search.
            console.error(`enrich failed for ${c.name}:`, err);
          } finally {
            done += 1;
            emit({
              type: "status",
              message: `Enriched ${done}/${candidates.length}…`,
            });
          }
        }),
      ),
    );

    await run("UPDATE searches SET status = 'done' WHERE id = ?", [searchId]);
    emit({ type: "done", searchId, count: candidates.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run("UPDATE searches SET status = 'error', error = ? WHERE id = ?", [
      message,
      searchId,
    ]);
    emit({ type: "error", message });
  }
}

async function persist(
  searchId: string,
  rank: number,
  c: Candidate,
  dossier: Dossier,
  emails: FoundEmail[],
): Promise<PersonPayload> {
  const personId = newId("p");

  await run(
    `INSERT INTO people (id, search_id, name, title, org, dept, location,
       homepage, openalex_id, orcid, works_count, cited_by, dossier, score, rank)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      personId,
      searchId,
      c.name,
      dossier.title,
      c.org,
      dossier.dept,
      dossier.location,
      dossier.homepage,
      c.openalexId,
      c.orcid,
      c.worksCount,
      c.citedBy,
      JSON.stringify(dossier),
      c.score,
      rank,
    ],
  );

  for (const e of emails) {
    await run(
      `INSERT OR IGNORE INTO emails
         (id, person_id, address, source, confidence, mx_ok, evidence)
       VALUES (?,?,?,?,?,?,?)`,
      [
        newId("e"),
        personId,
        e.address,
        e.source,
        e.confidence,
        e.mxOk === null ? null : e.mxOk ? 1 : 0,
        e.evidence,
      ],
    );
  }

  return {
    id: personId,
    name: c.name,
    title: dossier.title,
    org: c.org,
    dept: dossier.dept,
    homepage: dossier.homepage,
    score: c.score,
    dossier,
    emails,
  };
}
