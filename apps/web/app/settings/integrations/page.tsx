"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  createIntegrationToken,
  getIntegrationTokenCapabilities,
  listIntegrationTokens,
  revokeIntegrationToken,
  type CreatedIntegrationToken,
  type IntegrationToken,
  type IntegrationTokenScopeCapability,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminToken,
  withAuthenticatedAdminToken,
} from "@/lib/authenticated-admin";

type Draft = {
  expiresAt: string;
  note: string;
  permissions: string[];
  scopeKey: string;
};

export default function IntegrationsPage() {
  const { snapshot } = useAdminShell();
  const notifications = useNotifications();
  const tr = useTextTranslation();
  const locale = useLocale();
  const userId = snapshot?.user.id ?? null;
  const [capabilities, setCapabilities] = useState<IntegrationTokenScopeCapability[]>([]);
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [createdToken, setCreatedToken] = useState<CreatedIntegrationToken | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRevoke, setPendingRevoke] = useState<IntegrationToken | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedCapability = useMemo(
    () => capabilities.find((item) => scopeCapabilityKey(item) === draft.scopeKey) ?? null,
    [capabilities, draft.scopeKey],
  );

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminToken();
    if (!token || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextCapabilities, nextTokens] = await Promise.all([
        getIntegrationTokenCapabilities(token, userId),
        listIntegrationTokens(token, userId),
      ]);
      setCapabilities(nextCapabilities.scopes);
      setTokens(nextTokens);
      setError(null);
      setDraft((current) =>
        current.scopeKey
          ? current
          : {
              ...current,
              scopeKey: nextCapabilities.scopes[0]
                ? scopeCapabilityKey(nextCapabilities.scopes[0])
                : "",
            },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("集成加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateScope(scopeKey: string) {
    setCreatedToken(null);
    setDraft((current) => ({
      ...current,
      permissions: [],
      scopeKey,
    }));
  }

  function togglePermission(permission: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      permissions: checked
        ? [...new Set([...current.permissions, permission])]
        : current.permissions.filter((item) => item !== permission),
    }));
  }

  async function createToken() {
    if (!userId || !selectedCapability || draft.permissions.length === 0) return;
    setSubmitting(true);
    setCreatedToken(null);
    setError(null);
    try {
      const created = await withAuthenticatedAdminToken((token) =>
        createIntegrationToken(token, userId, {
          expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : undefined,
          note: draft.note,
          organizationId: selectedCapability.organizationId,
          permissions: draft.permissions,
          scope: selectedCapability.scope,
        }),
      );
      setCreatedToken(created);
      setDraft(emptyDraft(selectedCapability));
      notifications.success(tr("集成 Token 已创建"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("创建失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeToken() {
    if (!userId || !pendingRevoke) return;
    setSubmitting(true);
    setError(null);
    try {
      await withAuthenticatedAdminToken((token) =>
        revokeIntegrationToken(token, userId, pendingRevoke.id),
      );
      notifications.success(tr("集成 Token 已撤销"));
      setPendingRevoke(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("撤销失败"));
    } finally {
      setSubmitting(false);
    }
  }

  const activeTokens = tokens.filter((token) => !token.revokedAt && !token.isExpired);
  const inactiveTokens = tokens.filter((token) => token.revokedAt || token.isExpired);
  const canCreate =
    Boolean(selectedCapability) && draft.permissions.length > 0 && !submitting;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {createdToken && (
        <Card className="border-emerald-500/30">
          <CardHeader>
            <CardTitle>{tr("保存这个 Token")}</CardTitle>
            <CardDescription>
              {tr("Token 只会显示一次。关闭页面后只能撤销并重新创建。")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea className="font-mono text-xs" readOnly value={createdToken.token} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr("集成")}</CardTitle>
          <CardDescription>
            {tr("创建长期有效的个人集成 Token，并限制它可使用的作用范围和权限。")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {tr("加载中...")}
            </div>
          ) : capabilities.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              {tr("当前账号没有可授权给集成 Token 的权限")}
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="integration-scope">{tr("作用范围")}</Label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  id="integration-scope"
                  onChange={(event) => updateScope(event.target.value)}
                  value={draft.scopeKey}
                >
                  {capabilities.map((capability) => (
                    <option key={scopeCapabilityKey(capability)} value={scopeCapabilityKey(capability)}>
                      {formatScopeCapability(capability, tr)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="integration-note">{tr("备注")}</Label>
                  <Input
                    id="integration-note"
                    maxLength={160}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, note: event.target.value }))
                    }
                    placeholder={tr("例如：CI 部署")}
                    value={draft.note}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="integration-expiry">{tr("有效期")}</Label>
                  <Input
                    id="integration-expiry"
                    max={formatDateInput(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))}
                    min={formatDateInput(new Date(Date.now() + 24 * 60 * 60 * 1000))}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, expiresAt: event.target.value }))
                    }
                    type="date"
                    value={draft.expiresAt}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <div>
                  <div className="text-sm font-medium">{tr("权限")}</div>
                  <div className="text-xs text-muted-foreground">
                    {tr("只能选择当前账号在该作用范围内已经拥有的权限。")}
                  </div>
                </div>
                <div className="grid gap-2">
                  {selectedCapability?.permissions.map((permission) => (
                    <label
                      className="flex gap-3 rounded-md border p-3 text-sm"
                      key={permission.permission}
                    >
                      <Checkbox
                        checked={draft.permissions.includes(permission.permission)}
                        onCheckedChange={(checked) =>
                          togglePermission(permission.permission, checked === true)
                        }
                      />
                      <span className="grid min-w-0 gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{permission.label}</span>
                          {permission.isDangerous && (
                            <span className="rounded border border-destructive/30 px-1.5 py-0.5 text-[0.68rem] text-destructive">
                              {tr("高危")}
                            </span>
                          )}
                        </span>
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {permission.permission}
                        </span>
                        {permission.description && (
                          <span className="text-xs text-muted-foreground">
                            {permission.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button disabled={!canCreate} onClick={() => void createToken()} type="button">
                  <AppIcon className="size-3.5" name="plus" />
                  {tr("创建 Token")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <TokenSection
        emptyText={tr("暂无有效的集成 Token")}
        locale={locale}
        onRevoke={setPendingRevoke}
        title={tr("有效 Token")}
        tokens={activeTokens}
        tr={tr}
      />
      <TokenSection
        emptyText={tr("暂无已撤销或过期的集成 Token")}
        locale={locale}
        onRevoke={setPendingRevoke}
        title={tr("已撤销和过期 Token")}
        tokens={inactiveTokens}
        tr={tr}
      />

      <ConfirmActionDialog
        confirmLabel={tr("撤销")}
        description={tr("撤销后，这个集成 Token 将立即失效，无法恢复。")}
        onConfirm={() => void revokeToken()}
        onOpenChange={(open) => {
          if (!open && !submitting) setPendingRevoke(null);
        }}
        open={Boolean(pendingRevoke)}
        pending={submitting}
        title={tr("撤销集成 Token？")}
      />
    </div>
  );
}

function TokenSection({
  emptyText,
  locale,
  onRevoke,
  title,
  tokens,
  tr,
}: {
  emptyText: string;
  locale: string;
  onRevoke: (token: IntegrationToken) => void;
  title: string;
  tokens: IntegrationToken[];
  tr: (value: string | null | undefined) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {tokens.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="grid gap-3">
            {tokens.map((token) => {
              const inactive = Boolean(token.revokedAt || token.isExpired);
              return (
                <div
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  key={token.id}
                >
                  <div className="grid min-w-0 gap-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {token.note || tr("未命名 Token")}
                      </span>
                      <span className="rounded-md border px-1.5 py-0.5 text-xs">
                        {formatTokenScope(token, tr)}
                      </span>
                      {inactive && (
                        <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
                          {token.revokedAt ? tr("已撤销") : tr("已过期")}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {token.tokenPrefix}...
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{tr("权限")} {token.permissions.length}</span>
                      <span>{tr("过期时间")} {formatDateTime(token.expiresAt, locale)}</span>
                      <span>
                        {tr("最近使用")}{" "}
                        {token.lastUsedAt
                          ? formatDateTime(token.lastUsedAt, locale)
                          : tr("从未使用")}
                      </span>
                    </div>
                  </div>
                  {!inactive && (
                    <Button
                      onClick={() => onRevoke(token)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {tr("撤销")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function emptyDraft(capability?: IntegrationTokenScopeCapability | null): Draft {
  return {
    expiresAt: formatDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    note: "",
    permissions: [],
    scopeKey: capability ? scopeCapabilityKey(capability) : "",
  };
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatScopeCapability(
  capability: IntegrationTokenScopeCapability,
  tr: (value: string | null | undefined) => string,
) {
  if (capability.scope === "own") return tr("个人");
  if (capability.scope === "platform") return tr("平台");
  return `${tr("组织")} / ${capability.organizationName ?? capability.organizationId}`;
}

function formatTokenScope(
  token: IntegrationToken,
  tr: (value: string | null | undefined) => string,
) {
  if (token.scope === "own") return tr("个人");
  if (token.scope === "platform") return tr("平台");
  return tr("组织");
}

function scopeCapabilityKey(capability: IntegrationTokenScopeCapability) {
  return `${capability.scope}:${capability.organizationId ?? "none"}`;
}
