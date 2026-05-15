import { normalizeWhitespace } from "./collector/provider-helpers.js";

const ENGLISH_LANGUAGE_VALUES = new Set(["english", "en", "eng"]);
const NON_LATIN_SCRIPT_PATTERN =
  /[\u0400-\u04FF\u0500-\u052F\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u;

function readLanguageFromObject(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const language = normalizeWhitespace(
    (candidate as Record<string, unknown>).sourceLanguage ??
      (candidate as Record<string, unknown>).source_language ??
      (candidate as Record<string, unknown>).language ??
      (candidate as Record<string, unknown>).lang ??
      (candidate as Record<string, unknown>).languageCode ??
      (candidate as Record<string, unknown>).language_code
  );

  return language || null;
}

export function resolveNewsSourceLanguage(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const objectLanguage = readLanguageFromObject(candidate);
    if (objectLanguage) {
      return objectLanguage;
    }

    if (typeof candidate !== "string") {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const parsedLanguage = readLanguageFromObject(parsed);
      if (parsedLanguage) {
        return parsedLanguage;
      }
    } catch {
      // Ignore non-JSON strings.
    }
  }

  return null;
}

export function isEnglishNewsCandidate(candidate: {
  title?: unknown;
  summary?: unknown;
  sourceLanguage?: unknown;
}) {
  const normalizedLanguage = normalizeWhitespace(candidate?.sourceLanguage).toLowerCase();
  if (normalizedLanguage) {
    return ENGLISH_LANGUAGE_VALUES.has(normalizedLanguage);
  }

  const text = normalizeWhitespace(`${String(candidate?.title ?? "")} ${String(candidate?.summary ?? "")}`);
  if (!text) {
    return true;
  }

  return !NON_LATIN_SCRIPT_PATTERN.test(text);
}
