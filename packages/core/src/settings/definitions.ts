export type SettingOption = {
  label: string;
  value: string;
};

export const SETTING_VALUE_TYPES = [
  "string",
  "boolean",
  "number",
  "json",
  "enum",
  "secret",
] as const;

export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

export type SettingValueOption = SettingOption;

export type SettingScope = "platform" | "workspace";

export const SECRET_SETTING_MASK = "********";

const SECRET_SETTING_KEY_TOKENS = new Set([
  "passwd",
  "password",
  "pwd",
  "secret",
  "sk",
  "token",
]);

const SECRET_SETTING_KEY_PATTERNS = [
  /(?:^|[._:-])api[._:-]?key(?:[._:-]|$)/i,
  /(?:^|[._:-])access[._:-]?key(?:[._:-]|$)/i,
  /(?:^|[._:-])secret[._:-]?key(?:[._:-]|$)/i,
  /(?:^|[._:-])private[._:-]?key(?:[._:-]|$)/i,
  /(?:^|[._:-])client[._:-]?secret(?:[._:-]|$)/i,
  /(?:^|[._:-])app[._:-]?secret(?:[._:-]|$)/i,
  /(?:^|[._:-])verification[._:-]?token(?:[._:-]|$)/i,
  /(?:^|[._:-])encrypt[._:-]?key(?:[._:-]|$)/i,
];

export type PlatformSettingDefinition = {
  defaultValue?: string;
  key: string;
  scope?: SettingScope;
  valueOptions?: readonly SettingValueOption[];
  valueType: SettingValueType;
};

export type PlatformDefaultSetting = {
  name: string;
  value: string;
  valueOptions?: readonly SettingValueOption[];
  valueType: SettingValueType;
};

export type WorkspaceDefaultFieldDefinition = {
  field: "currency" | "dateFormat" | "preferredLanguage" | "regionCode" | "timeZone";
  key: string;
  label: string;
  options: readonly SettingOption[];
  valueType: SettingValueType;
};

export type WorkspaceControlSettingDefinition = {
  key: string;
  label: string;
  options: readonly SettingOption[];
  valueType: SettingValueType;
};

export type FeatureSettingDefinition = {
  defaultValue?: string;
  description: string;
  key: string;
  label: string;
  scope: "platform" | "workspace";
  valueOptions?: readonly SettingValueOption[];
  valueType: "boolean";
};

export const FEATURE_SETTING_KEYS = {
  email: "feature:email:enabled",
  invite: "feature:invite:enabled",
  passwordReset: "feature:password-reset:enabled",
  ticketing: "feature:ticketing:enabled",
  ticketingHandling: "feature:ticketing:handling:enabled",
} as const;

export const PLATFORM_TITLE_SETTING_KEY = "platform.title";
export const PLATFORM_SLOGAN_SETTING_KEY = "platform.slogan";

export const PLATFORM_SETTING_KEYS = {
  workspaceApplicationsEnabled: "platform.workspaceApplicationsEnabled",
  defaultCurrency: "workspace.defaultCurrency",
  defaultDateFormat: "workspace.defaultDateFormat",
  defaultLanguage: "workspace.defaultLanguage",
  defaultRegionCode: "workspace.defaultRegionCode",
  defaultTimeZone: "workspace.defaultTimeZone",
  messageServiceEnabled: "platform.messageServiceEnabled",
  messageServiceProvider: "platform.messageServiceProvider",
  passwordMinLength: "auth.passwordPolicy.minLength",
  publicBaseUrl: "platform.publicBaseUrl",
  publicSmtpEnabled: "platform.publicSmtpEnabled",
  rootDomain: "platform.rootDomain",
  subdomainRoutingEnabled: "platform.subdomainRoutingEnabled",
  ticketingPlatformSubmissionEnabled:
    "platform.ticketing.platformSubmissionEnabled",
  ticketingVisible: "platform.ticketing.visible",
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
  { label: "简体中文", value: "zh-Hans" },
  { label: "English", value: "en" },
  { label: "繁體中文", value: "zh-Hant" },
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

export const WORKSPACE_DEFAULT_FIELD_DEFINITIONS = [
  {
    field: "currency",
    key: PLATFORM_SETTING_KEYS.defaultCurrency,
    label: "货币",
    options: CURRENCY_OPTIONS,
    valueType: "enum",
  },
  {
    field: "timeZone",
    key: PLATFORM_SETTING_KEYS.defaultTimeZone,
    label: "时区",
    options: TIME_ZONE_OPTIONS,
    valueType: "enum",
  },
  {
    field: "regionCode",
    key: PLATFORM_SETTING_KEYS.defaultRegionCode,
    label: "地区代码",
    options: REGION_OPTIONS,
    valueType: "enum",
  },
  {
    field: "dateFormat",
    key: PLATFORM_SETTING_KEYS.defaultDateFormat,
    label: "日期格式",
    options: DATE_FORMAT_OPTIONS,
    valueType: "enum",
  },
  {
    field: "preferredLanguage",
    key: PLATFORM_SETTING_KEYS.defaultLanguage,
    label: "默认语言",
    options: LANGUAGE_OPTIONS,
    valueType: "enum",
  },
] as const satisfies readonly WorkspaceDefaultFieldDefinition[];

export const WORKSPACE_CONTROL_SETTING_DEFINITIONS = [
  {
    key: PLATFORM_SETTING_KEYS.passwordMinLength,
    label: "密码最小长度",
    options: PASSWORD_LENGTH_OPTIONS,
    valueType: "enum",
  },
] as const satisfies readonly WorkspaceControlSettingDefinition[];

export const PLATFORM_SETTING_DEFINITIONS = {
  workspaceApplicationsEnabled: {
    defaultValue: "true",
    key: PLATFORM_SETTING_KEYS.workspaceApplicationsEnabled,
    scope: "platform",
    valueType: "boolean",
  },
  defaultCurrency: {
    defaultValue: "CNY",
    key: PLATFORM_SETTING_KEYS.defaultCurrency,
    scope: "workspace",
    valueOptions: CURRENCY_OPTIONS,
    valueType: "enum",
  },
  defaultDateFormat: {
    defaultValue: "YYYY-MM-DD",
    key: PLATFORM_SETTING_KEYS.defaultDateFormat,
    scope: "workspace",
    valueOptions: DATE_FORMAT_OPTIONS,
    valueType: "enum",
  },
  defaultLanguage: {
    defaultValue: "zh-Hans",
    key: PLATFORM_SETTING_KEYS.defaultLanguage,
    scope: "workspace",
    valueOptions: LANGUAGE_OPTIONS,
    valueType: "enum",
  },
  defaultRegionCode: {
    defaultValue: "CN",
    key: PLATFORM_SETTING_KEYS.defaultRegionCode,
    scope: "workspace",
    valueOptions: REGION_OPTIONS,
    valueType: "enum",
  },
  defaultTimeZone: {
    defaultValue: "Asia/Shanghai",
    key: PLATFORM_SETTING_KEYS.defaultTimeZone,
    scope: "workspace",
    valueOptions: TIME_ZONE_OPTIONS,
    valueType: "enum",
  },
  messageServiceEnabled: {
    defaultValue: "false",
    key: PLATFORM_SETTING_KEYS.messageServiceEnabled,
    scope: "platform",
    valueType: "boolean",
  },
  messageServiceProvider: {
    defaultValue: "internal",
    key: PLATFORM_SETTING_KEYS.messageServiceProvider,
    scope: "platform",
    valueType: "string",
  },
  passwordMinLength: {
    defaultValue: "8",
    key: PLATFORM_SETTING_KEYS.passwordMinLength,
    scope: "workspace",
    valueOptions: PASSWORD_LENGTH_OPTIONS,
    valueType: "enum",
  },
  publicBaseUrl: {
    defaultValue: "http://localhost:3100",
    key: PLATFORM_SETTING_KEYS.publicBaseUrl,
    scope: "platform",
    valueType: "string",
  },
  publicSmtpEnabled: {
    defaultValue: "false",
    key: PLATFORM_SETTING_KEYS.publicSmtpEnabled,
    scope: "platform",
    valueType: "boolean",
  },
  rootDomain: {
    defaultValue: "localhost",
    key: PLATFORM_SETTING_KEYS.rootDomain,
    scope: "platform",
    valueType: "string",
  },
  subdomainRoutingEnabled: {
    defaultValue: "false",
    key: PLATFORM_SETTING_KEYS.subdomainRoutingEnabled,
    scope: "platform",
    valueType: "boolean",
  },
  ticketingPlatformSubmissionEnabled: {
    defaultValue: "true",
    key: PLATFORM_SETTING_KEYS.ticketingPlatformSubmissionEnabled,
    scope: "platform",
    valueType: "boolean",
  },
  ticketingVisible: {
    defaultValue: "true",
    key: PLATFORM_SETTING_KEYS.ticketingVisible,
    scope: "platform",
    valueType: "boolean",
  },
} as const satisfies Record<string, PlatformSettingDefinition>;

export const FEATURE_SETTING_DEFINITIONS = [
  {
    defaultValue: "true",
    key: FEATURE_SETTING_KEYS.ticketing,
    label: "工作空间工单提交",
    description: "允许工作空间成员提交工单",
    scope: "workspace",
    valueType: "boolean",
  },
  {
    defaultValue: "true",
    key: FEATURE_SETTING_KEYS.ticketingHandling,
    label: "工作空间工单处理",
    description: "允许有处理权限的成员接收、回复并关闭可见工单",
    scope: "workspace",
    valueType: "boolean",
  },
  {
    defaultValue: "true",
    key: FEATURE_SETTING_KEYS.email,
    label: "邮件功能",
    description: "启用或禁用工作空间邮件发送能力",
    scope: "workspace",
    valueType: "boolean",
  },
  {
    defaultValue: "true",
    key: FEATURE_SETTING_KEYS.invite,
    label: "邀请功能",
    description: "允许通过邮件邀请成员加入工作空间",
    scope: "workspace",
    valueType: "boolean",
  },
  {
    key: FEATURE_SETTING_KEYS.passwordReset,
    label: "密码重置",
    description: "允许用户通过邮件重置密码",
    scope: "workspace",
    valueType: "boolean",
  },
  {
    key: "system:maintenance:enabled",
    label: "维护模式",
    description: "开启后仅管理员可访问系统",
    scope: "platform",
    valueType: "boolean",
  },
  {
    key: "system:registration:open",
    label: "开放注册",
    description: "允许新用户自行注册",
    scope: "platform",
    valueType: "boolean",
  },
] as const satisfies readonly FeatureSettingDefinition[];

export const PLATFORM_WORKSPACE_SETTING_DEFAULTS: readonly PlatformDefaultSetting[] = [
  ...WORKSPACE_DEFAULT_FIELD_DEFINITIONS.map((definition) => ({
    name: definition.key,
    value: getPlatformSettingDefinition(definition.key).defaultValue ?? "",
    valueOptions: getPlatformSettingDefinition(definition.key).valueOptions,
    valueType: getPlatformSettingDefinition(definition.key).valueType,
  })),
  ...WORKSPACE_CONTROL_SETTING_DEFINITIONS.map((definition) => ({
    name: definition.key,
    value: getPlatformSettingDefinition(definition.key).defaultValue ?? "",
    valueOptions: getPlatformSettingDefinition(definition.key).valueOptions,
    valueType: getPlatformSettingDefinition(definition.key).valueType,
  })),
];

export const KNOWN_PLATFORM_SETTING_KEYS = [
  PLATFORM_TITLE_SETTING_KEY,
  PLATFORM_SLOGAN_SETTING_KEY,
  ...Object.values(PLATFORM_SETTING_KEYS),
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

function getPlatformSettingDefinition(key: string): PlatformSettingDefinition {
  return PLATFORM_SETTING_DEFINITIONS[getPlatformSettingDefinitionName(key)];
}

export function isSettingValueType(value: unknown): value is SettingValueType {
  return (
    typeof value === "string" &&
    SETTING_VALUE_TYPES.includes(value as SettingValueType)
  );
}

export function maskSettingValue(
  value: string | null,
  valueType: SettingValueType,
) {
  return valueType === "secret" && value !== null ? SECRET_SETTING_MASK : value;
}

export function resolveSettingValueType(
  name: string,
  valueType?: SettingValueType | string | null,
): SettingValueType {
  const definition = getSettingDefinitionByKey(name);
  if (definition && (!isSettingValueType(valueType) || valueType === "string")) {
    return definition.valueType;
  }
  const inferredValueType = inferSettingValueTypeFromKey(name);
  if (
    inferredValueType &&
    (!isSettingValueType(valueType) || valueType === "string")
  ) {
    return inferredValueType;
  }
  return isSettingValueType(valueType)
    ? valueType
    : (definition?.valueType ?? inferredValueType ?? "string");
}

export function resolveSettingValueOptions(
  name: string,
  valueOptions?: readonly SettingValueOption[] | null,
) {
  const definitionOptions = getSettingDefinitionByKey(name)?.valueOptions ?? null;
  if (valueOptions?.length) return valueOptions;
  return definitionOptions ?? valueOptions ?? null;
}

export function getSettingDefinitionByKey(
  key: string,
): FeatureSettingDefinition | PlatformSettingDefinition | undefined {
  const platformDefinition = Object.values(PLATFORM_SETTING_DEFINITIONS).find(
    (definition) => definition.key === key,
  );
  if (platformDefinition) return platformDefinition;

  return FEATURE_SETTING_DEFINITIONS.find((definition) => definition.key === key);
}

export function getFeatureSettingDefaultValue(
  definition: FeatureSettingDefinition,
  fallback = "false",
) {
  return definition.defaultValue ?? fallback;
}

export function inferSettingValueTypeFromKey(
  key: string,
): SettingValueType | null {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  if (SECRET_SETTING_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "secret";
  }

  const tokens = normalized.split(/[._:-]+/).filter(Boolean);
  return tokens.some((token) => SECRET_SETTING_KEY_TOKENS.has(token))
    ? "secret"
    : null;
}
