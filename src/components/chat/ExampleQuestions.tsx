"use client";

/** First four match the FDE exam sample questions; extras cover follow-ups / scoping. */
const EXAMPLES = [
  {
    short: "New England ranking",
    full: "Which airports in New England are strong candidates for terminal expansion?",
  },
  {
    short: "LA vs Santa Ana congestion",
    full: "Compare LA and Santa Ana airport congestion levels.",
  },
  {
    short: "Anchorage long-haul %",
    full: "What is the percentage of long haul flights out of Anchorage airport?",
  },
  {
    short: "SFO unmet demand",
    full: "What is the unmet flight demand in SFO airport and why?",
  },
  {
    short: "BOS vs JFK",
    full: "Compare BOS and JFK.",
  },
  {
    short: "Assumptions",
    full: "What assumptions are you making?",
  },
  {
    short: "Data freshness",
    full: "Until when is your aviation data current, and which periods are loaded?",
  },
];

type Props = {
  onSelect: (question: string) => void;
  disabled?: boolean;
  variant?: "sidebar" | "chips";
};

export function ExampleQuestions({
  onSelect,
  disabled,
  variant = "sidebar",
}: Props) {
  if (variant === "chips") {
    return (
      <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
        {EXAMPLES.map((item) => (
          <button
            key={item.full}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(item.full)}
            className="max-w-full rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/90 px-3 py-1.5 text-left text-[11px] leading-snug text-[var(--text)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50 sm:px-3.5 sm:py-2 sm:text-xs md:text-sm"
          >
            {item.short}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
          Try asking
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Click to send as a chat message
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {EXAMPLES.map((item) => (
          <button
            key={item.full}
            type="button"
            disabled={disabled}
            title={item.full}
            onClick={() => onSelect(item.full)}
            className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/80 px-3 py-2.5 text-left text-sm leading-snug text-[var(--text)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            <span className="block font-medium">{item.short}</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)] line-clamp-2">
              {item.full}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
