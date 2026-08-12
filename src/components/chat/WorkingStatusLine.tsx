"use client";

import { useEffect, useState } from "react";

const DRAFTING_HINTS = [
  "Tools finished — writing a clear analyst explanation…",
  "Turning the numbers into investment language…",
  "Calling out assumptions and data periods…",
  "Packaging a concise answer for you…",
  "Still working — good answers take a few seconds…",
];

type Props = {
  /** Primary status when not in drafting rotation. */
  status: string;
  /** When true, cycle explanatory hints (LLM post-tool wait). */
  isDrafting: boolean;
};

/**
 * Status line for the Working card. During the post-tool LLM wait, rotates
 * short explanations so the pause feels intentional rather than stuck.
 */
export function WorkingStatusLine({ status, isDrafting }: Props) {
  const [hintIndex, setHintIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!isDrafting) {
      setHintIndex(0);
      setVisible(true);
      return;
    }

    const intervalMs = 2800;
    const fadeMs = 220;
    const id = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setHintIndex((prev) => (prev + 1) % DRAFTING_HINTS.length);
        setVisible(true);
      }, fadeMs);
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [isDrafting]);

  const text = isDrafting ? DRAFTING_HINTS[hintIndex] : status;

  return (
    <span
      className={`ml-2 min-w-0 text-xs text-[var(--muted)] transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
    >
      {text}
    </span>
  );
}
