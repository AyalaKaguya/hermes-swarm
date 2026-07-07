"use client";

export {
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  applyLanguagePreference,
  getLanguageLabel,
  getStoredLanguagePreference,
  normalizeLanguagePreference,
  type SupportedLanguage as PreferredLanguage,
} from "@/lib/i18n";

export type ThemeMode = "dark" | "light" | "system";

export const THEME_MODE_EVENT = "hermes:theme-mode-change";
export const THEME_MODE_STORAGE_KEY = "hermes-swarm.theme-mode";

export const THEME_OPTIONS: Array<{
  icon: "moon" | "sun" | "system";
  label: string;
  value: ThemeMode;
}> = [
  { icon: "system", label: "跟随系统", value: "system" },
  { icon: "sun", label: "浅色", value: "light" },
  { icon: "moon", label: "深色", value: "dark" },
];

export function applyThemeMode(mode: string | null | undefined) {
  if (typeof document === "undefined") return;
  const normalized = normalizeThemeMode(mode);
  const resolved = resolveThemeMode(normalized);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.themeMode = normalized;
  document.documentElement.style.colorScheme = resolved;
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
