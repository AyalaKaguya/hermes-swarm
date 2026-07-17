"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import { PermissionTree } from "@/components/permission-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  CreatedIntegrationToken,
  IntegrationToken,
  IntegrationTokenScopeCapability,
  PermissionCatalog,
} from "@/lib/admin-api";

export type IntegrationTokenDraft = {
  expiresAt: string;
  note: string;
  permissions: string[];
  scopeKey: "tenant" | "";
};

export function CreateTokenDialog({
  canCreate,
  createToken,
  draft,
  onOpenChange,
  open,
  selectedCapability,
  setDraft,
  submitting,
  togglePermission,
  tr,
}: {
  canCreate: boolean;
  createToken: () => void;
  draft: IntegrationTokenDraft;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedCapability: IntegrationTokenScopeCapability | null;
  setDraft: Dispatch<SetStateAction<IntegrationTokenDraft>>;
  submitting: boolean;
  togglePermission: (permission: string, checked: boolean) => void;
  tr: (value: string | null | undefined) => string;
}) {
  const catalog = useMemo(
    () => capabilityToCatalog(selectedCapability, tr),
    [selectedCapability, tr],
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="grid max-h-[min(90svh,760px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-5 pr-12">
          <DialogTitle>{tr("创建个人 API Token")}</DialogTitle>
          <DialogDescription>
            {tr("选择这个 Token 可以请求的权限和有效期。最终权限还会实时受当前账号约束。")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <div className="grid gap-1.5">
            <Label>{tr("所有者")}</Label>
            <Badge className="w-fit" variant="secondary">{tr("当前账号")}</Badge>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="integration-token-expires">{tr("有效期")}</Label>
              <Input
                disabled={submitting}
                id="integration-token-expires"
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, expiresAt: event.target.value }))
                }
                type="date"
                value={draft.expiresAt}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="integration-token-note">{tr("备注")}</Label>
              <Input
                disabled={submitting}
                id="integration-token-note"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, note: event.target.value }))
                }
                value={draft.note}
              />
            </div>
          </div>
          <div className="grid min-h-0 gap-2">
            <Label>{tr("权限")}</Label>
            <ScrollArea className="h-[min(48svh,440px)] rounded-lg border bg-card/40">
              <PermissionTree
                catalog={catalog}
                defaultExpanded={false}
                disabled={submitting}
                isChecked={(permission) => draft.permissions.includes(permission)}
                onToggle={(permission, enabled) =>
                  togglePermission(permission, enabled ?? false)
                }
              />
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 flex-col gap-3 rounded-none rounded-b-xl border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {draft.permissions.length} {tr("项权限已选择")}
          </span>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              className="flex-1 sm:flex-none"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {tr("取消")}
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              disabled={!canCreate}
              onClick={createToken}
              type="button"
            >
              {submitting ? tr("创建中...") : tr("创建")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreatedTokenDialog({
  createdToken,
  onOpenChange,
  tr,
}: {
  createdToken: CreatedIntegrationToken | null;
  onOpenChange: (open: boolean) => void;
  tr: (value: string | null | undefined) => string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(createdToken)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("个人 API Token 已创建")}</DialogTitle>
          <DialogDescription>{tr("请立即复制并妥善保存，这个 Token 不会再次显示。")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Badge className="w-fit" variant="secondary">{tr("个人 Token")}</Badge>
          <Input readOnly value={createdToken?.token ?? ""} />
        </div>
        <DialogFooter>
          <Button
            onClick={() => void navigator.clipboard.writeText(createdToken?.token ?? "")}
            type="button"
          >
            {tr("复制 Token")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TokenSection({
  canRevoke,
  emptyText,
  locale,
  onRevoke,
  title,
  tokens,
  tr,
}: {
  canRevoke: boolean;
  emptyText: string;
  locale: string;
  onRevoke: (token: IntegrationToken) => void;
  title: string;
  tokens: IntegrationToken[];
  tr: (value: string | null | undefined) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        {tokens.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">{emptyText}</div>
        ) : tokens.map((token) => (
          <div className="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center" key={token.id}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-all font-mono text-sm">{token.tokenPrefix}</span>
                <Badge variant="outline">{tr("个人 Token")}</Badge>
                <Badge variant="secondary">{token.permissions.length} {tr("项权限")}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {token.note || tr("无备注")} · {tr("到期")} {formatDateTime(token.expiresAt, locale)}
              </p>
            </div>
            {canRevoke && !token.revokedAt && !token.isExpired && (
              <Button onClick={() => onRevoke(token)} size="sm" type="button" variant="outline">{tr("撤销")}</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function emptyIntegrationTokenDraft(
  capability?: IntegrationTokenScopeCapability | null,
): IntegrationTokenDraft {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  return {
    expiresAt: expiresAt.toISOString().slice(0, 10),
    note: "",
    permissions: [],
    scopeKey: capability?.scope ?? "tenant",
  };
}

export function scopeCapabilityKey(capability: IntegrationTokenScopeCapability) {
  return capability.scope;
}

function capabilityToCatalog(
  capability: IntegrationTokenScopeCapability | null,
  tr: (value: string | null | undefined) => string,
): PermissionCatalog | null {
  if (!capability) return null;
  const scopeLabels = {
    organization: tr("组织"),
    own: tr("个人"),
    tenant: tr("工作空间"),
  } as const;
  return {
    scopes: (["tenant", "organization", "own"] as const).flatMap((scope) => {
      const scopedPermissions = capability.permissions.filter(
        (item) => item.scope === scope,
      );
      if (!scopedPermissions.length) return [];
      const entities = new Map<
        string,
        IntegrationTokenScopeCapability["permissions"]
      >();
      for (const item of scopedPermissions) {
        entities.set(item.entity, [...(entities.get(item.entity) ?? []), item]);
      }
      return [{
        entities: [...entities.entries()].map(([entity, operations]) => ({
          entity,
          label: operations[0]?.entityLabel ?? entity,
          order: operations[0]?.entityOrder,
          purposes: [...new Set(operations.map((item) => item.purpose))].map(
            (purpose) => {
              const purposeOperations = operations.filter(
                (item) => item.purpose === purpose,
              );
              return {
                label: purposeOperations[0]?.purposeLabel ?? purpose,
                operations: purposeOperations.map((item) => ({
                  description: item.description,
                  isDangerous: item.isDangerous,
                  label: item.label,
                  operation: item.operation,
                  order: item.operationOrder,
                  permission: item.permission,
                })),
                order: purposeOperations[0]?.purposeOrder,
                purpose,
              };
            },
          ),
        })),
        label: scopeLabels[scope],
        scope,
      }];
    }),
  };
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(locale);
}
