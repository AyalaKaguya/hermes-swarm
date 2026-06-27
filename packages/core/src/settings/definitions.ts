export type SettingOption = {
  label: string;
  value: string;
};

export type PlatformSettingDefinition = {
  defaultValue?: string;
  key: string;
  legacyKeys?: readonly string[];
};

export type PlatformDefaultSetting = {
  name: string;
  value: string;
};

export type OrganizationDefaultFieldDefinition = {
  field: "currency" | "dateFormat" | "preferredLanguage" | "regionCode" | "timeZone";
  key: string;
  label: string;
  options: readonly SettingOption[];
};

export type OrganizationControlSettingDefinition = {
  key: string;
  label: string;
  options: readonly SettingOption[];
};

export const PLATFORM_TITLE_SETTING_KEY = "tenant_title";

export const PLATFORM_SETTING_KEYS = {
  allowOrganizationCreation: "platform.allowOrganizationCreation",
  defaultCurrency: "organization.defaultCurrency",
  defaultDateFormat: "organization.defaultDateFormat",
  defaultLanguage: "organization.defaultLanguage",
  defaultOrganizationStatus: "platform.defaultOrganizationStatus",
  defaultRegionCode: "organization.defaultRegionCode",
  defaultTimeZone: "organization.defaultTimeZone",
  messageServiceEnabled: "platform.messageServiceEnabled",
  messageServiceProvider: "platform.messageServiceProvider",
  passwordMinLength: "auth.passwordPolicy.minLength",
  publicSmtpEnabled: "platform.publicSmtpEnabled",
} as const;

export const LEGACY_PLATFORM_SETTING_KEYS = {
  defaultLanguage: "platform.defaultLanguage",
  defaultTimeZone: "platform.defaultTimeZone",
} as const;

export const CURRENCY_OPTIONS = [
  { label: "人民币 (CNY)", value: "CNY" },
  { label: "美元 (USD)", value: "USD" },
  { label: "欧元 (EUR)", value: "EUR" },
  { label: "英镑 (GBP)", value: "GBP" },
  { label: "日元 (JPY)", value: "JPY" },
  { label: "港币 (HKD)", value: "HKD" },
  { label: "新加坡元 (SGD)", value: "SGD" },
] as const satisfies readonly SettingOption[];

export const DATE_FORMAT_OPTIONS = [
  { label: "YYYY-MM-DD", value: "YYYY-MM-DD" },
  { label: "YYYY/MM/DD", value: "YYYY/MM/DD" },
  { label: "MM/DD/YYYY", value: "MM/DD/YYYY" },
  { label: "DD/MM/YYYY", value: "DD/MM/YYYY" },
] as const satisfies readonly SettingOption[];

export const LANGUAGE_OPTIONS = [
  { label: "中文", value: "zh-CN" },
  { label: "English", value: "en" },
  { label: "繁体中文", value: "zh-Hant" },
] as const satisfies readonly SettingOption[];

export const PASSWORD_LENGTH_OPTIONS = [6, 8, 10, 12, 16].map((value) => ({
  label: `${value} 位`,
  value: String(value),
})) satisfies SettingOption[];

export const REGION_OPTIONS = [
  { label: "中国 (CN)", value: "CN" },
  { label: "美国 (US)", value: "US" },
  { label: "英国 (GB)", value: "GB" },
  { label: "欧盟 (EU)", value: "EU" },
  { label: "日本 (JP)", value: "JP" },
  { label: "新加坡 (SG)", value: "SG" },
  { label: "中国香港 (HK)", value: "HK" },
] as const satisfies readonly SettingOption[];

export const TIME_ZONE_OPTIONS = [
  { label: "中国标准时间 (Asia/Shanghai)", value: "Asia/Shanghai" },
  { label: "协调世界时 (UTC)", value: "UTC" },
  { label: "美国东部时间 (America/New_York)", value: "America/New_York" },
  { label: "伦敦时间 (Europe/London)", value: "Europe/London" },
  { label: "东京时间 (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "新加坡时间 (Asia/Singapore)", value: "Asia/Singapore" },
] as const satisfies readonly SettingOption[];

export const ORGANIZATION_DEFAULT_FIELD_DEFINITIONS = [
  {
    field: "currency",
    key: PLATFORM_SETTING_KEYS.defaultCurrency,
    label: "货币",
    options: CURRENCY_OPTIONS,
  },
  {
    field: "timeZone",
    key: PLATFORM_SETTING_KEYS.defaultTimeZone,
    label: "时区",
    options: TIME_ZONE_OPTIONS,
  },
  {
    field: "regionCode",
    key: PLATFORM_SETTING_KEYS.defaultRegionCode,
    label: "地区代码",
    options: REGION_OPTIONS,
  },
  {
    field: "dateFormat",
    key: PLATFORM_SETTING_KEYS.defaultDateFormat,
    label: "日期格式",
    options: DATE_FORMAT_OPTIONS,
  },
  {
    field: "preferredLanguage",
    key: PLATFORM_SETTING_KEYS.defaultLanguage,
    label: "默认语言",
    options: LANGUAGE_OPTIONS,
  },
] as const satisfies readonly OrganizationDefaultFieldDefinition[];

export const ORGANIZATION_CONTROL_SETTING_DEFINITIONS = [
  {
    key: PLATFORM_SETTING_KEYS.passwordMinLength,
    label: "密码最小长度",
    options: PASSWORD_LENGTH_OPTIONS,
  },
] as const satisfies readonly OrganizationControlSettingDefinition[];

export const PLATFORM_SETTING_DEFINITIONS = {
  allowOrganizationCreation: {
    defaultValue: "true",
    key: PLATFORM_SETTING_KEYS.allowOrganizationCreation,
  },
  defaultCurrency: {
    defaultValue: "CNY",
    key: PLATFORM_SETTING_KEYS.defaultCurrency,
  },
  defaultDateFormat: {
    defaultValue: "YYYY-MM-DD",
    key: PLATFORM_SETTING_KEYS.defaultDateFormat,
  },
  defaultLanguage: {
    defaultValue: "zh-CN",
    key: PLATFORM_SETTING_KEYS.defaultLanguage,
    legacyKeys: [LEGACY_PLATFORM_SETTING_KEYS.defaultLanguage],
  },
  defaultOrganizationStatus: {
    defaultValue: "active",
    key: PLATFORM_SETTING_KEYS.defaultOrganizationStatus,
  },
  defaultRegionCode: {
    defaultValue: "CN",
    key: PLATFORM_SETTING_KEYS.defaultRegionCode,
  },
  defaultTimeZone: {
    defaultValue: "Asia/Shanghai",
    key: PLATFORM_SETTING_KEYS.defaultTimeZone,
    legacyKeys: [LEGACY_PLATFORM_SETTING_KEYS.defaultTimeZone],
  },
  messageServiceEnabled: {
    defaultValue: "false",
    key: PLATFORM_SETTING_KEYS.messageServiceEnabled,
  },
  messageServiceProvider: {
    defaultValue: "internal",
    key: PLATFORM_SETTING_KEYS.messageServiceProvider,
  },
  passwordMinLength: {
    defaultValue: "8",
    key: PLATFORM_SETTING_KEYS.passwordMinLength,
  },
  publicSmtpEnabled: {
    defaultValue: "false",
    key: PLATFORM_SETTING_KEYS.publicSmtpEnabled,
  },
} as const satisfies Record<string, PlatformSettingDefinition>;

export const PLATFORM_ORGANIZATION_SETTING_DEFAULTS: readonly PlatformDefaultSetting[] = [
  ...ORGANIZATION_DEFAULT_FIELD_DEFINITIONS.map((definition) => ({
    name: definition.key,
    value:
      PLATFORM_SETTING_DEFINITIONS[
        getPlatformSettingDefinitionName(definition.key)
      ].defaultValue,
  })),
  ...ORGANIZATION_CONTROL_SETTING_DEFINITIONS.map((definition) => ({
    name: definition.key,
    value:
      PLATFORM_SETTING_DEFINITIONS[
        getPlatformSettingDefinitionName(definition.key)
      ].defaultValue,
  })),
];

export const KNOWN_PLATFORM_SETTING_KEYS = [
  PLATFORM_TITLE_SETTING_KEY,
  ...Object.values(PLATFORM_SETTING_KEYS),
  ...Object.values(LEGACY_PLATFORM_SETTING_KEYS),
] as const;

function getPlatformSettingDefinitionName(key: string) {
  const entry = Object.entries(PLATFORM_SETTING_DEFINITIONS).find(
    ([, definition]) => definition.key === key,
  );
  if (!entry) {
    throw new Error(`Unknown platform setting key: ${key}`);
  }
  return entry[0] as keyof typeof PLATFORM_SETTING_DEFINITIONS;
}
