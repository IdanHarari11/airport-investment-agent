"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  getElevenLabsTtsState,
  speakWithElevenLabs,
  stopElevenLabsAudio,
  subscribeElevenLabsTts,
  type ElevenLabsTtsState,
} from "@/lib/speech/elevenLabsClient";
import {
  ENGLISH_SPEAKER_TOOLTIP,
  isEnglishSpeechText,
} from "@/lib/speech/language";

type Props = {
  text: string;
  /** Stable id for this message — used for global single-playback ownership. */
  messageId: string;
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

function SpeakerWaveIcon() {
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
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
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

function isOwnedActive(state: ElevenLabsTtsState, messageId: string): boolean {
  return state.ownerId === messageId && state.status !== "idle";
}

export function MessageActions({
  text,
  messageId,
  preferredLanguage,
  disabled,
  onRegenerate,
}: Props) {
  const [ttsState, setTtsState] = useState<ElevenLabsTtsState>(() =>
    getElevenLabsTtsState(),
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const speakerAvailable = isEnglishSpeechText(text);
  const active = isOwnedActive(ttsState, messageId);

  useEffect(() => subscribeElevenLabsTts(setTtsState), []);

  function onPlay() {
    if (!speakerAvailable) return;

    // Synchronous global gate: loading/playing on this message → stop.
    // A second play click never starts a parallel /api/tts.
    const current = getElevenLabsTtsState();
    if (isOwnedActive(current, messageId)) {
      stopElevenLabsAudio();
      setError(null);
      return;
    }

    setError(null);
    setNotice(null);

    void (async () => {
      try {
        const result = await speakWithElevenLabs(text, preferredLanguage, {
          ownerId: messageId,
        });
        if (result.truncated) {
          setNotice(
            "Audio covers the first 2500 characters of this answer.",
          );
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Voice playback failed.",
        );
      }
    })();
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
              ? active
                ? "Stop audio"
                : "Play audio (ElevenLabs)"
              : ENGLISH_SPEAKER_TOOLTIP
          }
        >
          <IconButton
            label={
              speakerAvailable
                ? active
                  ? "Stop audio"
                  : "Play audio (ElevenLabs)"
                : ENGLISH_SPEAKER_TOOLTIP
            }
            onClick={onPlay}
            disabled={disabled || !speakerAvailable}
            active={active}
          >
            {active ? <StopIcon /> : <SpeakerWaveIcon />}
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
