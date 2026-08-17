"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sign out used to sit in the nav row, styled like the links either side of it,
 * one pixel-perfect click away from Settings. Nav links are cheap to get wrong
 * — you land on the wrong page and press back. Sign out is not: it ends the
 * session and costs a round trip through Google to undo. Sitting them together
 * priced the two the same.
 *
 * So it moves behind an avatar: a target that reads as "account", not as a
 * fifth destination, and that takes two deliberate actions to fire. The menu
 * also gives the address somewhere to live — it was previously a `title`
 * attribute, invisible unless you hovered and waited.
 */
export default function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Escape without this leaves focus on a hidden element, which strands
      // keyboard users at the top of the document on the next Tab.
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${email}`}
        data-open={open}
        className="pressable grid size-7 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] text-[11px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] data-[open=true]:border-[var(--color-accent)] data-[open=true]:bg-[var(--color-accent-soft)] data-[open=true]:text-[var(--color-accent)]"
      >
        {initial}
      </button>

      {/* Rendered always, toggled by opacity: the menu can then transition out
          as well as in, and its width never reflows the header on open. */}
      <div
        role="menu"
        aria-label="Account"
        data-open={open}
        // A hidden menu still takes Tab stops and still answers clicks, so it
        // is removed from both until it is actually on screen.
        inert={!open || undefined}
        className="menu absolute right-0 top-[calc(100%+8px)] z-50 min-w-56 origin-top-right rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-[0_8px_28px_-12px_rgba(20,22,26,0.28)]"
      >
        <p className="truncate px-2.5 pb-1.5 pt-2 text-[11px] text-[var(--color-faint)]">
          Signed in as
        </p>
        <p className="truncate px-2.5 pb-2 text-[13px] font-medium text-[var(--color-ink)]">
          {email}
        </p>
        <div className="mx-1 border-t border-[var(--color-line)]" />
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            role="menuitem"
            className="pressable pressable-subtle mt-1 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
