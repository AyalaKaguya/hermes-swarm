"use client";

export type ThemeMode = "dark" | "light" | "system";
export type PreferredLanguage = "en" | "zh-CN" | "zh-Hans" | "zh-Hant";

export const THEME_MODE_EVENT = "hermes:theme-mode-change";
export const THEME_MODE_STORAGE_KEY = "hermes-swarm.theme-mode";
export const LANGUAGE_STORAGE_KEY = "hermes-swarm.preferred-language";

export const THEME_OPTIONS: Array<{
  icon: "moon" | "sun" | "system";
  label: string;
  value: ThemeMode;
}> = [
  { icon: "system", label: "跟随系统", value: "system" },
  { icon: "sun", label: "浅色", value: "light" },
  { icon: "moon", label: "深色", value: "dark" },
];

export const LANGUAGE_OPTIONS: Array<{
  label: string;
  value: PreferredLanguage;
}> = [
  { label: "简体中文", value: "zh-Hans" },
  { label: "繁体中文", value: "zh-Hant" },
  { label: "English", value: "en" },
];

export function applyLanguagePreference(language: string | null | undefined) {
  if (typeof document === "undefined") return;
  const normalized = normalizeLanguagePreference(language);
  document.documentElement.lang = normalized;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
}

export function applyThemeMode(mode: string | null | undefined) {
  if (typeof document === "undefined") return;
  const normalized = normalizeThemeMode(mode);
  const resolved = resolveThemeMode(normalized);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.themeMode = normalized;
  document.documentElement.style.colorScheme = resolved;
}

export function getLanguageLabel(language: string | null | undefined) {
  const normalized = normalizeLanguagePreference(language);
  return (
    LANGUAGE_OPTIONS.find((option) => option.value === normalized)?.label ??
    normalized
  );
}

export function getStoredLanguagePreference() {
  if (typeof window === "undefined") return "zh-Hans";
  return normalizeLanguagePreference(
    window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ??
      document.documentElement.lang,
  );
}

export function getStoredThemeMode() {
  if (typeof window === "undefined") return "system";
  return normalizeThemeMode(window.localStorage.getItem(THEME_MODE_STORAGE_KEY));
}

export function getThemeModeLabel(mode: string | null | undefined) {
  const normalized = normalizeThemeMode(mode);
  return (
    THEME_OPTIONS.find((option) => option.value === normalized)?.label ??
    "跟随系统"
  );
}

export function normalizeLanguagePreference(
  language: string | null | undefined,
): PreferredLanguage {
  switch (language) {
    case "en":
      return "en";
    case "zh-CN":
    case "zh-Hans":
    case "zh":
      return "zh-Hans";
    case "zh-Hant":
      return "zh-Hant";
    default:
      return "zh-Hans";
  }
}

export function normalizeThemeMode(mode: string | null | undefined): ThemeMode {
  return mode === "dark" || mode === "light" ? mode : "system";
}

export function setThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  applyThemeMode(mode);
  window.dispatchEvent(new CustomEvent(THEME_MODE_EVENT, { detail: { mode } }));
}

function resolveThemeMode(mode: ThemeMode) {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
