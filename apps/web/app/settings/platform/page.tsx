"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { PlatformMemberManagement } from "@/components/platform-member-management";
import { PlatformRolePermissions } from "@/components/platform-role-permissions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  CustomSettingDialog,
  SettingEditDialog,
  SettingValueInput,
  type CustomSettingSubmit,
} from "@/components/settings-value-input";
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  KNOWN_PLATFORM_SETTING_KEYS,
  LANGUAGE_OPTIONS,
  ORGANIZATION_STATUS_OPTIONS,
  PASSWORD_LENGTH_OPTIONS,
  PLATFORM_SETTING_DEFINITIONS,
  PLATFORM_TITLE_SETTING_KEY,
  REGION_OPTIONS,
  resolveSettingValueOptions,
  resolveSettingValueType,
  TIME_ZONE_OPTIONS,
} from "@hermes-swarm/core/settings/definitions";
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
  getAuthenticatedAdminToken,
  requireAuthenticatedAdminToken,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";

type PlatformForm = {
  allowOrganizationCreation: boolean;
  defaultCurrency: string;
  defaultDateFormat: string;
  defaultLanguage: string;
  defaultOrganizationStatus: "active" | "suspended";
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

type PlatformTab =
  | "admins"
  | "custom"
  | "defaults"
  | "messaging"
  | "profile"
  | "roles"
  | "smtp";

export default function PlatformPage() {
  const tr = useTextTranslation();
  const searchParams = useSearchParams();
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const notifications = useNotifications();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<PlatformTab>("profile");
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
  const canSearchPlatformUsers =
    snapshot && resolvedSession
      ? access.hasPermission("user.platform_user.search:platform")
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

    const token = await getAuthenticatedAdminToken();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [canViewPlatform, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setActiveTab(
      requestedTab === "organization"
        ? "defaults"
        : isPlatformTab(requestedTab)
          ? requestedTab
          : "profile",
    );
  }, [requestedTab]);

  function updateField<K extends keyof PlatformForm>(
    key: K,
    value: PlatformForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function savePlatform() {
    if (!canManagePlatform) return;

    setSavingPlatform(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminToken();
      await saveSystemSettings(token, {
        settings: [
          {
            name: PLATFORM_TITLE_SETTING_KEY,
            value: form.platformTitle.trim() || null,
            valueType: "string",
          },
          platformSettingEntry(
            "allowOrganizationCreation",
            form.allowOrganizationCreation,
          ),
          platformSettingEntry(
            "defaultOrganizationStatus",
            form.defaultOrganizationStatus,
          ),
          platformSettingEntry("defaultCurrency", form.defaultCurrency),
          platformSettingEntry("defaultDateFormat", form.defaultDateFormat),
          platformSettingEntry("defaultLanguage", form.defaultLanguage),
          platformSettingEntry("defaultRegionCode", form.defaultRegionCode),
          platformSettingEntry("defaultTimeZone", form.defaultTimeZone),
          platformSettingEntry("passwordMinLength", form.passwordMinLength),
          platformSettingEntry("publicBaseUrl", form.publicBaseUrl),
          platformSettingEntry("rootDomain", form.rootDomain),
          platformSettingEntry(
            "subdomainRoutingEnabled",
            form.subdomainRoutingEnabled,
          ),
          platformSettingEntry(
            "messageServiceEnabled",
            form.messageServiceEnabled,
          ),
          platformSettingEntry(
            "messageServiceProvider",
            form.messageServiceProvider.trim() || null,
          ),
          platformSettingEntry("publicSmtpEnabled", form.publicSmtpEnabled),
          platformSettingEntry("ticketingVisible", form.ticketingVisible),
          platformSettingEntry(
            "ticketingPlatformSubmissionEnabled",
            form.ticketingPlatformSubmissionEnabled,
          ),
        ],
      });
      notifications.success(tr("平台设置已保存"));
      await refreshSnapshot();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSavingPlatform(false);
    }
  }

  async function savePublicSmtp() {
    if (!canManagePlatform) return;

    setSavingSmtp(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminToken();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSavingSmtp(false);
    }
  }

  async function saveCustomSystemSetting(setting: CustomSettingSubmit) {
    const { scope: _scope, ...payload } = setting;
    const settingName = payload.name.trim();
    if (!canManagePlatform || !settingName) return;

    setSavingCustomSetting(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminToken();
      await saveSystemSettings(token, {
        settings: [{ ...payload, name: settingName }],
      });
      notifications.success(
        payload.value === null
          ? tr("平台自定义设置已删除")
          : tr("平台自定义设置已保存"),
      );
      await load();
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {tr("加载中...")}
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("平台设置")}</h1>
          <p className="text-sm">{tr("平台默认值、组织治理与公共服务")}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <Tabs className="grid gap-4" value={activeTab}>
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>{tr("平台信息")}</CardTitle>
              <CardDescription>
                {tr("用于全局展示和识别当前平台的基础信息")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field htmlFor="platform-title" label={tr("平台名称")}>
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-title"
                    onChange={(event) =>
                      updateField("platformTitle", event.target.value)
                    }
                    placeholder="Hermes Swarm"
                    value={form.platformTitle}
                  />
                </Field>
                <Field htmlFor="platform-public-base-url" label={tr("访问地址")}>
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-public-base-url"
                    onChange={(event) =>
                      updateField("publicBaseUrl", event.target.value)
                    }
                    placeholder="https://console.example.com"
                    value={form.publicBaseUrl}
                  />
                </Field>
                <Field htmlFor="platform-root-domain" label={tr("主域名")}>
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-root-domain"
                    onChange={(event) =>
                      updateField("rootDomain", event.target.value)
                    }
                    placeholder="example.com"
                    value={form.rootDomain}
                  />
                </Field>
                <ToggleField
                  checked={form.subdomainRoutingEnabled}
                  disabled={!canManagePlatform}
                  id="platform-subdomain-routing"
                  label={tr("启用组织子域名路由")}
                  onCheckedChange={(checked) =>
                    updateField("subdomainRoutingEnabled", checked)
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!canManagePlatform || savingPlatform}
                  onClick={savePlatform}
                  type="button"
                >
                  {tr("保存")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="defaults">
          <Card>
            <CardHeader>
              <CardTitle>{tr("默认控制项")}</CardTitle>
              <CardDescription>
                {tr("作为组织控制项的平台默认值，组织可按需覆写")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field htmlFor="platform-currency" label={tr("默认货币")}>
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField("defaultCurrency", value)
                    }
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
                </Field>
                <Field htmlFor="platform-language" label={tr("默认语言")}>
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField("defaultLanguage", value)
                    }
                    value={form.defaultLanguage}
                  >
                    <SelectTrigger id="platform-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {tr(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="platform-time-zone" label={tr("默认时区")}>
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField("defaultTimeZone", value)
                    }
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
                </Field>
                <Field htmlFor="platform-region-code" label={tr("默认地区代码")}>
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField("defaultRegionCode", value)
                    }
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
                </Field>
                <Field htmlFor="platform-date-format" label={tr("默认日期格式")}>
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField("defaultDateFormat", value)
                    }
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
                </Field>
                <Field
                  htmlFor="platform-password-min-length"
                  label={tr("密码最小长度")}
                >
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField("passwordMinLength", value)
                    }
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
                </Field>
                <ToggleField
                  checked={form.allowOrganizationCreation}
                  disabled={!canManagePlatform}
                  id="platform-org-creation"
                  label={tr("允许创建组织")}
                  onCheckedChange={(checked) =>
                    updateField("allowOrganizationCreation", checked)
                  }
                />
                <Field htmlFor="platform-org-status" label={tr("新组织默认状态")}>
                  <Select
                    disabled={!canManagePlatform}
                    onValueChange={(value) =>
                      updateField(
                        "defaultOrganizationStatus",
                        value as PlatformForm["defaultOrganizationStatus"],
                      )
                    }
                    value={form.defaultOrganizationStatus}
                  >
                    <SelectTrigger id="platform-org-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORGANIZATION_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {tr(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!canManagePlatform || savingPlatform}
                  onClick={savePlatform}
                  type="button"
                >
                  {tr("保存")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="messaging">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{tr("消息服务")}</CardTitle>
                <CardDescription>
                  {tr("平台级公共消息服务开关和提供方")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
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
                  </Field>
                  <ToggleField
                    checked={form.messageServiceEnabled}
                    disabled={!canManagePlatform}
                    id="platform-message-enabled"
                    label={tr("启用公共消息服务")}
                    onCheckedChange={(checked) =>
                      updateField("messageServiceEnabled", checked)
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{tr("工单服务")}</CardTitle>
                <CardDescription>
                  {tr("控制用户入口和平台工单提交能力")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <ToggleField
                  checked={form.ticketingVisible}
                  disabled={!canManagePlatform}
                  id="platform-ticketing-visible"
                  label={tr("显示工单入口")}
                  onCheckedChange={(checked) =>
                    updateField("ticketingVisible", checked)
                  }
                />
                <ToggleField
                  checked={form.ticketingPlatformSubmissionEnabled}
                  disabled={!canManagePlatform || !form.ticketingVisible}
                  id="platform-ticketing-platform-submission"
                  label={tr("允许提交平台工单")}
                  onCheckedChange={(checked) =>
                    updateField("ticketingPlatformSubmissionEnabled", checked)
                  }
                />
              </CardContent>
            </Card>

            <div className="flex justify-end xl:col-span-2">
              <Button
                disabled={!canManagePlatform || savingPlatform}
                onClick={savePlatform}
                type="button"
              >
                {tr("保存")}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="smtp">
          <Card>
            <CardHeader>
              <CardTitle>{tr("公共 SMTP")}</CardTitle>
              <CardDescription>
                {tr("组织未配置 SMTP 时使用的平台邮件服务")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ToggleField
                checked={form.publicSmtpEnabled}
                disabled={!canManagePlatform}
                id="platform-smtp-enabled"
                label={tr("启用公共 SMTP")}
                onCheckedChange={(checked) =>
                  updateField("publicSmtpEnabled", checked)
                }
              />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field htmlFor="platform-smtp-host" label="SMTP Host">
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-host"
                    onChange={(event) =>
                      updateField("smtpHost", event.target.value)
                    }
                    value={form.smtpHost}
                  />
                </Field>
                <Field htmlFor="platform-smtp-port" label={tr("端口")}>
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-port"
                    inputMode="numeric"
                    onChange={(event) =>
                      updateField("smtpPort", event.target.value)
                    }
                    value={form.smtpPort}
                  />
                </Field>
                <Field htmlFor="platform-smtp-from" label={tr("发件地址")}>
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-from"
                    onChange={(event) =>
                      updateField("smtpFromAddress", event.target.value)
                    }
                    value={form.smtpFromAddress}
                  />
                </Field>
                <Field htmlFor="platform-smtp-username" label={tr("用户名")}>
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-username"
                    onChange={(event) =>
                      updateField("smtpUsername", event.target.value)
                    }
                    value={form.smtpUsername}
                  />
                </Field>
                <Field htmlFor="platform-smtp-password" label={tr("密码")}>
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
                </Field>
                <ToggleField
                  checked={form.smtpSecure}
                  disabled={!canManagePlatform}
                  id="platform-smtp-secure"
                  label={tr("启用 SSL/TLS")}
                  onCheckedChange={(checked) =>
                    updateField("smtpSecure", checked)
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={
                    !canManagePlatform || savingSmtp || publicSmtpMissingHost
                  }
                  onClick={savePublicSmtp}
                  type="button"
                  variant="outline"
                >
                  {tr("保存")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admins">
          <PlatformMemberManagement
            canCreateMember={canCreatePlatformMember}
            canRemoveMember={canRemovePlatformMember}
            canSearchUsers={canSearchPlatformUsers}
            canUpdateMember={canUpdatePlatformMember}
            canViewMembers={canViewPlatformMembers}
            canViewRoles={canViewPlatformRoles}
            onChanged={refreshSnapshot}
          />
        </TabsContent>

        <TabsContent value="roles">
          <PlatformRolePermissions
            canCreateRole={canCreatePlatformRole}
            canDeleteRole={canDeletePlatformRole}
            canManagePermissions={canConfigurePlatformRolePermissions}
            canUpdateRole={canUpdatePlatformRole}
            canViewRoles={canViewPlatformRoles}
          />
        </TabsContent>

        <TabsContent value="custom">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{tr("自定义平台设置")}</CardTitle>
                <CardDescription>
                  {tr("作为组织配置的默认键值，可由组织覆写")}
                </CardDescription>
              </div>
              <CustomSettingDialog
                disabled={!canManagePlatform || savingCustomSetting}
                idPrefix="platform-custom-setting"
                onSubmit={saveCustomSystemSetting}
                saving={savingCustomSetting}
                scopeOptions={[{ label: tr("平台"), value: "platform" }]}
                showScope
                title={tr("添加平台设置")}
              />
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                {customSystemSettings.length === 0 ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm">
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
                        <div className="min-w-0 break-all font-mono text-xs">
                          {setting.name}
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <ConfirmActionDialog
        confirmLabel="删除"
        description={
          customSystemSettingToDelete
            ? `${tr("将删除平台自定义设置")} ${
                customSystemSettingToDelete.name
              }`
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
        title="删除平台设置"
      />
    </section>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function ToggleField({
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
    <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border px-3 py-2">
      <Label htmlFor={id}>{label}</Label>
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function isPlatformTab(value: string | null): value is PlatformTab {
  return (
    value === "admins" ||
    value === "custom" ||
    value === "defaults" ||
    value === "messaging" ||
    value === "profile" ||
    value === "roles" ||
    value === "smtp"
  );
}

function emptyPlatformForm(): PlatformForm {
  return {
    allowOrganizationCreation: true,
    defaultCurrency: PLATFORM_SETTING_DEFINITIONS.defaultCurrency.defaultValue,
    defaultDateFormat:
      PLATFORM_SETTING_DEFINITIONS.defaultDateFormat.defaultValue,
    defaultLanguage: PLATFORM_SETTING_DEFINITIONS.defaultLanguage.defaultValue,
    defaultOrganizationStatus:
      PLATFORM_SETTING_DEFINITIONS.defaultOrganizationStatus.defaultValue,
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
    allowOrganizationCreation: parseBoolean(
      getDefined("allowOrganizationCreation"),
      true,
    ),
    defaultCurrency: getDefined("defaultCurrency"),
    defaultDateFormat: getDefined("defaultDateFormat"),
    defaultLanguage: getDefined("defaultLanguage"),
    defaultOrganizationStatus:
      getDefined("defaultOrganizationStatus") === "suspended"
        ? "suspended"
        : "active",
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

function cloneSettingOptions(
  options?: readonly { label: string; value: string }[] | null,
) {
  return options?.map((option) => ({ ...option })) ?? null;
}
