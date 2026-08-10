"use client";

import { useEffect, useRef, useState } from "react";

/** Fast on purpose: a quicker spinner makes the wait feel shorter. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={`spinner size-3.5 ${className}`}
      fill="none"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Two labels stacked in one grid cell, crossfading through a light blur.
 * Without the blur you see both strings at once and read it as two objects
 * swapping; with it, one label appears to become the other.
 */
export function Swap({
  showing,
  a,
  b,
}: {
  showing: "a" | "b";
  a: React.ReactNode;
  b: React.ReactNode;
}) {
  return (
    <span className="swap">
      <span data-visible={showing === "a"}>{a}</span>
      <span data-visible={showing === "b"} aria-hidden={showing !== "b"}>
        {b}
      </span>
    </span>
  );
}

export function CopyButton({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy ${value}`}
      className={`pressable pressable-subtle rounded px-1 py-0.5 text-left font-mono text-xs hover:bg-[var(--color-accent-soft)] ${className}`}
    >
      <Swap
        showing={copied ? "b" : "a"}
        a={value}
        b={<span className="text-[var(--color-accent)]">Copied</span>}
      />
    </button>
  );
}
