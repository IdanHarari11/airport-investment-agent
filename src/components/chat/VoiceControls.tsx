"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stopElevenLabsAudio } from "@/lib/speech/elevenLabsClient";
import { detectLanguage } from "@/lib/speech/language";
import {
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  type SpeechRecognitionLike,
} from "@/lib/speech/webSpeech";

type Props = {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  /** Sticky BCP-47 language for mic (e.g. he-IL). */
  preferredLanguage?: string;
  onLanguageDetected?: (bcp47: string) => void;
};

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
    </svg>
  );
}

/** Mic-only controls for the chat composer (TTS lives on message actions). */
export function VoiceControls({
  disabled,
  onTranscript,
  preferredLanguage,
  onLanguageDetected,
}: Props) {
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Defer window/SpeechRecognition checks until after mount to avoid SSR hydration mismatch.
  const recognitionOk = mounted && isSpeechRecognitionSupported();
  const micLang = preferredLanguage || "en-US";

  useEffect(() => {
    setMounted(true);
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceError("Speech recognition is not supported in this browser.");
      return;
    }
    setVoiceError(null);
    // Pause any message TTS so mic input is clear.
    stopElevenLabsAudio();

    const recognition = new Ctor();
    recognition.lang = micLang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          finalText += result[0]?.transcript ?? "";
        }
      }
      if (finalText.trim()) {
        const text = finalText.trim();
        const detected = detectLanguage(text, micLang);
        onLanguageDetected?.(detected.bcp47);
        onTranscript(text);
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setVoiceError(`Voice input error: ${event.error}`);
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [micLang, onLanguageDetected, onTranscript]);

  const toggleListen = () => {
    if (disabled) return;
    if (listening) stopListening();
    else startListening();
  };

  if (!recognitionOk) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggleListen}
        disabled={disabled}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
          listening
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        }`}
        aria-label={listening ? "Stop voice input" : "Start voice input"}
        title={`Voice input (${micLang})`}
      >
        <MicIcon />
      </button>
      {listening && (
        <p className="text-[10px] text-[var(--accent)]">
          Listening ({micLang})…
        </p>
      )}
      {voiceError && (
        <p className="max-w-[12rem] text-right text-[10px] text-[var(--danger)]">
          {voiceError}
        </p>
      )}
    </div>
  );
}
