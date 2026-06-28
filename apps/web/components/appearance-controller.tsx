"use client";

import { useEffect } from "react";
import {
  THEME_MODE_EVENT,
  applyThemeMode,
  getStoredLanguagePreference,
  getStoredThemeMode,
  applyLanguagePreference,
} from "@/lib/appearance";

export function AppearanceController() {
  useEffect(() => {
    function syncTheme() {
      applyThemeMode(getStoredThemeMode());
    }

    syncTheme();
    applyLanguagePreference(getStoredLanguagePreference());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", syncTheme);
    window.addEventListener(THEME_MODE_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);

    return () => {
      media.removeEventListener("change", syncTheme);
      window.removeEventListener(THEME_MODE_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  return null;
}
