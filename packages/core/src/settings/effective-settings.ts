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

export type EffectiveWorkspaceSetting = {
  defaultValue: string | null;
  id: string;
  isCustom: boolean;
  isEditable: boolean;
  isOrphaned: boolean;
  isOverridden: boolean;
  name: string;
  overrideValue: string | null;
  scope: "platform" | "workspace";
  workspaceId: string;
  value: string | null;
  valueOptions: readonly SettingValueOption[] | null;
  valueType: SettingValueType;
};

export function mergeEffectiveWorkspaceSettings(
  workspaceSettings: readonly ScopedSettingRecord[],
  platformSettings: readonly ScopedSettingRecord[],
  workspaceId: string,
): EffectiveWorkspaceSetting[] {
  const workspaceByName = new Map(workspaceSettings.map((setting) => [setting.name, setting]));
  const platformByName = new Map(platformSettings.map((setting) => [setting.name, setting]));
  const names = [...new Set([...platformByName.keys(), ...workspaceByName.keys()])].sort();

  return names.map((name) => {
    const workspaceSetting = workspaceByName.get(name) ?? null;
    const platformSetting = platformByName.get(name) ?? null;
    const valueType = resolveSettingValueType(
      name,
      workspaceSetting?.valueType ?? platformSetting?.valueType,
    );
    const valueOptions = resolveSettingValueOptions(
      name,
      workspaceSetting?.valueOptions ?? platformSetting?.valueOptions,
    );
    const isOverridden = Boolean(workspaceSetting);
    const isCustom = Boolean(workspaceSetting && !platformSetting);
    const isOrphaned = false;
    const defaultValue = platformSetting?.value ?? null;
    const overrideValue = workspaceSetting?.value ?? null;
    return {
      defaultValue: maskSettingValue(defaultValue, valueType),
      id: workspaceSetting?.id ?? platformSetting?.id ?? `${workspaceId}:${name}`,
      isCustom,
      isEditable: isCustom || platformSetting?.scope !== "platform",
      isOrphaned,
      isOverridden,
      name,
      overrideValue: maskSettingValue(overrideValue, valueType),
      scope: isOverridden ? "workspace" : "platform",
      workspaceId,
      value: maskSettingValue(
        isOverridden ? overrideValue : defaultValue,
        valueType,
      ),
      valueOptions,
      valueType,
    };
  });
}
