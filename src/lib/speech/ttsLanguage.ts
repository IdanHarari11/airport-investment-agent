import { detectLanguage, toIso639, type DetectedLanguage } from "./language";

/**
 * Language for TTS must follow the text being spoken (script), not the
 * sticky UI/mic preference — otherwise Hebrew answers play as English.
 */
export function resolveTtsLanguage(
  text: string,
  preferredLanguage?: string | null,
): DetectedLanguage {
  return detectLanguage(text, preferredLanguage ?? undefined);
}

/** Models that accept ElevenLabs `language_code` (ISO-639-1). */
export function modelSupportsLanguageCode(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("flash") || id.includes("turbo");
}

/**
 * Prefer flash/turbo + language_code for non-English scripts so pronunciation
 * is forced. multilingual_v2 auto-detects and ignores language_code.
 */
export function buildTtsAttempts(params: {
  configuredModel: string;
  language: string;
}): Array<{ modelId: string; language?: string }> {
  const language = toIso639(params.language);
  const configured = params.configuredModel.trim() || "eleven_multilingual_v2";
  const needsForcedLanguage = language !== "en";

  const attempts: Array<{ modelId: string; language?: string }> = [];
  const push = (modelId: string, lang?: string) => {
    if (attempts.some((a) => a.modelId === modelId && a.language === lang)) {
      return;
    }
    attempts.push({ modelId, language: lang });
  };

  if (needsForcedLanguage) {
    push("eleven_flash_v2_5", language);
    push("eleven_turbo_v2_5", language);
    if (modelSupportsLanguageCode(configured)) {
      push(configured, language);
    } else {
      push(configured);
    }
    push("eleven_multilingual_v2");
  } else {
    push(configured);
    if (configured !== "eleven_multilingual_v2") {
      push("eleven_multilingual_v2");
    }
    push("eleven_flash_v2_5", language);
  }

  return attempts;
}
