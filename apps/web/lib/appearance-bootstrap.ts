export const THEME_MODE_STORAGE_KEY = "hermes-swarm.theme-mode";

export const APPEARANCE_BOOTSTRAP_SCRIPT = `(() => {
  const root = document.documentElement;
  let mode = "system";
  let systemDark = false;

  try {
    const stored = window.localStorage.getItem(${JSON.stringify(THEME_MODE_STORAGE_KEY)});
    if (stored === "dark" || stored === "light") mode = stored;
  } catch {}

  try {
    systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {}

  const dark = mode === "dark" || (mode === "system" && systemDark);
  root.classList.toggle("dark", dark);
  root.dataset.themeMode = mode;
  root.style.colorScheme = dark ? "dark" : "light";
})();`;
