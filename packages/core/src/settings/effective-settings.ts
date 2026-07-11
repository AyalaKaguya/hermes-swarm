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
  valueOptions: readonly SettingValueOption[] | null;
  valueType: SettingValueType;
};

export type EffectiveTenantSetting = {
  defaultValue: string | null;
  id: string;
  isOverridden: boolean;
  name: string;
  overrideValue: string | null;
  scope: "platform" | "tenant";
  tenantId: string;
  value: string | null;
  valueOptions: readonly SettingValueOption[] | null;
  valueType: SettingValueType;
};

export type EffectiveHierarchicalSetting = Omit<
  EffectiveOrganizationSetting,
  "scope"
> & {
  scope: "platform" | "tenant" | "organization";
  tenantId: string;
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
    const defaultValue = platformSetting?.value ?? null;
    const overrideValue = tenantSetting?.value ?? null;
    return {
      defaultValue: maskSettingValue(defaultValue, valueType),
      id: tenantSetting?.id ?? platformSetting?.id ?? `${tenantId}:${name}`,
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

export function mergeEffectiveHierarchicalSettings(
  organizationSettings: readonly ScopedSettingRecord[],
  tenantSettings: readonly ScopedSettingRecord[],
  platformSettings: readonly ScopedSettingRecord[],
  tenantId: string,
  organizationId: string,
): EffectiveHierarchicalSetting[] {
  const organizationByName = new Map(
    organizationSettings.map((setting) => [setting.name, setting]),
  );
  const tenantByName = new Map(tenantSettings.map((setting) => [setting.name, setting]));
  const platformByName = new Map(platformSettings.map((setting) => [setting.name, setting]));
  const names = [
    ...new Set([
      ...platformByName.keys(),
      ...tenantByName.keys(),
      ...organizationByName.keys(),
    ]),
  ].sort();

  return names.map((name) => {
    const organizationSetting = organizationByName.get(name) ?? null;
    const tenantSetting = tenantByName.get(name) ?? null;
    const platformSetting = platformByName.get(name) ?? null;
    const parentSetting = tenantSetting ?? platformSetting;
    const valueType = resolveSettingValueType(
      name,
      organizationSetting?.valueType ?? parentSetting?.valueType,
    );
    const valueOptions = resolveSettingValueOptions(
      name,
      organizationSetting?.valueOptions ?? parentSetting?.valueOptions,
    );
    const isOverridden = Boolean(organizationSetting);
    const defaultValue = parentSetting?.value ?? null;
    const overrideValue = organizationSetting?.value ?? null;
    return {
      defaultValue: maskSettingValue(defaultValue, valueType),
      id:
        organizationSetting?.id ??
        parentSetting?.id ??
        `${tenantId}:${organizationId}:${name}`,
      isOverridden,
      name,
      organizationId,
      overrideValue: maskSettingValue(overrideValue, valueType),
      scope: isOverridden
        ? "organization"
        : tenantSetting
          ? "tenant"
          : "platform",
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
    const valueType = resolveSettingValueType(
      name,
      organizationSetting?.valueType ??
        systemSetting?.valueType,
    );
    const valueOptions = resolveSettingValueOptions(
      name,
      organizationSetting?.valueOptions ??
        systemSetting?.valueOptions,
    );
    const effectiveValue = isOverridden ? overrideValue : defaultValue;

    return {
      defaultValue: maskSettingValue(defaultValue, valueType),
      id:
        organizationSetting?.id ??
        systemSetting?.id ??
        `${organizationId}:${name}`,
      isOverridden,
      name,
      organizationId,
      overrideValue: maskSettingValue(overrideValue, valueType),
      scope: isOverridden ? "organization" : "platform",
      value: maskSettingValue(effectiveValue, valueType),
      valueOptions,
      valueType,
    };
  });
}
