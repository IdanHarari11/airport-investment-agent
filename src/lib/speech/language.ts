export type DetectedLanguage = {
  /** BCP-47, e.g. he-IL */
  bcp47: string;
  /** ISO-639-1, e.g. he — for ElevenLabs language_code */
  iso639: string;
  /** English label for agent instructions */
  label: string;
};

const LABELS: Record<string, string> = {
  he: "Hebrew",
  en: "English",
  ar: "Arabic",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  hi: "Hindi",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
};

const BCP47: Record<string, string> = {
  he: "he-IL",
  en: "en-US",
  ar: "ar-SA",
  ru: "ru-RU",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-BR",
  hi: "hi-IN",
  tr: "tr-TR",
  nl: "nl-NL",
  pl: "pl-PL",
  uk: "uk-UA",
};

export function toIso639(code: string): string {
  return (code.split("-")[0] ?? "en").toLowerCase();
}

export function toDetectedLanguage(code: string): DetectedLanguage {
  const iso639 = toIso639(code);
  return {
    iso639,
    bcp47: BCP47[iso639] ?? code,
    label: LABELS[iso639] ?? iso639,
  };
}

/**
 * Detect language from user text / speech transcript (script + light cues).
 */
export function detectLanguage(
  text: string,
  fallback?: string,
): DetectedLanguage {
  const trimmed = text.trim();
  const base =
    fallback ||
    (typeof navigator !== "undefined" ? navigator.language : "en-US");

  if (!trimmed) return toDetectedLanguage(base);

  if (/[\u0590-\u05FF]/.test(trimmed)) return toDetectedLanguage("he-IL");
  if (/[\u0600-\u06FF]/.test(trimmed)) return toDetectedLanguage("ar-SA");
  if (/[\u0400-\u04FF]/.test(trimmed)) return toDetectedLanguage("ru-RU");
  if (/[\u4E00-\u9FFF]/.test(trimmed)) return toDetectedLanguage("zh-CN");
  if (/[\u3040-\u30FF]/.test(trimmed)) return toDetectedLanguage("ja-JP");
  if (/[\uAC00-\uD7AF]/.test(trimmed)) return toDetectedLanguage("ko-KR");
  if (/[\u0900-\u097F]/.test(trimmed)) return toDetectedLanguage("hi-IN");

  // Latin-script heuristics (short cues; not perfect).
  if (/[¿¡]|ción\b|qué\b|señor/i.test(trimmed)) {
    return toDetectedLanguage("es-ES");
  }
  if (/[àâæçéèêëïîôùûüÿœ]|voilà|bonjour|merci/i.test(trimmed)) {
    return toDetectedLanguage("fr-FR");
  }
  if (/[äöüß]|und\b|nicht\b|danke/i.test(trimmed)) {
    return toDetectedLanguage("de-DE");
  }
  if (/[àèéìòù]|grazie|ciao\b/i.test(trimmed)) {
    return toDetectedLanguage("it-IT");
  }
  if (/ção\b|você|obrigad/i.test(trimmed)) {
    return toDetectedLanguage("pt-BR");
  }

  if (/[a-z]/i.test(trimmed)) {
    // Latin text without another script / Romance heuristics → English default.
    // (fr/es/de/… already returned above when cues match.)
    return toDetectedLanguage("en-US");
  }

  return toDetectedLanguage(base);
}

export function languageInstruction(lang: DetectedLanguage): string {
  return `[Language directive] The user is communicating in ${lang.label} (${lang.iso639}). Write your entire "answer" field in ${lang.label}. Keep IATA codes and metric field names in English.`;
}

/** Speaker / TTS UI is English-only by product policy. */
export const ENGLISH_SPEAKER_TOOLTIP =
  "Speaker is available only for English text.";

const NON_ENGLISH_SCRIPT =
  /[\u0590-\u05FF\u0600-\u06FF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0900-\u097F]/;

/**
 * True when the text is suitable for the English-only speaker control.
 * Any strong non-Latin script (e.g. Hebrew) disables speaker even if IATA/English tokens appear.
 */
export function isEnglishSpeechText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NON_ENGLISH_SCRIPT.test(trimmed)) return false;
  return detectLanguage(trimmed).iso639 === "en";
}

const RTL_ISO639 = new Set(["he", "ar", "fa", "ur", "yi"]);

/** True when language code or spoken/written text should use RTL layout. */
export function isRtlLanguage(codeOrText: string): boolean {
  const trimmed = codeOrText.trim();
  if (!trimmed) return false;
  // Prefer script detection for message bodies (Hebrew/Arabic letters).
  if (/[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/.test(trimmed)) {
    return true;
  }
  return RTL_ISO639.has(toIso639(trimmed));
}

export function textDirection(text: string): "rtl" | "ltr" {
  return isRtlLanguage(text) ? "rtl" : "ltr";
}
