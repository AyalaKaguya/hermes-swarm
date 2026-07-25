import { FEATURE_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";

type EffectiveFeatureSetting = {
  name: string;
  value: string | null;
};

export function isAnalyticsNavigationEnabled(
  settings: readonly EffectiveFeatureSetting[],
) {
  return settings.some(
    (setting) =>
      setting.name === FEATURE_SETTING_KEYS.analytics &&
      setting.value === "true",
  );
}
