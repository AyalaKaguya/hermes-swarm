"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
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
  const { snapshot } = useAdminShell();
  const notifications = useNotifications();
  const tr = useTextTranslation();
  const locale = useLocale();
  const userId = snapshot?.user.id ?? null;
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
  const organizationNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const organization of snapshot?.organizations ?? []) {
      names.set(organization.id, organization.name);
    }
    for (const capability of capabilities) {
      if (capability.organizationId && capability.organizationName) {
        names.set(capability.organizationId, capability.organizationName);
      }
    }
    return names;
  }, [capabilities, snapshot?.organizations]);

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
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
      const created = await withAuthenticatedAdminSessionMarker((token) =>
        createIntegrationToken(token, userId, {
          expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : undefined,
          note: draft.note,
          organizationId: selectedCapability.organizationId,
          permissions: draft.permissions,
          scope: selectedCapability.scope,
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
    if (!userId || !pendingRevoke) return;
    setSubmitting(true);
    setError(null);
    try {
      await withAuthenticatedAdminSessionMarker((token) =>
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

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle>{tr("集成")}</CardTitle>
            <CardDescription>
              {tr("创建长期有效的个人集成 Token，并限制它可使用的作用范围和权限。")}
            </CardDescription>
          </div>
          <Button
            disabled={loading || capabilities.length === 0}
            onClick={() => setCreateDialogOpen(true)}
            type="button"
          >
            <AppIcon className="size-3.5" name="plus" />
            {tr("创建 Token")}
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
      </Card>

      <CreateTokenDialog
        canCreate={canCreate}
        capabilities={capabilities}
        createToken={() => void createToken()}
        draft={draft}
        onOpenChange={setCreateDialogOpen}
        open={createDialogOpen}
        selectedCapability={selectedCapability}
        setDraft={setDraft}
        submitting={submitting}
        togglePermission={togglePermission}
        tr={tr}
        updateScope={updateScope}
      />

      <CreatedTokenDialog
        createdToken={createdToken}
        organizationNames={organizationNames}
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
        organizationNames={organizationNames}
        title={tr("有效 Token")}
        tokens={activeTokens}
        tr={tr}
      />
      <TokenSection
        canRevoke
        emptyText={tr("暂无已撤销或过期的集成 Token")}
        locale={locale}
        onRevoke={setPendingRevoke}
        organizationNames={organizationNames}
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
