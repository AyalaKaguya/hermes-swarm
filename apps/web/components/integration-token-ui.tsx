"use client";

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { PermissionTree } from "@/components/permission-tree";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
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
  scopeKey: string;
};

export function CreateTokenDialog({
  canCreate,
  capabilities,
  createToken,
  draft,
  onOpenChange,
  open,
  selectedCapability,
  setDraft,
  submitting,
  togglePermission,
  tr,
  updateScope,
}: {
  canCreate: boolean;
  capabilities: IntegrationTokenScopeCapability[];
  createToken: () => void;
  draft: IntegrationTokenDraft;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedCapability: IntegrationTokenScopeCapability | null;
  setDraft: Dispatch<SetStateAction<IntegrationTokenDraft>>;
  submitting: boolean;
  togglePermission: (permission: string, checked: boolean) => void;
  tr: (value: string | null | undefined) => string;
  updateScope: (scopeKey: string) => void;
}) {
  const catalog = useMemo(
    () => capabilityToCatalog(selectedCapability, tr),
    [selectedCapability, tr],
  );
  const selectedCount = draft.permissions.length;
  const totalCount = selectedCapability?.permissions.length ?? 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="grid h-[min(80vh,72rem)] max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{tr("创建 Token")}</DialogTitle>
          <DialogDescription>
            {tr("选择这个 Token 可使用的作用范围、有效期和权限。")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-4 p-4">
          <div className="grid gap-2">
            <Label htmlFor="integration-scope">{tr("作用范围")}</Label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={submitting}
              id="integration-scope"
              onChange={(event) => updateScope(event.target.value)}
              value={draft.scopeKey}
            >
              {capabilities.map((capability) => (
                <option
                  key={scopeCapabilityKey(capability)}
                  value={scopeCapabilityKey(capability)}
                >
                  {formatScopeCapability(capability, tr)}
                </option>
              ))}
            </select>
          </div>
          {(selectedCapability?.scope === "organization" ||
            selectedCapability?.scope === "department") && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {selectedCapability.scope === "department"
                  ? tr("所属部门")
                  : tr("所属组织")}
              </span>
              <span className="ml-2 font-medium">
                {selectedCapability.scope === "department"
                  ? selectedCapability.departmentName ??
                    selectedCapability.departmentId ??
                    tr("当前部门")
                  : selectedCapability.organizationName ??
                    selectedCapability.organizationId ??
                    tr("当前组织")}
              </span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="integration-note">{tr("备注")}</Label>
              <Input
                disabled={submitting}
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
                disabled={submitting}
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

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{tr("权限")}</div>
                <div className="text-xs text-muted-foreground">
                  {tr("只能选择当前账号在该作用范围内已经拥有的权限。")}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedCount} / {totalCount} {tr("已选择")}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain rounded-lg border">
              <PermissionTree
                catalog={catalog}
                disabled={submitting}
                isChecked={(permission) => draft.permissions.includes(permission)}
                onToggle={(permission, enabled) =>
                  togglePermission(permission, enabled === true)
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-b-xl border-t bg-muted/50 px-5 py-4">
          <Button
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {tr("取消")}
          </Button>
          <Button disabled={!canCreate} onClick={createToken} type="button">
            {tr("创建 Token")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreatedTokenDialog({
  createdToken,
  organizationNames,
  onOpenChange,
  tr,
}: {
  createdToken: CreatedIntegrationToken | null;
  organizationNames: Map<string, string>;
  onOpenChange: (open: boolean) => void;
  tr: (value: string | null | undefined) => string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(createdToken)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("保存这个 Token")}</DialogTitle>
          <DialogDescription>
            {tr("Token 只会显示一次。关闭页面后只能撤销并重新创建。")}
          </DialogDescription>
        </DialogHeader>
        {createdToken && (
          <div className="grid gap-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">{tr("作用范围")}</span>
            <span className="font-medium">
              {formatTokenScope(createdToken, organizationNames, tr)}
            </span>
          </div>
        )}
        <Textarea
          className="min-h-32 font-mono text-xs"
          readOnly
          value={createdToken?.token ?? ""}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button">
            {tr("关闭")}
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
  organizationNames,
  showOwner,
  title,
  tokens,
  tr,
}: {
  canRevoke?: boolean;
  emptyText: string;
  locale: string;
  onRevoke: (token: IntegrationToken) => void;
  organizationNames: Map<string, string>;
  showOwner?: boolean;
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
                        {formatTokenScope(token, organizationNames, tr)}
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
                      {showOwner && token.owner && (
                        <span>
                          {tr("创建人")} {token.owner.displayName || token.owner.email}
                        </span>
                      )}
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
                  {!inactive && canRevoke && (
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

export function emptyIntegrationTokenDraft(
  capability?: IntegrationTokenScopeCapability | null,
): IntegrationTokenDraft {
  return {
    expiresAt: formatDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    note: "",
    permissions: [],
    scopeKey: capability ? scopeCapabilityKey(capability) : "",
  };
}

export function scopeCapabilityKey(capability: IntegrationTokenScopeCapability) {
  return [
    capability.scope,
    capability.organizationId ?? "none",
    capability.departmentId ?? "none",
  ].join(":");
}

function capabilityToCatalog(
  capability: IntegrationTokenScopeCapability | null,
  tr: (value: string | null | undefined) => string,
): PermissionCatalog {
  if (!capability) return { scopes: [] };

  const entities: PermissionCatalog["scopes"][number]["entities"] = [];
  const entityMap = new Map<string, PermissionCatalog["scopes"][number]["entities"][number]>();
  const purposeMaps = new Map<
    string,
    Map<string, PermissionCatalog["scopes"][number]["entities"][number]["purposes"][number]>
  >();

  for (const permission of capability.permissions) {
    const parsed = parsePermissionParts(permission.permission);
    const entityKey = permission.entity ?? parsed.entity;
    let entity = entityMap.get(entityKey);
    if (!entity) {
      entity = {
        entity: entityKey,
        label: permission.entityLabel ?? entityKey,
        order: permission.entityOrder ?? null,
        purposes: [],
      };
      entityMap.set(entityKey, entity);
      purposeMaps.set(entityKey, new Map());
      entities.push(entity);
    }

    const purposeKey = permission.purpose ?? parsed.purpose;
    const entityPurposeMap = purposeMaps.get(entityKey);
    let purpose = entityPurposeMap?.get(purposeKey);
    if (!purpose) {
      purpose = {
        label: permission.purposeLabel ?? purposeKey,
        operations: [],
        order: permission.purposeOrder ?? null,
        purpose: purposeKey,
      };
      entityPurposeMap?.set(purposeKey, purpose);
      entity.purposes.push(purpose);
    }

    purpose.operations.push({
      description: permission.description,
      isDangerous: permission.isDangerous,
      label: permission.label,
      operation: permission.operation ?? parsed.operation,
      order: permission.operationOrder ?? null,
      permission: permission.permission,
    });
  }

  return {
    scopes: [
      {
        entities,
        label: formatScopeCapability(capability, tr),
        scope: capability.scope,
      },
    ],
  };
}

function parsePermissionParts(permission: string) {
  const [path] = permission.split(":");
  const parts = path.split(".");
  const entity = parts.shift() || "permission";
  const operation = parts.pop() || "access";
  const purpose = parts.join(".") || "default";
  return { entity, operation, purpose };
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
  if (capability.scope === "tenant") return tr("租户");
  if (capability.scope === "department") {
    return `${tr("部门")} / ${capability.departmentName ?? capability.departmentId}`;
  }
  return `${tr("组织")} / ${capability.organizationName ?? capability.organizationId}`;
}

function formatTokenScope(
  token: IntegrationToken,
  organizationNames: Map<string, string>,
  tr: (value: string | null | undefined) => string,
) {
  if (token.scope === "tenant") return tr("租户");
  if (token.scope === "department") {
    return `${tr("部门")} / ${token.departmentName ?? token.departmentId ?? tr("当前部门")}`;
  }
  const organizationLabel =
    token.organizationName ??
    (token.organizationId ? organizationNames.get(token.organizationId) ?? token.organizationId : null);
  return organizationLabel
    ? `${tr("组织")} / ${organizationLabel}`
    : tr("组织");
}
