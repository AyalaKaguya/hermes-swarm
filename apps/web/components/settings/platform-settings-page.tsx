"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { PlatformMemberManagement } from "@/components/platform-member-management";
import { PlatformRolePermissions } from "@/components/platform-role-permissions";
import {
  SettingsCard,
  SettingsFieldRow,
  SettingsPageHeader,
} from "@/components/settings/settings-page";
import {
  CustomSettingDialog,
  SettingEditDialog,
  SettingValueInput,
  type CustomSettingSubmit,
} from "@/components/settings/settings-value-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  getPlatformSmtpConfig,
  listSystemSettings,
  savePlatformSmtpConfig,
  saveSystemSettings,
  type SettingPayloadEntry,
  type SettingPayloadValue,
  type SmtpConfig,
  type SystemSettingDto,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import {
  formatRuntimeCurrency,
  formatRuntimeDateTime,
} from "@/lib/runtime-format";
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  KNOWN_PLATFORM_SETTING_KEYS,
  LANGUAGE_OPTIONS,
  PASSWORD_LENGTH_OPTIONS,
  PLATFORM_SETTING_DEFINITIONS,
  PLATFORM_TITLE_SETTING_KEY,
  REGION_OPTIONS,
  resolveSettingValueOptions,
  resolveSettingValueType,
  TIME_ZONE_OPTIONS,
} from "@hermes-swarm/core/settings/definitions";
import { normalizeCanonicalLanguage } from "@hermes-swarm/core/settings/runtime-preferences";

type PlatformForm = {
  workspaceApplicationsEnabled: boolean;
  defaultCurrency: string;
  defaultDateFormat: string;
  defaultLanguage: string;
  defaultRegionCode: string;
  defaultTimeZone: string;
  messageServiceEnabled: boolean;
  messageServiceProvider: string;
  passwordMinLength: string;
  platformTitle: string;
  publicBaseUrl: string;
  publicSmtpEnabled: boolean;
  rootDomain: string;
  smtpFromAddress: string;
  smtpHost: string;
  smtpPassword: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  subdomainRoutingEnabled: boolean;
  ticketingPlatformSubmissionEnabled: boolean;
  ticketingVisible: boolean;
};

export type PlatformSection =
  | "administrators"
  | "email"
  | "general"
  | "governance"
  | "localization"
  | "parameters"
  | "roles"
  | "services";

export function PlatformSettingsPage({
  section,
}: {
  section: PlatformSection;
}) {
  const tr = useTextTranslation();
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const notifications = useNotifications();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PlatformForm>(emptyPlatformForm());
  const [systemSettings, setSystemSettings] = useState<SystemSettingDto[]>([]);
  const [customSystemSettingToDelete, setCustomSystemSettingToDelete] =
    useState<CustomSettingSubmit | null>(null);
  const [savingCustomSetting, setSavingCustomSetting] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);

  const canViewPlatform =
    snapshot && resolvedSession
      ? access.hasPageAccess("settings.platform")
      : false;
  const canManagePlatform =
    snapshot && resolvedSession
      ? access.hasPermission("setting.platform_config.save:platform")
      : false;
  const canViewPlatformRoles =
    snapshot && resolvedSession
      ? access.hasPermission("role.platform_role.list:platform")
      : false;
  const canCreatePlatformRole =
    snapshot && resolvedSession
      ? access.hasPermission("role.platform_role.create:platform")
      : false;
  const canUpdatePlatformRole =
    snapshot && resolvedSession
      ? access.hasPermission("role.platform_role.update_basic:platform")
      : false;
  const canConfigurePlatformRolePermissions =
    snapshot && resolvedSession
      ? access.hasPermission("role.platform_role.replace_permissions:platform")
      : false;
  const canDeletePlatformRole =
    snapshot && resolvedSession
      ? access.hasPermission("role.platform_role.delete:platform")
      : false;
  const canViewPlatformMembers =
    snapshot && resolvedSession
      ? access.hasPermission("user.platform_member.list:platform")
      : false;
  const canCreatePlatformMember =
    snapshot && resolvedSession
      ? access.hasPermission("user.platform_member.create:platform")
      : false;
  const canUpdatePlatformMember =
    snapshot && resolvedSession
      ? access.hasPermission("user.platform_member.update:platform")
      : false;
  const canRemovePlatformMember =
    snapshot && resolvedSession
      ? access.hasPermission("user.platform_member.remove:platform")
      : false;
  const publicSmtpMissingHost =
    form.publicSmtpEnabled && !form.smtpHost.trim();
  const customSystemSettings = useMemo(() => {
    const knownNames = new Set<string>(KNOWN_PLATFORM_SETTING_KEYS);
    return systemSettings.filter((setting) => !knownNames.has(setting.name));
  }, [systemSettings]);

  const load = useCallback(async () => {
    if (!canViewPlatform) {
      setLoading(false);
      return;
    }

    const token = await getAuthenticatedAdminSessionMarker();
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [settings, smtp] = await Promise.all([
        listSystemSettings(token),
        getPlatformSmtpConfig(token).catch(() => null),
      ]);
      setForm(toPlatformForm(settings, smtp));
      setSystemSettings(settings);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [canViewPlatform, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField<K extends keyof PlatformForm>(
    key: K,
    value: PlatformForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function savePlatform(targetSection: PlatformSection) {
    if (!canManagePlatform) return;

    setSavingPlatform(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await saveSystemSettings(token, {
        settings: platformSettingsForSection(targetSection, form),
      });
      notifications.success(tr("平台设置已保存"));
      await refreshSnapshot();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("保存失败"));
    } finally {
      setSavingPlatform(false);
    }
  }

  async function savePublicSmtp() {
    if (!canManagePlatform) return;

    setSavingSmtp(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await saveSystemSettings(token, {
        settings: [
          platformSettingEntry("publicSmtpEnabled", form.publicSmtpEnabled),
        ],
      });
      if (form.publicSmtpEnabled || form.smtpHost.trim()) {
        await savePlatformSmtpConfig(token, {
          fromAddress: nullableText(form.smtpFromAddress),
          host: form.smtpHost,
          password: nullableText(form.smtpPassword) ?? undefined,
          port: Number(form.smtpPort),
          secure: form.smtpSecure,
          username: nullableText(form.smtpUsername),
        });
      }
      notifications.success(tr("公共 SMTP 已保存"));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("保存失败"));
    } finally {
      setSavingSmtp(false);
    }
  }

  async function saveCustomSystemSetting(setting: CustomSettingSubmit) {
    const settingName = setting.name.trim();
    if (!canManagePlatform || !settingName) return;

    setSavingCustomSetting(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await saveSystemSettings(token, {
        settings: [{ ...setting, name: settingName }],
      });
      notifications.success(
        setting.value === null
          ? tr("平台自定义设置已删除")
          : tr("平台自定义设置已保存"),
      );
      await load();
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("保存失败"));
    } finally {
      setSavingCustomSetting(false);
    }
  }

  if (!canViewPlatform) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
          {tr("当前账号无权访问平台设置。")}
        </div>
      </div>
    );
  }

  const saveButton = (targetSection: PlatformSection) => (
    <Button
      disabled={!canManagePlatform || savingPlatform}
      onClick={() => void savePlatform(targetSection)}
      type="button"
    >
      {savingPlatform ? tr("保存中...") : tr("保存")}
    </Button>
  );

  return (
    <section className="grid gap-4">
      <SettingsPageHeader
        description={tr(platformSectionDescription(section))}
        title={tr(platformSectionTitle(section))}
      />

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {section === "general" && (
        <SettingsCard
          actions={saveButton("general")}
          description={tr("用于全局展示和识别当前平台的基础信息")}
          loading={loading}
          loadingLabel={tr("加载中...")}
          title={tr("平台信息")}
        >
          <div className="grid gap-3">
            <SettingsFieldRow htmlFor="platform-title" label={tr("平台名称")}>
              <Input
                disabled={!canManagePlatform}
                id="platform-title"
                onChange={(event) =>
                  updateField("platformTitle", event.target.value)
                }
                placeholder="Hermes Swarm"
                value={form.platformTitle}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-public-base-url"
              label={tr("访问地址")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-public-base-url"
                onChange={(event) =>
                  updateField("publicBaseUrl", event.target.value)
                }
                placeholder="https://console.example.com"
                value={form.publicBaseUrl}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-root-domain"
              label={tr("主域名")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-root-domain"
                onChange={(event) =>
                  updateField("rootDomain", event.target.value)
                }
                placeholder="example.com"
                value={form.rootDomain}
              />
            </SettingsFieldRow>
            <PlatformToggleRow
              checked={form.subdomainRoutingEnabled}
              disabled={!canManagePlatform}
              id="platform-subdomain-routing"
              label={tr("启用工作空间子域名路由")}
              onCheckedChange={(checked) =>
                updateField("subdomainRoutingEnabled", checked)
              }
            />
          </div>
        </SettingsCard>
      )}

      {section === "localization" && (
        <SettingsCard
          actions={saveButton("localization")}
          description={tr(
            "作为工作空间本地化设置的平台默认值，可由工作空间覆写",
          )}
          loading={loading}
          loadingLabel={tr("加载中...")}
          title={tr("区域与默认值")}
        >
          <div className="grid gap-3">
            <SettingsFieldRow
              htmlFor="platform-language"
              label={tr("默认语言")}
            >
              <Select
                disabled={!canManagePlatform}
                onValueChange={(value) => updateField("defaultLanguage", value)}
                value={form.defaultLanguage}
              >
                <SelectTrigger id="platform-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-time-zone"
              label={tr("默认时区")}
            >
              <Select
                disabled={!canManagePlatform}
                onValueChange={(value) => updateField("defaultTimeZone", value)}
                value={form.defaultTimeZone}
              >
                <SelectTrigger id="platform-time-zone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_ZONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {tr(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-currency"
              label={tr("默认货币")}
            >
              <Select
                disabled={!canManagePlatform}
                onValueChange={(value) => updateField("defaultCurrency", value)}
                value={form.defaultCurrency}
              >
                <SelectTrigger id="platform-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {tr(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-region-code"
              label={tr("默认地区代码")}
            >
              <Select
                disabled={!canManagePlatform}
                onValueChange={(value) => updateField("defaultRegionCode", value)}
                value={form.defaultRegionCode}
              >
                <SelectTrigger id="platform-region-code">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {tr(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-date-format"
              label={tr("默认日期格式")}
            >
              <Select
                disabled={!canManagePlatform}
                onValueChange={(value) => updateField("defaultDateFormat", value)}
                value={form.defaultDateFormat}
              >
                <SelectTrigger id="platform-date-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMAT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {tr(option.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>
          </div>
          <LocalizationPreview form={form} tr={tr} />
        </SettingsCard>
      )}

      {section === "governance" && (
        <SettingsCard
          actions={saveButton("governance")}
          description={tr("控制新工作空间和账号安全策略的默认行为")}
          loading={loading}
          loadingLabel={tr("加载中...")}
          title={tr("工作空间治理")}
        >
          <div className="grid gap-3">
            <PlatformToggleRow
              checked={form.workspaceApplicationsEnabled}
              disabled={!canManagePlatform}
              id="platform-workspace-applications"
              label={tr("允许申请工作空间")}
              onCheckedChange={(checked) =>
                updateField("workspaceApplicationsEnabled", checked)
              }
            />
            <SettingsFieldRow
              htmlFor="platform-password-min-length"
              label={tr("密码最小长度")}
            >
              <Select
                disabled={!canManagePlatform}
                onValueChange={(value) => updateField("passwordMinLength", value)}
                value={form.passwordMinLength}
              >
                <SelectTrigger id="platform-password-min-length">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PASSWORD_LENGTH_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsFieldRow>
          </div>
        </SettingsCard>
      )}

      {section === "services" && (
        <SettingsCard
          actions={saveButton("services")}
          description={tr("管理平台级消息与工单服务")}
          loading={loading}
          loadingLabel={tr("加载中...")}
          title={tr("公共服务")}
        >
          <div className="grid gap-3">
            <PlatformToggleRow
              checked={form.messageServiceEnabled}
              disabled={!canManagePlatform}
              id="platform-message-enabled"
              label={tr("启用公共消息服务")}
              onCheckedChange={(checked) =>
                updateField("messageServiceEnabled", checked)
              }
            />
            <SettingsFieldRow
              description={tr("平台级公共消息服务提供方")}
              htmlFor="platform-message-provider"
              label={tr("消息服务提供方")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-message-provider"
                onChange={(event) =>
                  updateField("messageServiceProvider", event.target.value)
                }
                placeholder="internal"
                value={form.messageServiceProvider}
              />
            </SettingsFieldRow>
            <PlatformToggleRow
              checked={form.ticketingVisible}
              disabled={!canManagePlatform}
              id="platform-ticketing-visible"
              label={tr("显示工单入口")}
              onCheckedChange={(checked) =>
                updateField("ticketingVisible", checked)
              }
            />
            <PlatformToggleRow
              checked={form.ticketingPlatformSubmissionEnabled}
              disabled={!canManagePlatform || !form.ticketingVisible}
              id="platform-ticketing-platform-submission"
              label={tr("允许提交平台工单")}
              onCheckedChange={(checked) =>
                updateField("ticketingPlatformSubmissionEnabled", checked)
              }
            />
          </div>
        </SettingsCard>
      )}

      {section === "email" && (
        <SettingsCard
          actions={
            <Button
              disabled={!canManagePlatform || savingSmtp || publicSmtpMissingHost}
              onClick={() => void savePublicSmtp()}
              type="button"
            >
              {savingSmtp ? tr("保存中...") : tr("保存")}
            </Button>
          }
          description={tr("工作空间未配置 SMTP 时使用的平台公共邮件服务")}
          loading={loading}
          loadingLabel={tr("加载中...")}
          title={tr("公共 SMTP")}
        >
          <div className="grid gap-3">
            <PlatformToggleRow
              checked={form.publicSmtpEnabled}
              disabled={!canManagePlatform}
              id="platform-smtp-enabled"
              label={tr("启用公共 SMTP")}
              onCheckedChange={(checked) =>
                updateField("publicSmtpEnabled", checked)
              }
            />
            <SettingsFieldRow
              htmlFor="platform-smtp-host"
              label={tr("SMTP 服务器")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-smtp-host"
                onChange={(event) => updateField("smtpHost", event.target.value)}
                value={form.smtpHost}
              />
            </SettingsFieldRow>
            <SettingsFieldRow htmlFor="platform-smtp-port" label={tr("端口")}>
              <Input
                disabled={!canManagePlatform}
                id="platform-smtp-port"
                inputMode="numeric"
                onChange={(event) => updateField("smtpPort", event.target.value)}
                value={form.smtpPort}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-smtp-from"
              label={tr("发件地址")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-smtp-from"
                onChange={(event) =>
                  updateField("smtpFromAddress", event.target.value)
                }
                value={form.smtpFromAddress}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              htmlFor="platform-smtp-username"
              label={tr("用户名")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-smtp-username"
                onChange={(event) =>
                  updateField("smtpUsername", event.target.value)
                }
                value={form.smtpUsername}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              description={tr("留空则保留当前密码")}
              htmlFor="platform-smtp-password"
              label={tr("密码")}
            >
              <Input
                disabled={!canManagePlatform}
                id="platform-smtp-password"
                onChange={(event) =>
                  updateField("smtpPassword", event.target.value)
                }
                placeholder={tr("留空则保留当前密码")}
                type="password"
                value={form.smtpPassword}
              />
            </SettingsFieldRow>
            <PlatformToggleRow
              checked={form.smtpSecure}
              disabled={!canManagePlatform}
              id="platform-smtp-secure"
              label={tr("启用 SSL/TLS")}
              onCheckedChange={(checked) => updateField("smtpSecure", checked)}
            />
          </div>
        </SettingsCard>
      )}

      {section === "administrators" &&
        (loading ? (
          <SettingsLoading label={tr("加载中...")} />
        ) : (
          <PlatformMemberManagement
            canCreateMember={canCreatePlatformMember}
            canRemoveMember={canRemovePlatformMember}
            canUpdateMember={canUpdatePlatformMember}
            canViewMembers={canViewPlatformMembers}
            canViewRoles={canViewPlatformRoles}
            onChanged={refreshSnapshot}
          />
        ))}

      {section === "roles" &&
        (loading ? (
          <SettingsLoading label={tr("加载中...")} />
        ) : (
          <PlatformRolePermissions
            canCreateRole={canCreatePlatformRole}
            canDeleteRole={canDeletePlatformRole}
            canManagePermissions={canConfigurePlatformRolePermissions}
            canUpdateRole={canUpdatePlatformRole}
            canViewRoles={canViewPlatformRoles}
          />
        ))}

      {section === "parameters" && (
        <SettingsCard
          description={tr("平台定义参数名称、类型、范围和默认值")}
          headerActions={
            <CustomSettingDialog
              disabled={!canManagePlatform || savingCustomSetting}
              idPrefix="platform-custom-setting"
              onSubmit={saveCustomSystemSetting}
              scopeOptions={[
                { label: "平台", value: "platform" },
                { label: "工作空间", value: "workspace" },
              ]}
              showScope
              saving={savingCustomSetting}
              title={tr("添加平台设置")}
            />
          }
          loading={loading}
          loadingLabel={tr("加载中...")}
          title={tr("参数设置")}
        >
          <div className="grid gap-2">
            {customSystemSettings.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                {tr("暂无自定义平台设置")}
              </div>
            ) : (
              customSystemSettings.map((setting) => {
                const settingValueType = resolveSettingValueType(
                  setting.name,
                  setting.valueType,
                );
                const settingValueOptions = resolveSettingValueOptions(
                  setting.name,
                  setting.valueOptions,
                );
                const settingValueOptionsPayload =
                  cloneSettingOptions(settingValueOptions);

                return (
                  <div
                    className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(16rem,1fr)_minmax(8rem,24rem)_auto] sm:items-center"
                    key={setting.id}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-xs">
                        {setting.name}
                      </span>
                      <Badge variant="outline">
                        {tr(setting.scope === "workspace" ? "工作空间" : "平台")}
                      </Badge>
                    </div>
                    <div className="min-w-0 sm:justify-self-end">
                      <SettingValueInput
                        className="justify-end"
                        disabled={!canManagePlatform || savingCustomSetting}
                        id={`platform-custom-${setting.id}`}
                        inputClassName="h-8 w-full font-mono text-xs"
                        onCommit={(nextValue) => {
                          if (
                            settingValueType === "secret" ||
                            String(nextValue ?? "") !== (setting.value ?? "")
                          ) {
                            void saveCustomSystemSetting({
                              name: setting.name,
                              value: nextValue,
                              valueOptions: settingValueOptionsPayload,
                              valueType: settingValueType,
                            });
                          }
                        }}
                        value={setting.value ?? ""}
                        valueOptions={settingValueOptions}
                        valueType={settingValueType}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <SettingEditDialog
                        disabled={!canManagePlatform || savingCustomSetting}
                        idPrefix={`platform-custom-${setting.id}`}
                        name={setting.name}
                        onSubmit={saveCustomSystemSetting}
                        saving={savingCustomSetting}
                        value={setting.value ?? ""}
                        valueOptions={settingValueOptions}
                        valueType={settingValueType}
                      />
                      <Button
                        aria-label={`${tr("删除平台设置")} ${setting.name}`}
                        disabled={!canManagePlatform || savingCustomSetting}
                        onClick={() =>
                          setCustomSystemSettingToDelete({
                            name: setting.name,
                            value: null,
                            valueOptions: settingValueOptionsPayload,
                            valueType: settingValueType,
                          })
                        }
                        size="icon"
                        title={
                          !canManagePlatform
                            ? tr("当前账号无权修改平台设置")
                            : `${tr("删除平台设置")} ${setting.name}`
                        }
                        type="button"
                        variant="ghost"
                      >
                        <AppIcon className="size-4" name="trash" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SettingsCard>
      )}

      <ConfirmActionDialog
        confirmLabel={tr("删除")}
        description={
          customSystemSettingToDelete
            ? `${tr("将删除平台自定义设置")} ${
                customSystemSettingToDelete.name
              }。${tr("工作空间中的同名覆盖值也会一并删除。")}`
            : ""
        }
        onConfirm={() => {
          if (customSystemSettingToDelete) {
            void saveCustomSystemSetting(customSystemSettingToDelete);
          }
          setCustomSystemSettingToDelete(null);
        }}
        onOpenChange={(open) => {
          if (!open) setCustomSystemSettingToDelete(null);
        }}
        open={Boolean(customSystemSettingToDelete)}
        pending={savingCustomSetting}
        title={tr("删除平台设置")}
      />
    </section>
  );
}

function PlatformToggleRow({
  checked,
  disabled,
  id,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingsFieldRow htmlFor={id} label={label}>
      <div className="flex justify-end">
        <Switch
          checked={checked}
          disabled={disabled}
          id={id}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </SettingsFieldRow>
  );
}

function SettingsLoading({ label }: { label: string }) {
  return (
    <div className="rounded-md border py-16 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function LocalizationPreview({
  form,
  tr,
}: {
  form: PlatformForm;
  tr: (value: string) => string;
}) {
  const sampleDate = new Date("2026-07-17T01:30:00.000Z");
  let dateText = "2026-07-17 09:30";
  let currencyText = `${form.defaultCurrency} 1,234.56`;
  try {
    const previewPreferences = {
      currency: form.defaultCurrency,
      dateFormat: form.defaultDateFormat,
      language: normalizeCanonicalLanguage(form.defaultLanguage) ?? "zh-Hans",
      regionCode: form.defaultRegionCode,
      sources: {
        currency: "platform" as const,
        dateFormat: "platform" as const,
        language: "platform" as const,
        regionCode: "platform" as const,
        timeZone: "platform" as const,
      },
      timeZone: form.defaultTimeZone,
    };
    dateText = formatRuntimeDateTime(sampleDate, previewPreferences);
    currencyText = formatRuntimeCurrency(1234.56, previewPreferences);
  } catch {
    // Keep stable examples while the form contains an intermediate value.
  }

  return (
    <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
      <div>
        <div className="text-xs text-muted-foreground">{tr("日期时间预览")}</div>
        <div className="mt-1 text-sm font-medium">{dateText}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{tr("货币预览")}</div>
        <div className="mt-1 text-sm font-medium">{currencyText}</div>
      </div>
    </div>
  );
}

function platformSectionTitle(section: PlatformSection) {
  switch (section) {
    case "localization":
      return "区域与默认值";
    case "governance":
      return "工作空间治理";
    case "services":
      return "公共服务";
    case "email":
      return "公共 SMTP";
    case "administrators":
      return "平台管理员";
    case "roles":
      return "角色与权限";
    case "parameters":
      return "参数设置";
    default:
      return "平台信息";
  }
}

function platformSectionDescription(section: PlatformSection) {
  switch (section) {
    case "localization":
      return "设置工作空间默认使用的语言、时区、货币、地区和日期格式";
    case "governance":
      return "管理工作空间创建、默认状态和账号安全策略";
    case "services":
      return "管理平台级消息与工单服务";
    case "email":
      return "管理工作空间可继承的公共邮件服务";
    case "administrators":
      return "管理平台管理员账号和角色分配";
    case "roles":
      return "管理平台角色及其权限范围";
    case "parameters":
      return "管理平台和工作空间可使用的自定义参数";
    default:
      return "维护平台名称、访问地址和主域名";
  }
}

function emptyPlatformForm(): PlatformForm {
  return {
    workspaceApplicationsEnabled: true,
    defaultCurrency: PLATFORM_SETTING_DEFINITIONS.defaultCurrency.defaultValue,
    defaultDateFormat:
      PLATFORM_SETTING_DEFINITIONS.defaultDateFormat.defaultValue,
    defaultLanguage: PLATFORM_SETTING_DEFINITIONS.defaultLanguage.defaultValue,
    defaultRegionCode:
      PLATFORM_SETTING_DEFINITIONS.defaultRegionCode.defaultValue,
    defaultTimeZone: PLATFORM_SETTING_DEFINITIONS.defaultTimeZone.defaultValue,
    messageServiceEnabled: false,
    messageServiceProvider:
      PLATFORM_SETTING_DEFINITIONS.messageServiceProvider.defaultValue,
    passwordMinLength:
      PLATFORM_SETTING_DEFINITIONS.passwordMinLength.defaultValue,
    platformTitle: "",
    publicBaseUrl: PLATFORM_SETTING_DEFINITIONS.publicBaseUrl.defaultValue,
    publicSmtpEnabled: false,
    rootDomain: PLATFORM_SETTING_DEFINITIONS.rootDomain.defaultValue,
    smtpFromAddress: "",
    smtpHost: "",
    smtpPassword: "",
    smtpPort: "587",
    smtpSecure: false,
    smtpUsername: "",
    subdomainRoutingEnabled: false,
    ticketingPlatformSubmissionEnabled: true,
    ticketingVisible: true,
  };
}

function toPlatformForm(settings: SystemSettingDto[], smtp: SmtpConfig | null) {
  const get = (name: string) =>
    settings.find((setting) => setting.name === name)?.value;
  const getDefined = (name: keyof typeof PLATFORM_SETTING_DEFINITIONS) => {
    const definition = PLATFORM_SETTING_DEFINITIONS[name];
    return get(definition.key) ?? definition.defaultValue ?? "";
  };
  return {
    workspaceApplicationsEnabled: parseBoolean(
      getDefined("workspaceApplicationsEnabled"),
      true,
    ),
    defaultCurrency: getDefined("defaultCurrency"),
    defaultDateFormat: getDefined("defaultDateFormat"),
    defaultLanguage:
      normalizeCanonicalLanguage(getDefined("defaultLanguage")) ?? "zh-Hans",
    defaultRegionCode: getDefined("defaultRegionCode"),
    defaultTimeZone: getDefined("defaultTimeZone"),
    messageServiceEnabled: parseBoolean(
      getDefined("messageServiceEnabled"),
      false,
    ),
    messageServiceProvider: getDefined("messageServiceProvider"),
    passwordMinLength: getDefined("passwordMinLength"),
    platformTitle: get(PLATFORM_TITLE_SETTING_KEY) || "",
    publicBaseUrl: getDefined("publicBaseUrl"),
    publicSmtpEnabled: parseBoolean(getDefined("publicSmtpEnabled"), false),
    rootDomain: getDefined("rootDomain"),
    smtpFromAddress: smtp?.fromAddress ?? "",
    smtpHost: smtp?.host ?? "",
    smtpPassword: "",
    smtpPort: smtp?.port ? String(smtp.port) : "587",
    smtpSecure: Boolean(smtp?.secure),
    smtpUsername: smtp?.username ?? "",
    subdomainRoutingEnabled: parseBoolean(
      getDefined("subdomainRoutingEnabled"),
      false,
    ),
    ticketingPlatformSubmissionEnabled: parseBoolean(
      getDefined("ticketingPlatformSubmissionEnabled"),
      true,
    ),
    ticketingVisible: parseBoolean(getDefined("ticketingVisible"), true),
  } satisfies PlatformForm;
}

function parseBoolean(value: string | null | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function platformSettingEntry<K extends keyof typeof PLATFORM_SETTING_DEFINITIONS>(
  key: K,
  value: SettingPayloadValue,
): SettingPayloadEntry {
  const definition = PLATFORM_SETTING_DEFINITIONS[key];
  return {
    name: definition.key,
    value,
    valueOptions:
      "valueOptions" in definition
        ? cloneSettingOptions(definition.valueOptions)
        : null,
    valueType: definition.valueType,
  };
}

function platformSettingsForSection(
  section: PlatformSection,
  form: PlatformForm,
): SettingPayloadEntry[] {
  switch (section) {
    case "general":
      return [
        {
          name: PLATFORM_TITLE_SETTING_KEY,
          scope: "platform",
          value: form.platformTitle.trim() || null,
          valueType: "string",
        },
        platformSettingEntry("publicBaseUrl", form.publicBaseUrl),
        platformSettingEntry("rootDomain", form.rootDomain),
        platformSettingEntry(
          "subdomainRoutingEnabled",
          form.subdomainRoutingEnabled,
        ),
      ];
    case "localization":
      return [
        platformSettingEntry("defaultCurrency", form.defaultCurrency),
        platformSettingEntry("defaultDateFormat", form.defaultDateFormat),
        platformSettingEntry("defaultLanguage", form.defaultLanguage),
        platformSettingEntry("defaultRegionCode", form.defaultRegionCode),
        platformSettingEntry("defaultTimeZone", form.defaultTimeZone),
      ];
    case "governance":
      return [
        platformSettingEntry(
          "workspaceApplicationsEnabled",
          form.workspaceApplicationsEnabled,
        ),
        platformSettingEntry("passwordMinLength", form.passwordMinLength),
      ];
    case "services":
      return [
        platformSettingEntry(
          "messageServiceEnabled",
          form.messageServiceEnabled,
        ),
        platformSettingEntry(
          "messageServiceProvider",
          form.messageServiceProvider.trim(),
        ),
        platformSettingEntry("ticketingVisible", form.ticketingVisible),
        platformSettingEntry(
          "ticketingPlatformSubmissionEnabled",
          form.ticketingPlatformSubmissionEnabled,
        ),
      ];
    default:
      return [];
  }
}

function cloneSettingOptions(
  options?: readonly { label: string; value: string }[] | null,
) {
  return options?.map((option) => ({ ...option })) ?? null;
}
