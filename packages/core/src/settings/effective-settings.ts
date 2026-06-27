export type ScopedSettingRecord = {
  id?: string;
  name: string;
  value: string | null;
};

export type EffectiveOrganizationSetting = {
  defaultValue: string | null;
  id: string;
  isOverridden: boolean;
  name: string;
  organizationId: string;
  overrideValue: string | null;
  scope: "organization" | "platform";
  value: string | null;
};

/**
 * Merges platform defaults and organization overrides into an effective
 * setting projection. The `value` field stays backward-compatible: consumers
 * can read it without knowing whether it came from platform or organization.
 */
export function mergeEffectiveOrganizationSettings(
  organizationSettings: readonly ScopedSettingRecord[],
  systemSettings: readonly ScopedSettingRecord[],
  organizationId: string,
): EffectiveOrganizationSetting[] {
  const organizationByName = new Map(
    organizationSettings.map((setting) => [setting.name, setting]),
  );
  const systemByName = new Map(
    systemSettings.map((setting) => [setting.name, setting]),
  );
  const names = [...new Set([...systemByName.keys(), ...organizationByName.keys()])].sort();

  return names.map((name) => {
    const organizationSetting = organizationByName.get(name) ?? null;
    const systemSetting = systemByName.get(name) ?? null;
    const overrideValue = organizationSetting?.value ?? null;
    const defaultValue = systemSetting?.value ?? null;
    const isOverridden = Boolean(organizationSetting);

    return {
      defaultValue,
      id:
        organizationSetting?.id ??
        systemSetting?.id ??
        `${organizationId}:${name}`,
      isOverridden,
      name,
      organizationId,
      overrideValue,
      scope: isOverridden ? "organization" : "platform",
      value: isOverridden ? overrideValue : defaultValue,
    };
  });
}
