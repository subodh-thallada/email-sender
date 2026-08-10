import pLimit from "p-limit";
import { all, newId, nowStamp, run } from "@/lib/db";
import { getProfile, profileIsUsable } from "@/lib/profile";
import { writeEmail } from "@/lib/ai/write-email";
import { getSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import type { Dossier } from "@/lib/types";

export const runtime = "nodejs";
/** Twenty sequential-ish drafts against a slow free model is minutes, not seconds. */
export const maxDuration = 300;

interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  org: string | null;
  dossier: string | null;
}

export interface BulkDraftResult {
  personId: string;
  subject?: string;
  body?: string;
  error?: string;
}

/**
 * Drafts for many people in one request.
 *
 * Unlike /api/draft this does not stream: there is no single body to stream
 * into, and the useful unit of progress is a finished email rather than a
 * token. Each draft is written and persisted independently, so one failure
 * costs one person rather than the batch.
 */
export async function POST(req: Request) {
  const denied = await requireUser();
  if (denied) return denied;

  const { personIds } = (await req.json()) as { personIds?: string[] };

  if (!Array.isArray(personIds) || personIds.length === 0) {
    return Response.json(
      { ok: false, error: "Select at least one person." },
      { status: 400 },
    );
  }

  const profile = await getProfile();
  if (!profileIsUsable(profile)) {
    return Response.json(
      {
        ok: false,
        error:
          "Fill in your profile on the Settings page first — without a name and either a background or an offer, the drafts have nothing real to work with.",
      },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  const ids = [...new Set(personIds)].slice(0, settings.bulkDraftLimit);
  const dropped = new Set(personIds).size - ids.length;

  const rows = await all<PersonRow>(
    `SELECT id, name, title, org, dossier FROM people
     WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Concurrency is deliberately well under the batch size: providers rate-limit
  // per minute, and a burst of twenty is the fastest way to get 429s on every
  // one of them.
  const limit = pLimit(Math.max(1, settings.bulkDraftConcurrency));

  const results = await Promise.all(
    ids.map((id) =>
      limit(async (): Promise<BulkDraftResult> => {
        const person = byId.get(id);
        if (!person) return { personId: id, error: "Unknown person." };

        try {
          const { subject, body } = await writeEmail(
            profile,
            { name: person.name, title: person.title, org: person.org },
            parseDossier(person.dossier),
          );
          await saveDraft(id, subject, body);
          return { personId: id, subject, body };
        } catch (err) {
          return {
            personId: id,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    ),
  );

  return Response.json({
    ok: true,
    results,
    drafted: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    dropped,
    limit: settings.bulkDraftLimit,
  });
}

/**
 * One draft row per person, overwritten on redraft. Keeping a history would
 * mean the results page has to choose between versions, and nothing in the app
 * ever asks for the previous one.
 */
async function saveDraft(
  personId: string,
  subject: string,
  body: string,
): Promise<void> {
  const now = nowStamp();
  const existing = await all<{ id: string }>(
    "SELECT id FROM drafts WHERE person_id = ? ORDER BY created_at DESC LIMIT 1",
    [personId],
  );

  if (existing[0]) {
    await run(
      "UPDATE drafts SET subject = ?, body = ?, edited = 0, updated_at = ? WHERE id = ?",
      [subject, body, now, existing[0].id],
    );
    return;
  }

  await run(
    `INSERT INTO drafts (id, person_id, subject, body, edited, created_at, updated_at)
     VALUES (?,?,?,?,0,?,?)`,
    [newId("d"), personId, subject, body, now, now],
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
