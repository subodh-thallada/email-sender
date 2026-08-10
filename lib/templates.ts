import { all, newId, nowStamp, one, run } from "./db";
import type { TemplateSummary } from "./template-fill";

/**
 * Saved email templates.
 *
 * Storage only — the substitution rules live in lib/template-fill.ts so that
 * client components can share them without importing a database driver.
 */

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  notes: string;
}

/** Name is what the dropdown shows, so an unnamed template would be unpickable. */
function clean(t: TemplateInput): TemplateInput {
  return {
    name: t.name.trim().slice(0, 80) || "Untitled template",
    subject: t.subject.trim(),
    body: t.body.trim(),
    notes: t.notes.trim(),
  };
}

/** Alphabetical, case-insensitively — `lower()` is the one form both engines take. */
export async function listTemplates(): Promise<TemplateSummary[]> {
  return all<TemplateSummary>(
    "SELECT id, name, subject, body, notes FROM templates ORDER BY lower(name)",
  );
}

export async function getTemplate(
  id: string,
): Promise<TemplateSummary | null> {
  const row = await one<TemplateSummary>(
    "SELECT id, name, subject, body, notes FROM templates WHERE id = ?",
    [id],
  );
  return row ?? null;
}

export async function createTemplate(input: TemplateInput): Promise<string> {
  const t = clean(input);
  const id = newId("tpl");
  const now = nowStamp();
  await run(
    `INSERT INTO templates (id, name, subject, body, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, t.name, t.subject, t.body, t.notes, now, now],
  );
  return id;
}

export async function updateTemplate(
  id: string,
  input: TemplateInput,
): Promise<void> {
  const t = clean(input);
  await run(
    `UPDATE templates SET name = ?, subject = ?, body = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [t.name, t.subject, t.body, t.notes, nowStamp(), id],
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  await run("DELETE FROM templates WHERE id = ?", [id]);
}

export type { TemplateSummary };
