import type { AbstractIntlMessages } from "next-intl";
import enMessages from "../messages/en.json";
import zhHansMessages from "../messages/zh-Hans.json";
import zhHantMessages from "../messages/zh-Hant.json";

export type SupportedLanguage = "en" | "zh-Hans" | "zh-Hant";
export type AppMessages = typeof zhHansMessages;

export const DEFAULT_LANGUAGE: SupportedLanguage = "zh-Hans";
export const LANGUAGE_STORAGE_KEY = "hermes-swarm.preferred-language";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const SUPPORTED_LANGUAGES = ["zh-Hans", "zh-Hant", "en"] as const;

export const LANGUAGE_OPTIONS: Array<{
  label: string;
  value: SupportedLanguage;
}> = [
  { label: "简体中文", value: "zh-Hans" },
  { label: "繁體中文", value: "zh-Hant" },
  { label: "English", value: "en" },
];

const messagesByLanguage: Record<SupportedLanguage, AbstractIntlMessages> = {
  en: enMessages,
  "zh-Hans": zhHansMessages,
  "zh-Hant": zhHantMessages,
};

export function normalizeLanguagePreference(
  language: string | null | undefined,
): SupportedLanguage {
  switch (language) {
    case "en":
    case "en-US":
    case "en-GB":
      return "en";
    case "zh-Hant":
    case "zh-TW":
    case "zh-HK":
      return "zh-Hant";
    case "zh":
    case "zh-CN":
    case "zh-Hans":
    case null:
    case undefined:
      return "zh-Hans";
    default:
      return "zh-Hans";
  }
}

export function getLanguageLabel(language: string | null | undefined) {
  const normalized = normalizeLanguagePreference(language);
  return (
    LANGUAGE_OPTIONS.find((option) => option.value === normalized)?.label ??
    normalized
  );
}

export function getStoredLanguagePreference() {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  return normalizeLanguagePreference(
    window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ??
      document.documentElement.lang,
  );
}

export function applyLanguagePreference(language: string | null | undefined) {
  const normalized = normalizeLanguagePreference(language);
  if (typeof document === "undefined") return normalized;

  document.documentElement.lang = normalized;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  document.cookie = `${LANGUAGE_STORAGE_KEY}=${normalized}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; samesite=lax`;
  return normalized;
}

export function getMessagesForLanguage(
  language: string | null | undefined,
): AbstractIntlMessages {
  const normalized = normalizeLanguagePreference(language);
  return mergeMessages(zhHansMessages, messagesByLanguage[normalized]);
}

export function mergeMessages(
  fallback: AbstractIntlMessages,
  messages: AbstractIntlMessages | undefined,
): AbstractIntlMessages {
  if (!messages) return fallback;

  const merged: AbstractIntlMessages = { ...fallback };
  for (const [key, value] of Object.entries(messages)) {
    const fallbackValue = fallback[key];
    if (isMessageRecord(fallbackValue) && isMessageRecord(value)) {
      merged[key] = mergeMessages(fallbackValue, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isMessageRecord(value: unknown): value is AbstractIntlMessages {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
