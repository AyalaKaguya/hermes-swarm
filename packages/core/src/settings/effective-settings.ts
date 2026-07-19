import {
  maskSettingValue,
  resolveSettingValueOptions,
  resolveSettingValueType,
  type SettingValueOption,
  type SettingValueType,
} from "./definitions.js";

export type ScopedSettingRecord = {
  id?: string;
  name: string;
  value: string | null;
  valueOptions?: readonly SettingValueOption[] | null;
  valueType?: SettingValueType | string | null;
  scope?: string | null;
};

export type EffectiveTenantSetting = {
  defaultValue: string | null;
  id: string;
  isCustom: boolean;
  isEditable: boolean;
  isOrphaned: boolean;
  isOverridden: boolean;
  name: string;
  overrideValue: string | null;
  scope: "platform" | "tenant";
  tenantId: string;
  value: string | null;
  valueOptions: readonly SettingValueOption[] | null;
  valueType: SettingValueType;
};

export function mergeEffectiveTenantSettings(
  tenantSettings: readonly ScopedSettingRecord[],
  platformSettings: readonly ScopedSettingRecord[],
  tenantId: string,
): EffectiveTenantSetting[] {
  const tenantByName = new Map(tenantSettings.map((setting) => [setting.name, setting]));
  const platformByName = new Map(platformSettings.map((setting) => [setting.name, setting]));
  const names = [...new Set([...platformByName.keys(), ...tenantByName.keys()])].sort();

  return names.map((name) => {
    const tenantSetting = tenantByName.get(name) ?? null;
    const platformSetting = platformByName.get(name) ?? null;
    const valueType = resolveSettingValueType(
      name,
      tenantSetting?.valueType ?? platformSetting?.valueType,
    );
    const valueOptions = resolveSettingValueOptions(
      name,
      tenantSetting?.valueOptions ?? platformSetting?.valueOptions,
    );
    const isOverridden = Boolean(tenantSetting);
    const isCustom = Boolean(tenantSetting && !platformSetting);
    const isOrphaned = false;
    const defaultValue = platformSetting?.value ?? null;
    const overrideValue = tenantSetting?.value ?? null;
    return {
      defaultValue: maskSettingValue(defaultValue, valueType),
      id: tenantSetting?.id ?? platformSetting?.id ?? `${tenantId}:${name}`,
      isCustom,
      isEditable: isCustom || platformSetting?.scope !== "platform",
      isOrphaned,
      isOverridden,
      name,
      overrideValue: maskSettingValue(overrideValue, valueType),
      scope: isOverridden ? "tenant" : "platform",
      tenantId,
      value: maskSettingValue(
        isOverridden ? overrideValue : defaultValue,
        valueType,
      ),
      valueOptions,
      valueType,
    };
  });
}
