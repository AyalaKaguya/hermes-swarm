import {
  PLATFORM_SETTING_KEYS,
  PLATFORM_TITLE_SETTING_KEY,
} from "@hermes-swarm/core/settings/definitions";
import type { SystemSettingDto } from "@/lib/admin-api";

export function resolvePlatformNameFromSettings(
  settings: SystemSettingDto[] | undefined,
  preferredLanguage?: string | null,
) {
  const languageKey = preferredLanguage
    ? `${PLATFORM_TITLE_SETTING_KEY}.${preferredLanguage}`
    : "";
  return (
    settings?.find((setting) => setting.name === languageKey)?.value?.trim() ||
    settings?.find((setting) => setting.name === PLATFORM_TITLE_SETTING_KEY)
      ?.value?.trim() ||
    null
  );
}

export function resolveWorkspaceApplicationsEnabled(
  settings: SystemSettingDto[] | undefined,
) {
  const value = settings?.find(
    (setting) =>
      setting.name === PLATFORM_SETTING_KEYS.workspaceApplicationsEnabled,
  )?.value;
  return value === undefined || value === null ? true : value === "true";
}
