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
  applyTimeZonePreference,
  normalizeTimeZonePreference,
} from "@/lib/i18n";
import type { RuntimePreferences } from "@hermes-swarm/core/settings";

type I18nContextValue = {
  language: SupportedLanguage;
  runtimePreferences: RuntimePreferences;
  setLanguage: (language: string | null | undefined) => void;
  setRuntimePreferences: (preferences: RuntimePreferences) => void;
};

type I18nState = {
  language: SupportedLanguage;
  messages: AbstractIntlMessages;
  runtimePreferences: RuntimePreferences;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
  initialMessages,
  initialTimeZone,
}: {
  children: ReactNode;
  initialLocale: string;
  initialMessages: AbstractIntlMessages;
  initialTimeZone: string;
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
      runtimePreferences: defaultRuntimePreferences(
        language,
        normalizeTimeZonePreference(initialTimeZone),
      ),
    };
  });

  const setLanguage = useCallback((nextLanguage: string | null | undefined) => {
    const normalized = applyLanguagePreference(nextLanguage);
    setState((current) => {
      if (current.language === normalized) return current;
      return {
        language: normalized,
        messages: getMessagesForLanguage(normalized),
        runtimePreferences: {
          ...current.runtimePreferences,
          language: normalized,
        },
      };
    });
  }, []);

  const setRuntimePreferences = useCallback(
    (preferences: RuntimePreferences) => {
      const language = applyLanguagePreference(preferences.language);
      const timeZone = applyTimeZonePreference(preferences.timeZone);
      setState({
        language,
        messages: getMessagesForLanguage(language),
        runtimePreferences: { ...preferences, language, timeZone },
      });
    },
    [],
  );

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
    () => ({
      language: state.language,
      runtimePreferences: state.runtimePreferences,
      setLanguage,
      setRuntimePreferences,
    }),
    [state.language, state.runtimePreferences, setLanguage, setRuntimePreferences],
  );

  return (
    <I18nContext.Provider value={value}>
      <NextIntlClientProvider
        key={`${state.language}:${state.runtimePreferences.timeZone}`}
        locale={state.language}
        messages={state.messages}
        timeZone={state.runtimePreferences.timeZone}
      >
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  );
}

function defaultRuntimePreferences(
  language: SupportedLanguage,
  timeZone: string,
): RuntimePreferences {
  return {
    currency: "CNY",
    dateFormat: "YYYY-MM-DD",
    language,
    regionCode: "CN",
    sources: {
      currency: "code",
      dateFormat: "code",
      language: "code",
      regionCode: "code",
      timeZone: "code",
    },
    timeZone,
  };
}

export function useI18n() {
  const context = useContext(I18nContext);
  const t = useTranslations();
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return { ...context, t };
}
