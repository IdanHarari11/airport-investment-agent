"use client";

import { useEffect, useState } from "react";

/** Rotating copy shown while the LLM drafts after tools finish (often the longest wait). */
const DRAFTING_TIPS = [
  "Drafting explanation from tool results…",
  "Turning tool numbers into an analyst narrative…",
  "Scores are already fixed — writing the reasoning…",
  "Adding assumptions, sources, and uncertainty notes…",
  "Almost ready — polishing the investment framing…",
] as const;

type Props = {
  workingStatus: string;
  isDrafting: boolean;
};

/**
 * Status line for the Working card. During the post-tool drafting wait,
 * rotates short explanations so a long LLM pause feels intentional.
 */
export function WorkingStatusLine({ workingStatus, isDrafting }: Props) {
  const [tipIndex, setTipIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!isDrafting) {
      setTipIndex(0);
      setVisible(true);
      return;
    }

    const intervalId = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % DRAFTING_TIPS.length);
        setVisible(true);
      }, 220);
    }, 2800);

    return () => window.clearInterval(intervalId);
  }, [isDrafting]);

  const text = isDrafting ? DRAFTING_TIPS[tipIndex] : workingStatus;

  return (
    <span
      className={`status-crossfade ml-2 min-w-0 text-xs text-[var(--muted)] ${
        visible ? "status-crossfade-in" : "status-crossfade-out"
      }`}
      aria-live="polite"
    >
      {text}
    </span>
  );
}
