"use client";

import { useCallback } from "react";
import { useLocale } from "next-intl";
import enPhrases from "@/phrases/en.json";
import zhHansPhrases from "@/phrases/zh-Hans.json";
import zhHantPhrases from "@/phrases/zh-Hant.json";
import {
  normalizeLanguagePreference,
  type SupportedLanguage,
} from "@/lib/i18n";

const phraseTranslations: Record<SupportedLanguage, Record<string, string>> = {
  en: enPhrases,
  "zh-Hans": zhHansPhrases,
  "zh-Hant": zhHantPhrases,
};

export function useTextTranslation() {
  const locale = useLocale();
  const language = normalizeLanguagePreference(locale);

  return useCallback(
    (value: string | null | undefined) => {
      if (!value) return value ?? "";
      return phraseTranslations[language][value] ?? value;
    },
    [language],
  );
}
