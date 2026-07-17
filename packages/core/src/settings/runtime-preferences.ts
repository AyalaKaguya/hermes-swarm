import { PLATFORM_SETTING_KEYS } from "./definitions.js";

export type CanonicalLanguage = "en" | "zh-Hans" | "zh-Hant";
export type RuntimePreferenceSource = "code" | "platform" | "tenant" | "user";

export type RuntimePreferences = {
  currency: string;
  dateFormat: string;
  language: CanonicalLanguage;
  regionCode: string;
  sources: {
    currency: Exclude<RuntimePreferenceSource, "user">;
    dateFormat: Exclude<RuntimePreferenceSource, "user">;
    language: RuntimePreferenceSource;
    regionCode: Exclude<RuntimePreferenceSource, "user">;
    timeZone: RuntimePreferenceSource;
  };
  timeZone: string;
};

export type RuntimePreferenceSetting = {
  name: string;
  scope?: string | null;
  value: string | null;
};

export type RuntimePreferenceUser = {
  preferredLanguage?: string | null;
  timeZone?: string | null;
};

const CODE_DEFAULTS = {
  currency: "CNY",
  dateFormat: "YYYY-MM-DD",
  language: "zh-Hans" as CanonicalLanguage,
  regionCode: "CN",
  timeZone: "Asia/Shanghai",
};

export function normalizeCanonicalLanguage(
  value: string | null | undefined,
): CanonicalLanguage | null {
  switch (value?.trim()) {
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
      return "zh-Hans";
    default:
      return null;
  }
}

export function resolveRuntimePreferences(
  user: RuntimePreferenceUser | null | undefined,
  settings: readonly RuntimePreferenceSetting[],
): RuntimePreferences {
  const byName = new Map(settings.map((setting) => [setting.name, setting]));
  const languageSetting = byName.get(PLATFORM_SETTING_KEYS.defaultLanguage);
  const timeZoneSetting = byName.get(PLATFORM_SETTING_KEYS.defaultTimeZone);
  const language =
    normalizeCanonicalLanguage(user?.preferredLanguage) ??
    normalizeCanonicalLanguage(languageSetting?.value) ??
    CODE_DEFAULTS.language;
  const userTimeZone = normalizedText(user?.timeZone);
  const timeZone =
    userTimeZone ?? normalizedText(timeZoneSetting?.value) ?? CODE_DEFAULTS.timeZone;

  return {
    currency:
      settingValue(byName, PLATFORM_SETTING_KEYS.defaultCurrency) ??
      CODE_DEFAULTS.currency,
    dateFormat:
      settingValue(byName, PLATFORM_SETTING_KEYS.defaultDateFormat) ??
      CODE_DEFAULTS.dateFormat,
    language,
    regionCode:
      settingValue(byName, PLATFORM_SETTING_KEYS.defaultRegionCode) ??
      CODE_DEFAULTS.regionCode,
    sources: {
      currency: settingSource(
        byName.get(PLATFORM_SETTING_KEYS.defaultCurrency),
      ),
      dateFormat: settingSource(
        byName.get(PLATFORM_SETTING_KEYS.defaultDateFormat),
      ),
      language: normalizeCanonicalLanguage(user?.preferredLanguage)
        ? "user"
        : settingSource(languageSetting),
      regionCode: settingSource(
        byName.get(PLATFORM_SETTING_KEYS.defaultRegionCode),
      ),
      timeZone: userTimeZone ? "user" : settingSource(timeZoneSetting),
    },
    timeZone,
  };
}

function settingValue(
  settings: Map<string, RuntimePreferenceSetting>,
  name: string,
) {
  return normalizedText(settings.get(name)?.value);
}

function settingSource(
  setting: RuntimePreferenceSetting | null | undefined,
): "code" | "platform" | "tenant" {
  if (!normalizedText(setting?.value)) return "code";
  return setting?.scope === "tenant" ? "tenant" : "platform";
}

function normalizedText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}
