"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { TokenSection } from "@/components/integration-token-ui";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  listPlatformIntegrationTokens,
  revokePlatformIntegrationToken,
  type IntegrationToken,
  type RolePermission,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  withAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

export default function PlatformIntegrationsPage() {
  const { snapshot } = useAdminShell();
  const notifications = useNotifications();
  const tr = useTextTranslation();
  const locale = useLocale();
  const [tokens, setTokens] = useState<IntegrationToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRevoke, setPendingRevoke] = useState<IntegrationToken | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canRevoke = hasScopedRolePermission(
    snapshot?.platformMembership?.role?.permissions,
    "integration_token.platform_integration.revoke:platform",
  );
  const organizationNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const organization of snapshot?.organizations ?? []) {
      names.set(organization.id, organization.name);
    }
    return names;
  }, [snapshot?.organizations]);

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setTokens(await listPlatformIntegrationTokens(token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("集成加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revokeToken() {
    if (!pendingRevoke) return;
    setSubmitting(true);
    setError(null);
    try {
      await withAuthenticatedAdminSessionMarker((token) =>
        revokePlatformIntegrationToken(token, pendingRevoke.id),
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

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr("平台集成")}</CardTitle>
          <CardDescription>
            {tr("管理用户创建并使用的平台集成 Token。")}
          </CardDescription>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {tr("加载中...")}
        </div>
      ) : (
        <>
          <TokenSection
            canRevoke={canRevoke}
            emptyText={tr("暂无平台有效的集成 Token")}
            locale={locale}
            onRevoke={setPendingRevoke}
            organizationNames={organizationNames}
            showOwner
            title={tr("平台有效 Token")}
            tokens={activeTokens}
            tr={tr}
          />
          <TokenSection
            canRevoke={canRevoke}
            emptyText={tr("暂无平台已撤销或过期的集成 Token")}
            locale={locale}
            onRevoke={setPendingRevoke}
            organizationNames={organizationNames}
            showOwner
            title={tr("平台已撤销和过期 Token")}
            tokens={inactiveTokens}
            tr={tr}
          />
        </>
      )}

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

function hasScopedRolePermission(
  permissions: RolePermission[] | undefined,
  permission: string,
) {
  return Boolean(
    permissions?.some(
      (item) => item.enabled !== false && item.permission === permission,
    ),
  );
}
