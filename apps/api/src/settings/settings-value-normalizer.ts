import { BadRequestException } from "@nestjs/common";
import {
  SECRET_SETTING_MASK,
  isSettingValueType,
  resolveSettingValueOptions,
  resolveSettingValueType,
  type SettingValueOption,
  type SettingValueType,
} from "@hermes-swarm/core";
import type { SaveSettingsPayload } from "../tenancy/tenancy.types.js";

export type ParsedSettingPayloadEntry = {
  name: string;
  value: unknown;
  valueOptions?: unknown;
  valueType?: unknown;
};

export type SettingMetadataSource = {
  value?: unknown;
  valueOptions?: unknown;
  valueType?: unknown;
} | null;

export type NormalizedSettingEntry = {
  name: string;
  value: string | null;
  valueOptions: SettingValueOption[] | null;
  valueType: SettingValueType;
};

export function parseSettingsPayload(
  payload: SaveSettingsPayload,
): ParsedSettingPayloadEntry[] {
  const entries = Array.isArray((payload as { settings?: unknown }).settings)
    ? (payload as {
        settings: Array<{
          name?: string;
          value?: unknown;
          valueOptions?: unknown;
          valueType?: unknown;
        }>;
      }).settings.map((item) => ({
        name: requireSettingName(item.name),
        value: item.value,
        valueOptions: item.valueOptions,
        valueType: item.valueType,
      }))
    : Object.entries(payload)
        .filter(([key]) => key !== "settings")
        .map(([name, value]) => ({
          name: requireSettingName(name),
          value,
        }));

  if (entries.length === 0) {
    throw new BadRequestException("设置不能为空");
  }

  return entries;
}

export function normalizeSettingEntry(
  entry: ParsedSettingPayloadEntry,
  metadataSources: SettingMetadataSource[] = [],
): NormalizedSettingEntry {
  const valueType = resolveValueType(entry, metadataSources);
  const valueOptions = resolveValueOptions(entry, metadataSources);
  return {
    name: entry.name,
    value: serializeSettingValue(
      entry.value,
      valueType,
      valueOptions,
      metadataSources,
    ),
    valueOptions,
    valueType,
  };
}

function resolveValueType(
  entry: ParsedSettingPayloadEntry,
  metadataSources: SettingMetadataSource[],
) {
  const sourceValueType =
    entry.valueType ?? metadataSources.find((source) => source?.valueType)?.valueType;
  const candidate = resolveSettingValueType(
    entry.name,
    typeof sourceValueType === "string" ? sourceValueType : null,
  );

  if (!isSettingValueType(candidate)) {
    throw new BadRequestException("设置类型无效");
  }
  return candidate;
}

function resolveValueOptions(
  entry: ParsedSettingPayloadEntry,
  metadataSources: SettingMetadataSource[],
) {
  const sourceOptions =
    entry.valueOptions !== undefined
      ? entry.valueOptions
      : resolveSettingValueOptions(
          entry.name,
          metadataSources.find((source) => source?.valueOptions)?.valueOptions as
            | readonly SettingValueOption[]
            | null
            | undefined,
        );
  return normalizeValueOptions(sourceOptions);
}

function normalizeValueOptions(value: unknown): SettingValueOption[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new BadRequestException("枚举选项格式无效");
  }

  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new BadRequestException("枚举选项格式无效");
    }
    const option = item as { label?: unknown; value?: unknown };
    const normalizedValue =
      typeof option.value === "string" ? option.value.trim() : "";
    if (!normalizedValue) {
      throw new BadRequestException("枚举选项值不能为空");
    }
    if (seen.has(normalizedValue)) {
      throw new BadRequestException("枚举选项值不能重复");
    }
    seen.add(normalizedValue);
    const label =
      typeof option.label === "string" && option.label.trim()
        ? option.label.trim()
        : normalizedValue;
    return { label, value: normalizedValue };
  });
}

function serializeSettingValue(
  value: unknown,
  valueType: SettingValueType,
  valueOptions: SettingValueOption[] | null,
  metadataSources: SettingMetadataSource[],
) {
  if (value === undefined || value === null) return null;

  if (valueType === "boolean") {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === "true" || value === "false") return value;
    throw new BadRequestException("布尔设置值必须为 true 或 false");
  }

  if (valueType === "number") {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value.trim())
          : Number.NaN;
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException("数字设置值无效");
    }
    return String(parsed);
  }

  if (valueType === "json") {
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value));
      } catch {
        throw new BadRequestException("JSON 设置值格式无效");
      }
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    throw new BadRequestException("JSON 设置值必须是对象、数组或 JSON 字符串");
  }

  if (valueType === "enum") {
    if (!valueOptions?.length) {
      throw new BadRequestException("枚举设置必须提供选项");
    }
    const normalized = String(value).trim();
    if (!valueOptions.some((option) => option.value === normalized)) {
      throw new BadRequestException("枚举设置值不在选项范围内");
    }
    return normalized;
  }

  if (valueType === "secret") {
    if (typeof value === "object") {
      throw new BadRequestException("密钥设置值不能是对象");
    }
    const normalized = String(value);
    if (normalized === SECRET_SETTING_MASK) {
      const existingValue = metadataSources.find(
        (source: SettingMetadataSource) => typeof source?.value === "string",
      )?.value;
      if (typeof existingValue === "string" && existingValue) {
        return existingValue;
      }
      throw new BadRequestException("密钥设置值不能为空");
    }
    if (!normalized) {
      throw new BadRequestException("密钥设置值不能为空");
    }
    return normalized;
  }

  if (typeof value === "object") {
    throw new BadRequestException("文本设置值不能是对象");
  }
  return String(value);
}

function requireSettingName(value: string | undefined) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException("设置名称不能为空");
  }
  return text;
}
