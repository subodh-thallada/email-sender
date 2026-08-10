import { revalidatePath } from "next/cache";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
  type TemplateInput,
} from "@/lib/templates";
import { PLACEHOLDERS } from "@/lib/template-fill";
import TemplateForm from "./template-form";

export const dynamic = "force-dynamic";

function read(formData: FormData): TemplateInput {
  return {
    name: String(formData.get("name") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

async function create(formData: FormData) {
  "use server";
  await createTemplate(read(formData));
  revalidatePath("/templates");
}

async function save(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await updateTemplate(id, read(formData));
  revalidatePath("/templates");
}

async function remove(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteTemplate(id);
  revalidatePath("/templates");
}

const heading =
  "text-[11px] font-semibold uppercase tracking-widest text-[var(--color-faint)]";

export default async function TemplatesPage() {
  const templates = await listTemplates();

  return (
    <div className="space-y-10">
      <div className="enter">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
          Templates
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
          Saved emails you can drop into any draft. Pick one from the dropdown
          on a person&rsquo;s card &mdash; no template selected means a blank
          draft, exactly as before.
        </p>
      </div>

      <section
        className="enter"
        style={{ "--enter-delay": "40ms" } as React.CSSProperties}
      >
        <h2 className={heading}>Placeholders</h2>
        <ul className="mt-3 grid gap-x-6 gap-y-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 sm:grid-cols-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p.key} className="flex items-baseline gap-2 text-[11px]">
              <code className="shrink-0">{`{{${p.key}}}`}</code>
              <span className="truncate text-[var(--color-faint)]">
                {p.what}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
          Filled in the moment you pick the template. A placeholder this app
          does not know is left standing in the draft rather than blanked, so a
          typo is visible before you send it. Anything the recipient is missing
          &mdash; no department, say &mdash; simply disappears.
        </p>
      </section>

      <section
        className="enter"
        style={{ "--enter-delay": "60ms" } as React.CSSProperties}
      >
        <h2 className={heading}>
          {templates.length
            ? `Saved (${templates.length})`
            : "Nothing saved yet"}
        </h2>
        {templates.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--color-muted)]">
            Add one below and it appears in the dropdown on every result.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {templates.map((t) => (
              <TemplateForm
                key={t.id}
                template={t}
                saveAction={save}
                deleteAction={remove}
              />
            ))}
          </div>
        )}
      </section>

      <section
        className="enter"
        style={{ "--enter-delay": "80ms" } as React.CSSProperties}
      >
        <h2 className={heading}>New template</h2>
        <div className="mt-3">
          <TemplateForm saveAction={create} />
        </div>
      </section>
    </div>
  );
}
