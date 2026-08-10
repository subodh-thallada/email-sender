"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Spinner, Swap } from "../ui/bits";

export default function SubmitButton() {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [saved, setSaved] = useState(false);

  // Confirm the write actually happened. A button that does nothing visible
  // on click leaves people wondering whether it took.
  useEffect(() => {
    if (wasPending.current && !pending) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 1800);
      wasPending.current = pending;
      return () => clearTimeout(t);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <button
      type="submit"
      disabled={pending}
      className="pressable rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      <span className="flex items-center gap-2">
        {pending && <Spinner />}
        <Swap
          showing={pending ? "b" : saved ? "b" : "a"}
          a="Save profile"
          b={pending ? "Saving" : "Saved"}
        />
      </span>
    </button>
  );
}
