import { FEATURE_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";

type PlatformFeatureSetting = {
  name: string;
  value: string | null;
};

export function isAiNavigationEnabled(
  settings: readonly PlatformFeatureSetting[],
) {
  return settings.some(
    (setting) =>
      setting.name === FEATURE_SETTING_KEYS.ai && setting.value === "true",
  );
}
