"use client";

import { useState, type ReactNode } from "react";
import {
  speakWithElevenLabs,
  stopElevenLabsAudio,
} from "@/lib/speech/elevenLabsClient";
import {
  ENGLISH_SPEAKER_TOOLTIP,
  isEnglishSpeechText,
} from "@/lib/speech/language";

type Props = {
  text: string;
  preferredLanguage?: string;
  disabled?: boolean;
  onRegenerate?: () => void;
};

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40 ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--muted)] hover:bg-[var(--bg)]/50 hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function SpeakerWaveIcon({ active }: { active?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {active ? (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
        </>
      ) : (
        <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
      )}
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.6-6.2" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function MessageActions({
  text,
  preferredLanguage,
  disabled,
  onRegenerate,
}: Props) {
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const speakerAvailable = isEnglishSpeechText(text);

  if (!text.trim()) return null;

  async function onPlay() {
    if (!speakerAvailable) return;
    if (speaking) {
      stopElevenLabsAudio();
      setSpeaking(false);
      setError(null);
      return;
    }
    setError(null);
    setNotice(null);
    setSpeaking(true);
    try {
      const result = await speakWithElevenLabs(text, preferredLanguage);
      if (result.truncated) {
        setNotice(
          "Audio covers the first 2500 characters of this answer.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Voice playback failed.",
      );
    } finally {
      setSpeaking(false);
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError(null);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy.");
    }
  }

  return (
    <div className="mt-2 border-t border-[var(--border)]/70 pt-2">
      <div className="flex items-center gap-0.5">
        {/* Wrapper keeps tooltip visible when the button is disabled. */}
        <span
          className="inline-flex"
          title={
            speakerAvailable
              ? speaking
                ? "Stop audio"
                : "Play audio (ElevenLabs)"
              : ENGLISH_SPEAKER_TOOLTIP
          }
        >
          <IconButton
            label={
              speakerAvailable
                ? speaking
                  ? "Stop audio"
                  : "Play audio (ElevenLabs)"
                : ENGLISH_SPEAKER_TOOLTIP
            }
            onClick={() => void onPlay()}
            disabled={disabled || !speakerAvailable}
            active={speaking}
          >
            <SpeakerWaveIcon active={speaking} />
          </IconButton>
        </span>

        <IconButton
          label={copied ? "Copied" : "Copy answer"}
          onClick={() => void onCopy()}
          disabled={disabled}
          active={copied}
        >
          <CopyIcon />
        </IconButton>

        {onRegenerate && (
          <IconButton
            label="Regenerate answer"
            onClick={onRegenerate}
            disabled={disabled}
          >
            <RegenerateIcon />
          </IconButton>
        )}
      </div>
      {notice && !error ? (
        <p className="mt-1 text-[10px] text-[var(--muted)]" title={notice}>
          {notice}
        </p>
      ) : null}
      {error && (
        <p className="mt-1 text-[10px] text-[var(--danger)]" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
