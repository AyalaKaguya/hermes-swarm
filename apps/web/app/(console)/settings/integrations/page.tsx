"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import {
  CreateTokenDialog,
  CreatedTokenDialog,
  TokenSection,
  emptyIntegrationTokenDraft,
  scopeCapabilityKey,
  type IntegrationTokenDraft,
} from "@/components/integration-token-ui";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";
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
  getAuthenticatedAdminSessionMarker,
  withAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

export default function IntegrationsPage() {
  const access = usePermission();
  const notifications = useNotifications();
  const tr = useTextTranslation();
  const locale = useLocale();
  const canCreatePersonalToken = access.hasPermission(
    "integration_token.personal_api_token.create:own",
  );
  const [capabilities, setCapabilities] = useState<IntegrationTokenScopeCapability[]>([]);
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [createdToken, setCreatedToken] = useState<CreatedIntegrationToken | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draft, setDraft] = useState<IntegrationTokenDraft>(() =>
    emptyIntegrationTokenDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRevoke, setPendingRevoke] = useState<IntegrationToken | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedCapability = useMemo(
    () => capabilities.find((item) => scopeCapabilityKey(item) === draft.scopeKey) ?? null,
    [capabilities, draft.scopeKey],
  );

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextCapabilities, nextTokens] = await Promise.all([
        getIntegrationTokenCapabilities(token),
        listIntegrationTokens(token),
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
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  function togglePermission(permission: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      permissions: checked
        ? [...new Set([...current.permissions, permission])]
        : current.permissions.filter((item) => item !== permission),
    }));
  }

  async function createToken() {
    if (!canCreatePersonalToken || !selectedCapability || draft.permissions.length === 0) return;
    setSubmitting(true);
    setCreatedToken(null);
    setError(null);
    try {
      const created = await withAuthenticatedAdminSessionMarker((token) =>
        createIntegrationToken(token, {
          expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : undefined,
          note: draft.note,
          permissions: draft.permissions,
        }),
      );
      setCreatedToken(created);
      setCreateDialogOpen(false);
      setDraft(emptyIntegrationTokenDraft(selectedCapability));
      notifications.success(tr("集成 Token 已创建"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("创建失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeToken() {
    if (!pendingRevoke) return;
    setSubmitting(true);
    setError(null);
    try {
      await withAuthenticatedAdminSessionMarker((token) =>
        revokeIntegrationToken(token, pendingRevoke.id),
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
    canCreatePersonalToken &&
    Boolean(selectedCapability) &&
    draft.permissions.length > 0 &&
    !submitting;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle>{tr("个人 API Token")}</CardTitle>
            <CardDescription>
              {tr("创建仅属于当前账号的 API Token，并限制它可使用的权限和有效期。")}
              <br />
              {tr("Token 的实际权限始终受当前账号权限限制；账号权限被撤销后立即生效。")}
            </CardDescription>
          </div>
          <Button
            disabled={
              loading || capabilities.length === 0 || !canCreatePersonalToken
            }
            onClick={() => setCreateDialogOpen(true)}
            type="button"
          >
            <AppIcon className="size-3.5" name="plus" />
            {tr("创建个人 Token")}
          </Button>
        </CardHeader>
        {(loading || capabilities.length === 0) && (
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {tr("加载中...")}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                {tr("当前账号没有可授权给集成 Token 的权限")}
              </div>
            )}
          </CardContent>
        )}
        {!loading && capabilities.length > 0 && !canCreatePersonalToken && (
          <CardContent>
            <InlineNotice tone="info">
              {tr("当前工作空间角色不允许创建个人 API Token。")}
            </InlineNotice>
          </CardContent>
        )}
      </Card>

      <CreateTokenDialog
        canCreate={canCreate}
        createToken={() => void createToken()}
        draft={draft}
        onOpenChange={setCreateDialogOpen}
        open={createDialogOpen}
        selectedCapability={selectedCapability}
        setDraft={setDraft}
        submitting={submitting}
        togglePermission={togglePermission}
        tr={tr}
      />

      <CreatedTokenDialog
        createdToken={createdToken}
        onOpenChange={(open) => {
          if (!open) setCreatedToken(null);
        }}
        tr={tr}
      />

      <TokenSection
        canRevoke
        emptyText={tr("暂无有效的集成 Token")}
        locale={locale}
        onRevoke={setPendingRevoke}
        title={tr("有效 Token")}
        tokens={activeTokens}
        tr={tr}
      />
      <TokenSection
        canRevoke
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
