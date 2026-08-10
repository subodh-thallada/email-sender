"use client";

import { useEffect, useId, useRef, useState } from "react";

const OPEN_DELAY = 400;
/**
 * Once someone is demonstrably reading tooltips, the delay stops protecting
 * them from accidental activation and just makes the UI feel slow. Within this
 * window of the last one closing, the next opens instantly and without
 * animation. Module-level so every tooltip on the page shares the state.
 */
const INSTANT_WINDOW = 400;
let lastClosedAt = 0;

export default function Tooltip({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    const chained = Date.now() - lastClosedAt < INSTANT_WINDOW;
    setInstant(chained);
    if (chained) {
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    if (open) lastClosedAt = Date.now();
    setOpen(false);
  }

  if (!label) return <>{children}</>;

  return (
    <span
      className={`relative inline-flex ${className}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      <span
        id={id}
        role="tooltip"
        data-open={open}
        data-instant={instant}
        // Kept mounted so the exit transition can play.
        className="tooltip pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-72 -translate-x-1/2 rounded-md bg-[var(--color-ink)] px-2.5 py-1.5 text-left text-[11px] leading-snug font-normal text-white shadow-lg"
      >
        {label}
      </span>
    </span>
  );
}
