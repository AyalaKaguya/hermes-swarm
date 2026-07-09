"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  NextIntlClientProvider,
  useTranslations,
  type AbstractIntlMessages,
} from "next-intl";
import {
  LANGUAGE_STORAGE_KEY,
  applyLanguagePreference,
  getMessagesForLanguage,
  getStoredLanguagePreference,
  normalizeLanguagePreference,
  type SupportedLanguage,
} from "@/lib/i18n";

type I18nContextValue = {
  language: SupportedLanguage;
  setLanguage: (language: string | null | undefined) => void;
};

type I18nState = {
  language: SupportedLanguage;
  messages: AbstractIntlMessages;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
  initialMessages,
}: {
  children: ReactNode;
  initialLocale: string;
  initialMessages: AbstractIntlMessages;
}) {
  const initialLanguage = normalizeLanguagePreference(initialLocale);
  const [state, setState] = useState<I18nState>(() => {
    const language =
      typeof window === "undefined"
        ? initialLanguage
        : getStoredLanguagePreference();

    return {
      language,
      messages:
        language === initialLanguage
          ? initialMessages
          : getMessagesForLanguage(language),
    };
  });

  const setLanguage = useCallback((nextLanguage: string | null | undefined) => {
    const normalized = applyLanguagePreference(nextLanguage);
    setState((current) => {
      if (current.language === normalized) return current;
      return {
        language: normalized,
        messages: getMessagesForLanguage(normalized),
      };
    });
  }, []);

  useEffect(() => {
    const storedLanguage = getStoredLanguagePreference();
    if (storedLanguage !== state.language) {
      setLanguage(storedLanguage);
    } else {
      applyLanguagePreference(state.language);
    }

    function onStorage(event: StorageEvent) {
      if (event.key === LANGUAGE_STORAGE_KEY) {
        setLanguage(event.newValue);
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [state.language, setLanguage]);

  const value = useMemo<I18nContextValue>(
    () => ({ language: state.language, setLanguage }),
    [state.language, setLanguage],
  );

  return (
    <I18nContext.Provider value={value}>
      <NextIntlClientProvider
        key={state.language}
        locale={state.language}
        messages={state.messages}
        timeZone="Asia/Hong_Kong"
      >
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  const t = useTranslations();
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return { ...context, t };
}
