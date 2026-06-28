"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  KNOWN_PLATFORM_SETTING_KEYS,
  LANGUAGE_OPTIONS,
  PASSWORD_LENGTH_OPTIONS,
  PLATFORM_SETTING_DEFINITIONS,
  PLATFORM_SETTING_KEYS,
  PLATFORM_TITLE_SETTING_KEY,
  REGION_OPTIONS,
  TIME_ZONE_OPTIONS,
} from "@hermes-swarm/core/settings/definitions";
import {
  getSmtpConfig,
  listOrganizations,
  listSystemSettings,
  saveSmtpConfig,
  saveSystemSettings,
  validateSmtpConfig,
  type Organization,
  type SmtpConfig,
  type SystemSettingDto,
} from "@/lib/admin-api";
import { getStoredSession, hasMenuAccess } from "@/lib/session";

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
  publicSmtpEnabled: boolean;
  smtpFromAddress: string;
  smtpHost: string;
  smtpPassword: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
};

export default function TenantPage() {
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState<PlatformForm>(emptyPlatformForm());
  const [systemSettings, setSystemSettings] = useState<SystemSettingDto[]>([]);
  const [customSettingName, setCustomSettingName] = useState("");
  const [customSettingValue, setCustomSettingValue] = useState("");
  const [savingCustomSetting, setSavingCustomSetting] = useState(false);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);

  const canViewPlatform =
    Boolean(snapshot?.isPlatformAdmin) &&
    Boolean(
      snapshot && resolvedSession
        ? hasMenuAccess(snapshot, resolvedSession, "tenant", "view")
        : false,
    );
  const canManagePlatform =
    Boolean(snapshot?.isPlatformAdmin) &&
    Boolean(
      snapshot && resolvedSession
        ? hasMenuAccess(snapshot, resolvedSession, "tenant", "manage")
        : false,
    );
  const canViewOrganizations =
    canViewPlatform &&
    Boolean(
      snapshot && resolvedSession
        ? hasMenuAccess(snapshot, resolvedSession, "organizations", "view")
        : false,
    );

  const activeOrganizations = useMemo(
    () => organizations.filter((item) => item.status === "active").length,
    [organizations],
  );
  const platformUsers = useMemo(() => {
    const roleById = new Map(
      snapshot?.roles.map((role) => [role.id, role]) ?? [],
    );
    return (
      snapshot?.users
        .map((user) => ({
          role: user.roleId ? roleById.get(user.roleId) : null,
          user,
        }))
        .filter(({ role }) => role?.name === "platform-admin") ?? []
    );
  }, [snapshot?.roles, snapshot?.users]);
  const customSystemSettings = useMemo(() => {
    const knownNames = new Set<string>(KNOWN_PLATFORM_SETTING_KEYS);
    return systemSettings.filter((setting) => !knownNames.has(setting.name));
  }, [systemSettings]);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !canViewPlatform) {
      setLoading(false);
      return;
    }

    try {
      const [settings, orgs, smtp] = await Promise.all([
        listSystemSettings(session.token),
        canViewOrganizations
          ? listOrganizations(session.token)
          : Promise.resolve([]),
        getSmtpConfig(session.token, { scope: "platform" }),
      ]);
      setForm(toPlatformForm(settings, smtp));
      setSystemSettings(settings);
      setOrganizations(orgs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [canViewOrganizations, canViewPlatform]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField<K extends keyof PlatformForm>(
    key: K,
    value: PlatformForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function savePlatform() {
    const session = getStoredSession();
    if (!session?.token || !canManagePlatform) return;

    setSavingPlatform(true);
    setError(null);
    setMessage(null);
    try {
      await saveSystemSettings(session.token, {
        settings: [
          {
            name: PLATFORM_TITLE_SETTING_KEY,
            value: form.platformTitle.trim() || null,
          },
          {
            name: PLATFORM_SETTING_KEYS.allowOrganizationCreation,
            value: form.allowOrganizationCreation,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultOrganizationStatus,
            value: form.defaultOrganizationStatus,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultCurrency,
            value: form.defaultCurrency,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultDateFormat,
            value: form.defaultDateFormat,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultLanguage,
            value: form.defaultLanguage,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultRegionCode,
            value: form.defaultRegionCode,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultTimeZone,
            value: form.defaultTimeZone,
          },
          {
            name: PLATFORM_SETTING_KEYS.passwordMinLength,
            value: form.passwordMinLength,
          },
          {
            name: PLATFORM_SETTING_KEYS.messageServiceEnabled,
            value: form.messageServiceEnabled,
          },
          {
            name: PLATFORM_SETTING_KEYS.messageServiceProvider,
            value: form.messageServiceProvider.trim() || null,
          },
          {
            name: PLATFORM_SETTING_KEYS.publicSmtpEnabled,
            value: form.publicSmtpEnabled,
          },
        ],
      });
      setMessage("平台设置已保存");
      await refreshSnapshot();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingPlatform(false);
    }
  }

  async function savePublicSmtp() {
    const session = getStoredSession();
    if (!session?.token || !canManagePlatform) return;

    setSavingSmtp(true);
    setError(null);
    setMessage(null);
    try {
      if (form.publicSmtpEnabled || form.smtpHost.trim()) {
        await validateSmtpConfig(
          session.token,
          {
            fromAddress: nullableText(form.smtpFromAddress),
            host: form.smtpHost,
            port: Number(form.smtpPort || 587),
            secure: form.smtpSecure,
            username: nullableText(form.smtpUsername),
          },
          { scope: "platform" },
        );
        await saveSmtpConfig(
          session.token,
          {
            fromAddress: nullableText(form.smtpFromAddress),
            host: form.smtpHost,
            isValidated: true,
            password: nullableText(form.smtpPassword),
            port: Number(form.smtpPort || 587),
            secure: form.smtpSecure,
            username: nullableText(form.smtpUsername),
          },
          { scope: "platform" },
        );
      }
      await saveSystemSettings(session.token, {
        settings: [
          {
            name: PLATFORM_SETTING_KEYS.publicSmtpEnabled,
            value: form.publicSmtpEnabled,
          },
        ],
      });
      setMessage("公共 SMTP 已保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingSmtp(false);
    }
  }

  async function saveCustomSystemSetting(name: string, value: string | null) {
    const session = getStoredSession();
    const settingName = name.trim();
    if (!session?.token || !canManagePlatform || !settingName) return;

    setSavingCustomSetting(true);
    setError(null);
    setMessage(null);
    try {
      await saveSystemSettings(session.token, {
        settings: [{ name: settingName, value }],
      });
      setCustomSettingName("");
      setCustomSettingValue("");
      setMessage(
        value === null ? "平台自定义设置已删除" : "平台自定义设置已保存",
      );
      await load();
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingCustomSetting(false);
    }
  }

  if (!canViewPlatform) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
          当前账号无权访问平台设置。
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">平台设置</h1>
          <p className="text-sm">租户级默认值、组织治理与公共服务</p>
        </div>
        <Badge variant="secondary">
          {activeOrganizations}/{organizations.length} 活跃组织
        </Badge>
      </div>

      {message && !error && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <Tabs className="grid gap-4" defaultValue="profile">
        <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="profile">平台信息</TabsTrigger>
          <TabsTrigger value="defaults">默认控制项</TabsTrigger>
          <TabsTrigger value="organization">组织创建</TabsTrigger>
          <TabsTrigger value="messaging">消息服务</TabsTrigger>
          <TabsTrigger value="smtp">公共 SMTP</TabsTrigger>
          <TabsTrigger value="admins">平台用户</TabsTrigger>
          <TabsTrigger value="custom">自定义设置</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-0" value="profile">
          <Card>
            <CardHeader>
              <CardTitle>平台信息</CardTitle>
              <CardDescription>
                用于全局展示和识别当前平台的基础信息
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="max-w-xl">
                <Field htmlFor="tenant-title" label="平台名称">
                  <Input
                    disabled={!canManagePlatform}
                    id="tenant-title"
                    onChange={(event) =>
                      updateField("platformTitle", event.target.value)
                    }
                    placeholder="Hermes Swarm"
                    value={form.platformTitle}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!canManagePlatform || savingPlatform}
                  onClick={savePlatform}
                  type="button"
                >
                  {savingPlatform ? "保存中..." : "保存平台信息"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-0" value="defaults">
          <Card>
            <CardHeader>
              <CardTitle>默认控制项</CardTitle>
              <CardDescription>
                作为组织控制项的租户级默认值，组织可按需覆写
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field htmlFor="platform-currency" label="默认货币">
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
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="platform-language" label="默认语言">
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
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="platform-time-zone" label="默认时区">
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
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="platform-region-code" label="默认地区代码">
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
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field htmlFor="platform-date-format" label="默认日期格式">
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
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  htmlFor="platform-password-min-length"
                  label="密码最小长度"
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
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!canManagePlatform || savingPlatform}
                  onClick={savePlatform}
                  type="button"
                >
                  {savingPlatform ? "保存中..." : "保存默认控制项"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-0" value="organization">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card>
              <CardHeader>
                <CardTitle>组织创建设置</CardTitle>
                <CardDescription>控制新组织创建入口和默认状态</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ToggleField
                    checked={form.allowOrganizationCreation}
                    disabled={!canManagePlatform}
                    id="platform-org-creation"
                    label="允许创建组织"
                    onCheckedChange={(checked) =>
                      updateField("allowOrganizationCreation", checked)
                    }
                  />
                  <Field htmlFor="platform-org-status" label="新组织默认状态">
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
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="suspended">停用</SelectItem>
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
                    {savingPlatform ? "保存中..." : "保存组织创建"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>组织配置</CardTitle>
                  <CardDescription>租户下全部组织的配置入口</CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/settings/organizations">
                    <AppIcon className="size-3.5" name="building" />
                    组织列表
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="grid gap-2">
                {organizations.slice(0, 6).map((organization) => (
                  <Link
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                    href={`/settings/organizations/${organization.id}`}
                    key={organization.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {organization.name}
                      </span>
                      <span className="block truncate font-mono text-xs">
                        {organization.slug}
                      </span>
                    </span>
                    <Badge
                      variant={
                        organization.status === "active"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {organization.status === "active" ? "启用" : "停用"}
                    </Badge>
                  </Link>
                ))}
                {organizations.length === 0 && (
                  <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm">
                    暂无组织
                  </div>
                )}
                {organizations.length > 6 && (
                  <>
                    <Separator />
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/settings/organizations">查看全部组织</Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="mt-0" value="messaging">
          <Card>
            <CardHeader>
              <CardTitle>消息服务</CardTitle>
              <CardDescription>平台级公共消息服务开关和提供方</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,24rem)_minmax(0,20rem)]">
                <Field
                  htmlFor="platform-message-provider"
                  label="消息服务提供方"
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
                  label="启用公共消息服务"
                  onCheckedChange={(checked) =>
                    updateField("messageServiceEnabled", checked)
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!canManagePlatform || savingPlatform}
                  onClick={savePlatform}
                  type="button"
                >
                  {savingPlatform ? "保存中..." : "保存消息服务"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-0" value="smtp">
          <Card>
            <CardHeader>
              <CardTitle>公共 SMTP</CardTitle>
              <CardDescription>
                组织未配置 SMTP 时使用的租户级邮件服务
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ToggleField
                checked={form.publicSmtpEnabled}
                disabled={!canManagePlatform}
                id="platform-smtp-enabled"
                label="启用公共 SMTP"
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
                <Field htmlFor="platform-smtp-port" label="端口">
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
                <Field htmlFor="platform-smtp-from" label="发件地址">
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-from"
                    onChange={(event) =>
                      updateField("smtpFromAddress", event.target.value)
                    }
                    value={form.smtpFromAddress}
                  />
                </Field>
                <Field htmlFor="platform-smtp-username" label="用户名">
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-username"
                    onChange={(event) =>
                      updateField("smtpUsername", event.target.value)
                    }
                    value={form.smtpUsername}
                  />
                </Field>
                <Field htmlFor="platform-smtp-password" label="密码">
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-password"
                    onChange={(event) =>
                      updateField("smtpPassword", event.target.value)
                    }
                    placeholder="留空则保留当前密码"
                    type="password"
                    value={form.smtpPassword}
                  />
                </Field>
                <ToggleField
                  checked={form.smtpSecure}
                  disabled={!canManagePlatform}
                  id="platform-smtp-secure"
                  label="启用 SSL/TLS"
                  onCheckedChange={(checked) =>
                    updateField("smtpSecure", checked)
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!canManagePlatform || savingSmtp}
                  onClick={savePublicSmtp}
                  type="button"
                  variant="outline"
                >
                  {savingSmtp ? "保存中..." : "保存公共 SMTP"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-0" value="admins">
          <Card>
            <CardHeader>
              <CardTitle>平台用户管理</CardTitle>
              <CardDescription>
                当前组织内具备平台管理能力的账号
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {platformUsers.length === 0 ? (
                <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm sm:col-span-2 xl:col-span-3">
                  暂无平台管理员
                </div>
              ) : (
                platformUsers.map(({ role, user }) => (
                  <div className="rounded-md border px-3 py-2" key={user.id}>
                    <div className="truncate text-sm font-medium">
                      {user.displayName}
                    </div>
                    <div className="truncate text-xs">{user.email}</div>
                    <Badge className="mt-2" variant="outline">
                      {role?.label ?? "Platform Admin"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-0" value="custom">
          <Card>
            <CardHeader>
              <CardTitle>自定义平台设置</CardTitle>
              <CardDescription>
                作为组织配置的默认键值，可由组织覆写
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Field htmlFor="platform-custom-name" label="名称">
                  <Input
                    disabled={!canManagePlatform || savingCustomSetting}
                    id="platform-custom-name"
                    onChange={(event) =>
                      setCustomSettingName(event.target.value)
                    }
                    placeholder="custom.setting"
                    value={customSettingName}
                  />
                </Field>
                <Field htmlFor="platform-custom-value" label="默认值">
                  <Input
                    disabled={!canManagePlatform || savingCustomSetting}
                    id="platform-custom-value"
                    onChange={(event) =>
                      setCustomSettingValue(event.target.value)
                    }
                    value={customSettingValue}
                  />
                </Field>
                <Button
                  className="self-end"
                  disabled={
                    !canManagePlatform ||
                    savingCustomSetting ||
                    !customSettingName.trim()
                  }
                  onClick={() =>
                    void saveCustomSystemSetting(
                      customSettingName,
                      customSettingValue,
                    )
                  }
                  type="button"
                >
                  添加
                </Button>
              </div>

              <div className="grid gap-2">
                {customSystemSettings.length === 0 ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm">
                    暂无自定义平台设置
                  </div>
                ) : (
                  customSystemSettings.map((setting) => (
                    <div
                      className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                      key={setting.id}
                    >
                      <div className="truncate font-mono text-xs">
                        {setting.name}
                      </div>
                      <Input
                        className="h-8 font-mono text-xs"
                        disabled={!canManagePlatform || savingCustomSetting}
                        defaultValue={setting.value ?? ""}
                        onBlur={(event) => {
                          if (
                            event.currentTarget.value !== (setting.value ?? "")
                          ) {
                            void saveCustomSystemSetting(
                              setting.name,
                              event.currentTarget.value,
                            );
                          }
                        }}
                      />
                      <Button
                        disabled={!canManagePlatform || savingCustomSetting}
                        onClick={() =>
                          void saveCustomSystemSetting(setting.name, null)
                        }
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <AppIcon className="size-4" name="trash" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
    publicSmtpEnabled: false,
    smtpFromAddress: "",
    smtpHost: "",
    smtpPassword: "",
    smtpPort: "587",
    smtpSecure: false,
    smtpUsername: "",
  };
}

function toPlatformForm(settings: SystemSettingDto[], smtp: SmtpConfig | null) {
  const get = (name: string) =>
    settings.find((setting) => setting.name === name)?.value;
  const getDefined = (name: keyof typeof PLATFORM_SETTING_DEFINITIONS) => {
    const definition = PLATFORM_SETTING_DEFINITIONS[name];
    const legacyValue =
      "legacyKeys" in definition
        ? definition.legacyKeys.map((key) => get(key)).find(Boolean)
        : undefined;
    return get(definition.key) ?? legacyValue ?? definition.defaultValue ?? "";
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
    publicSmtpEnabled: parseBoolean(getDefined("publicSmtpEnabled"), false),
    smtpFromAddress: smtp?.fromAddress ?? "",
    smtpHost: smtp?.host ?? "",
    smtpPassword: "",
    smtpPort: smtp?.port ? String(smtp.port) : "587",
    smtpSecure: Boolean(smtp?.secure),
    smtpUsername: smtp?.username ?? "",
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
