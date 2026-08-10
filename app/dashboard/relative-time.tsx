"use client";

import { useEffect, useState } from "react";
import { fullTime, shortAgo } from "./utils";

/**
 * True once the component has mounted in the browser.
 *
 * The gate exists for anything whose value the server cannot know: how long ago
 * "now" was, and how the reader's locale spells 7am. Node and the browser
 * disagree on both — Node renders "7:00 AM", Chrome renders "7:00 a.m." — and
 * React does not patch up mismatched *attributes* after a hydration error, so a
 * `title` rendered on the server would stay wrong for the life of the page.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** "3d", with the full local timestamp on hover. */
export default function RelativeTime({
  stamp,
  className = "",
}: {
  stamp: string | null;
  className?: string;
}) {
  const mounted = useMounted();
  return (
    <span className={className} title={mounted ? fullTime(stamp) : undefined}>
      {/* A non-breaking space before mount so the row does not change height
          when the real value arrives. */}
      {mounted ? shortAgo(stamp) : " "}
    </span>
  );
}
