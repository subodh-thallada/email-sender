"use client";

import { useRef, useState } from "react";
import SubmitButton from "../ui/submit-button";
import type { TemplateSummary } from "@/lib/template-fill";

const field =
  "field w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm";
const label = "block text-[13px] font-medium mb-1.5";
const hint = "mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]";

/**
 * One template, editable in place. Also serves as the blank "new template"
 * form when `template` is null, so the two never drift apart in layout or in
 * which fields they offer.
 *
 * Uncontrolled inputs: nothing writes into these fields except the person
 * typing, so holding a copy in state would only add a way for the two to
 * disagree. The new-template form is reset by hand once the server accepts it.
 */
export default function TemplateForm({
  template = null,
  saveAction,
  deleteAction,
}: {
  template?: TemplateSummary | null;
  saveAction: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
}) {
  const isNew = template === null;
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <form
      ref={formRef}
      action={async (formData: FormData) => {
        await saveAction(formData);
        // A create form that keeps its text looks like it failed to save.
        if (isNew) formRef.current?.reset();
      }}
      className="space-y-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      {template && <input type="hidden" name="id" value={template.id} />}

      <div>
        <label className={label} htmlFor={`name-${template?.id ?? "new"}`}>
          Name
        </label>
        <input
          id={`name-${template?.id ?? "new"}`}
          name="name"
          defaultValue={template?.name ?? ""}
          placeholder="Research intro"
          className={field}
        />
        <p className={hint}>What the dropdown shows. Only you ever see it.</p>
      </div>

      <div>
        <label className={label} htmlFor={`subject-${template?.id ?? "new"}`}>
          Subject
        </label>
        <input
          id={`subject-${template?.id ?? "new"}`}
          name="subject"
          defaultValue={template?.subject ?? ""}
          placeholder="Question about your {{dept}} lab"
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor={`body-${template?.id ?? "new"}`}>
          Body
        </label>
        <textarea
          id={`body-${template?.id ?? "new"}`}
          name="body"
          defaultValue={template?.body ?? ""}
          rows={isNew ? 8 : 12}
          placeholder={"Hi {{first_name}},\n\n…\n\n{{signature}}"}
          className={`${field} resize-y font-mono text-xs leading-relaxed`}
        />
      </div>

      <details className="group">
        <summary className="cursor-pointer text-[12px] text-[var(--color-muted)] select-none hover:text-[var(--color-ink)]">
          Notes for the writer model
        </summary>
        <div className="mt-2">
          <textarea
            name="notes"
            defaultValue={template?.notes ?? ""}
            rows={3}
            placeholder="Keep the second paragraph, swap the example for one from their own field."
            className={`${field} resize-y text-[13px]`}
          />
          <p className={hint}>
            Only used when you press Draft email with this template selected.
            The text above is followed either way.
          </p>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <SubmitButton label={isNew ? "Add template" : "Save"} />

        {deleteAction && template && (
          <>
            {confirming ? (
              <>
                <button
                  type="submit"
                  formAction={deleteAction}
                  className="pressable rounded-md bg-amber-700 px-3 py-2 text-[12px] font-medium text-white"
                >
                  Delete for good
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="pressable pressable-subtle rounded-md px-2 py-1 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="pressable pressable-subtle ml-auto rounded-md px-2 py-1 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
