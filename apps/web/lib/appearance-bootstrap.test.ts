import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  APPEARANCE_BOOTSTRAP_SCRIPT,
  THEME_MODE_STORAGE_KEY,
} from "./appearance-bootstrap";

describe("appearance bootstrap", () => {
  it("applies a stored dark theme before hydration", () => {
    const result = executeBootstrap("dark", false);

    assert.deepEqual(result, {
      colorScheme: "dark",
      dark: true,
      mode: "dark",
      storageKey: THEME_MODE_STORAGE_KEY,
    });
  });

  it("uses the system preference when no explicit theme is stored", () => {
    const result = executeBootstrap(null, true);

    assert.deepEqual(result, {
      colorScheme: "dark",
      dark: true,
      mode: "system",
      storageKey: THEME_MODE_STORAGE_KEY,
    });
  });

  it("keeps an explicit light theme on a dark system", () => {
    const result = executeBootstrap("light", true);

    assert.deepEqual(result, {
      colorScheme: "light",
      dark: false,
      mode: "light",
      storageKey: THEME_MODE_STORAGE_KEY,
    });
  });
});

function executeBootstrap(storedMode: string | null, systemDark: boolean) {
  const state = {
    colorScheme: "",
    dark: false,
    mode: "",
    storageKey: "",
  };
  const root = {
    classList: {
      toggle: (_className: string, enabled: boolean) => {
        state.dark = enabled;
      },
    },
    dataset: new Proxy<Record<string, string>>({}, {
      set: (_target, property, value) => {
        if (property === "themeMode") state.mode = String(value);
        return true;
      },
    }),
    style: new Proxy<Record<string, string>>({}, {
      set: (_target, property, value) => {
        if (property === "colorScheme") state.colorScheme = String(value);
        return true;
      },
    }),
  };

  runInNewContext(APPEARANCE_BOOTSTRAP_SCRIPT, {
    document: { documentElement: root },
    window: {
      localStorage: {
        getItem: (key: string) => {
          state.storageKey = key;
          return storedMode;
        },
      },
      matchMedia: () => ({ matches: systemDark }),
    },
  });

  return state;
}
