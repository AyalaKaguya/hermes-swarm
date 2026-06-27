"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

const PLATFORM_TITLE_KEY = "tenant_title";
const PLATFORM_SETTING_KEYS = {
  allowOrganizationCreation: "platform.allowOrganizationCreation",
  defaultLanguage: "platform.defaultLanguage",
  defaultOrganizationStatus: "platform.defaultOrganizationStatus",
  defaultTimeZone: "platform.defaultTimeZone",
  messageServiceEnabled: "platform.messageServiceEnabled",
  messageServiceProvider: "platform.messageServiceProvider",
  publicSmtpEnabled: "platform.publicSmtpEnabled",
};

type PlatformForm = {
  allowOrganizationCreation: boolean;
  defaultLanguage: string;
  defaultOrganizationStatus: "active" | "suspended";
  defaultTimeZone: string;
  messageServiceEnabled: boolean;
  messageServiceProvider: string;
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
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);

  const canViewPlatform =
    snapshot?.scope.level === "platform" &&
    snapshot.isPlatformAdmin &&
    Boolean(
      snapshot && resolvedSession
        ? hasMenuAccess(snapshot, resolvedSession, "tenant", "view")
        : false,
    );
  const canManagePlatform =
    snapshot?.scope.level === "platform" &&
    snapshot.isPlatformAdmin &&
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
    const roleById = new Map(snapshot?.roles.map((role) => [role.id, role]) ?? []);
    return (
      snapshot?.users
        .map((user) => ({ role: user.roleId ? roleById.get(user.roleId) : null, user }))
        .filter(({ role }) => role?.name === "platform-admin" || role?.name === "owner") ?? []
    );
  }, [snapshot?.roles, snapshot?.users]);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !canViewPlatform) {
      setLoading(false);
      return;
    }

    try {
      const [settings, orgs, smtp] = await Promise.all([
        listSystemSettings(session.token),
        canViewOrganizations ? listOrganizations(session.token) : Promise.resolve([]),
        getSmtpConfig(session.token),
      ]);
      setForm(toPlatformForm(settings, smtp));
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

  function updateField<K extends keyof PlatformForm>(key: K, value: PlatformForm[K]) {
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
          { name: PLATFORM_TITLE_KEY, value: form.platformTitle.trim() || null },
          {
            name: PLATFORM_SETTING_KEYS.allowOrganizationCreation,
            value: form.allowOrganizationCreation,
          },
          {
            name: PLATFORM_SETTING_KEYS.defaultOrganizationStatus,
            value: form.defaultOrganizationStatus,
          },
          { name: PLATFORM_SETTING_KEYS.defaultLanguage, value: form.defaultLanguage },
          { name: PLATFORM_SETTING_KEYS.defaultTimeZone, value: form.defaultTimeZone },
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
        await validateSmtpConfig(session.token, {
          fromAddress: nullableText(form.smtpFromAddress),
          host: form.smtpHost,
          port: Number(form.smtpPort || 587),
          secure: form.smtpSecure,
          username: nullableText(form.smtpUsername),
        });
        await saveSmtpConfig(session.token, {
          fromAddress: nullableText(form.smtpFromAddress),
          host: form.smtpHost,
          isValidated: true,
          password: nullableText(form.smtpPassword),
          port: Number(form.smtpPort || 587),
          secure: form.smtpSecure,
          username: nullableText(form.smtpUsername),
        });
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

  if (!canViewPlatform) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          请切换到整个平台范围后访问平台设置。
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">平台设置</h1>
          <p className="text-sm text-muted-foreground">租户级默认值、组织治理与公共服务</p>
        </div>
        <Badge variant="secondary">
          {activeOrganizations}/{organizations.length} 活跃组织
        </Badge>
      </div>

      {message && !error && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>平台配置</CardTitle>
              <CardDescription>平台名称、默认语言、时区和消息服务</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="tenant-title" label="平台名称">
                <Input
                  disabled={!canManagePlatform}
                  id="tenant-title"
                  onChange={(event) => updateField("platformTitle", event.target.value)}
                  placeholder="Hermes Swarm"
                  value={form.platformTitle}
                />
              </Field>
              <Field htmlFor="platform-language" label="默认语言">
                <Select
                  disabled={!canManagePlatform}
                  onValueChange={(value) => updateField("defaultLanguage", value)}
                  value={form.defaultLanguage}
                >
                  <SelectTrigger id="platform-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh-Hant">繁体中文</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field htmlFor="platform-time-zone" label="默认时区">
                <Select
                  disabled={!canManagePlatform}
                  onValueChange={(value) => updateField("defaultTimeZone", value)}
                  value={form.defaultTimeZone}
                >
                  <SelectTrigger id="platform-time-zone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                    <SelectItem value="America/New_York">America/New_York</SelectItem>
                    <SelectItem value="Europe/London">Europe/London</SelectItem>
                    <SelectItem value="Asia/Singapore">Asia/Singapore</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field htmlFor="platform-message-provider" label="消息服务提供方">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>组织创建设置</CardTitle>
              <CardDescription>控制新组织创建入口和默认状态</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>公共 SMTP</CardTitle>
              <CardDescription>组织未配置 SMTP 时使用的租户级邮件服务</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ToggleField
                checked={form.publicSmtpEnabled}
                disabled={!canManagePlatform}
                id="platform-smtp-enabled"
                label="启用公共 SMTP"
                onCheckedChange={(checked) => updateField("publicSmtpEnabled", checked)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field htmlFor="platform-smtp-host" label="SMTP Host">
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-host"
                    onChange={(event) => updateField("smtpHost", event.target.value)}
                    value={form.smtpHost}
                  />
                </Field>
                <Field htmlFor="platform-smtp-port" label="端口">
                  <Input
                    disabled={!canManagePlatform}
                    id="platform-smtp-port"
                    inputMode="numeric"
                    onChange={(event) => updateField("smtpPort", event.target.value)}
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
                  onCheckedChange={(checked) => updateField("smtpSecure", checked)}
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
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>平台用户管理</CardTitle>
              <CardDescription>当前组织内具备平台管理能力的账号</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {platformUsers.length === 0 ? (
                <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                  暂无平台管理员
                </div>
              ) : (
                platformUsers.map(({ role, user }) => (
                  <div className="rounded-md border px-3 py-2" key={user.id}>
                    <div className="truncate text-sm font-medium">{user.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                    <Badge className="mt-2" variant="outline">
                      {role?.label ?? "Platform Admin"}
                    </Badge>
                  </div>
                ))
              )}
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
                    <span className="block truncate font-medium">{organization.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {organization.slug}
                    </span>
                  </span>
                  <Badge
                    variant={organization.status === "active" ? "default" : "secondary"}
                  >
                    {organization.status === "active" ? "启用" : "停用"}
                  </Badge>
                </Link>
              ))}
              {organizations.length === 0 && (
                <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
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

          <Button
            disabled={!canManagePlatform || savingPlatform}
            onClick={savePlatform}
            type="button"
          >
            {savingPlatform ? "保存中..." : "保存平台设置"}
          </Button>
        </div>
      </div>
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
    defaultLanguage: "zh-CN",
    defaultOrganizationStatus: "active",
    defaultTimeZone: "Asia/Shanghai",
    messageServiceEnabled: false,
    messageServiceProvider: "internal",
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
  const get = (name: string) => settings.find((setting) => setting.name === name)?.value;
  return {
    allowOrganizationCreation: parseBoolean(
      get(PLATFORM_SETTING_KEYS.allowOrganizationCreation),
      true,
    ),
    defaultLanguage: get(PLATFORM_SETTING_KEYS.defaultLanguage) || "zh-CN",
    defaultOrganizationStatus:
      get(PLATFORM_SETTING_KEYS.defaultOrganizationStatus) === "suspended"
        ? "suspended"
        : "active",
    defaultTimeZone: get(PLATFORM_SETTING_KEYS.defaultTimeZone) || "Asia/Shanghai",
    messageServiceEnabled: parseBoolean(
      get(PLATFORM_SETTING_KEYS.messageServiceEnabled),
      false,
    ),
    messageServiceProvider:
      get(PLATFORM_SETTING_KEYS.messageServiceProvider) || "internal",
    platformTitle: get(PLATFORM_TITLE_KEY) || "",
    publicSmtpEnabled: parseBoolean(
      get(PLATFORM_SETTING_KEYS.publicSmtpEnabled),
      false,
    ),
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
