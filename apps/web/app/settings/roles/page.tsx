"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listOrganizationRoles,
  replaceOrganizationRolePermissions,
  type Role,
  type RolePermission,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { DEFAULT_PERMISSION_KEYS } from "@hermes-swarm/core/tenancy/permissions";

const ORGANIZATION_PERMISSION_KEYS = DEFAULT_PERMISSION_KEYS.filter(
  (permission) => permission.endsWith(":organization"),
);

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  delete: "删除",
  read: "查看",
  update: "更新",
};

export default function RolesPage() {
  const { snapshot } = useAdminShell();
  const organizationId = snapshot?.organization?.id ?? null;
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [localPerms, setLocalPerms] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !organizationId) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    try {
      const roleItems = await listOrganizationRoles(session.token, organizationId);
      setRoles(roleItems);
      setPermissions(roleItems.flatMap((role) => role.permissions ?? []));
      setSelectedRoleId((current) =>
        roleItems.some((role) => role.id === current)
          ? current
          : (roleItems[0]?.id ?? null),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const permissionRows = useMemo(() => {
    const byEntity = new Map<string, string[]>();
    for (const permission of ORGANIZATION_PERMISSION_KEYS) {
      const [entity] = permission.split(":");
      byEntity.set(entity, [...(byEntity.get(entity) ?? []), permission]);
    }
    return [...byEntity.entries()].map(([entity, items]) => ({
      entity,
      items,
    }));
  }, []);

  const selectedRole =
    roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null;

  function persistedPermission(roleId: string, key: string) {
    return permissions.some(
      (permission) =>
        permission.roleId === roleId &&
        permission.permission === key &&
        permission.enabled,
    );
  }

  function isChecked(roleId: string, key: string) {
    return localPerms[roleId]?.[key] ?? persistedPermission(roleId, key);
  }

  function enabledPermissionCount(roleId: string) {
    return ORGANIZATION_PERMISSION_KEYS.reduce(
      (count, permission) => count + (isChecked(roleId, permission) ? 1 : 0),
      0,
    );
  }

  function hasLocalChanges(roleId: string) {
    const changes = localPerms[roleId];
    return Boolean(
      changes &&
        Object.entries(changes).some(
          ([key, enabled]) => enabled !== persistedPermission(roleId, key),
        ),
    );
  }

  function togglePerm(roleId: string, key: string) {
    setLocalPerms((prev) => {
      const next = { ...prev };
      const roleChanges = { ...(next[roleId] ?? {}) };
      const persisted = persistedPermission(roleId, key);
      const enabled = !(roleChanges[key] ?? persisted);
      if (enabled === persisted) {
        delete roleChanges[key];
      } else {
        roleChanges[key] = enabled;
      }
      if (Object.keys(roleChanges).length === 0) {
        delete next[roleId];
      } else {
        next[roleId] = roleChanges;
      }
      return next;
    });
  }

  async function savePermissions(roleId: string) {
    if (!organizationId) return;
    setSaving(roleId);
    try {
      await replaceOrganizationRolePermissions(
        token,
        organizationId,
        roleId,
        ORGANIZATION_PERMISSION_KEYS.map((permission) => ({
          enabled: isChecked(roleId, permission),
          permission,
        })),
      );
      setLocalPerms((prev) => {
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h1 className="truncate text-lg font-semibold">角色与权限</h1>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(220px,280px)_1fr]">
        <Card className="min-w-0 self-start overflow-hidden shadow-none">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AppIcon className="size-4" name="shield" />
              组织角色
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="flex flex-col gap-1">
              {roles.map((role) => {
                const selected = selectedRole?.id === role.id;
                const dirty = hasLocalChanges(role.id);
                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "group flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border-primary/30 bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-muted/60",
                    )}
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    type="button"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full border"
                        style={{ backgroundColor: role.color ?? undefined }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium leading-5">
                          {role.displayName ?? role.label}
                        </span>
                        <span className="block truncate text-xs">
                          {role.name}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {dirty && (
                        <span className="size-1.5 rounded-full bg-primary" />
                      )}
                      <Badge className="px-1.5 text-[11px]" variant="outline">
                        {enabledPermissionCount(role.id)}/
                        {ORGANIZATION_PERMISSION_KEYS.length}
                      </Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden shadow-none">
          {selectedRole ? (
            <>
              <CardHeader className="border-b px-4 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-lg">
                      {selectedRole.displayName ?? selectedRole.label}
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="truncate">{selectedRole.name}</span>
                      <Badge variant={selectedRole.isSystem ? "secondary" : "outline"}>
                        {selectedRole.isSystem ? "系统" : "自定义"}
                      </Badge>
                      <span>
                        {enabledPermissionCount(selectedRole.id)} /{" "}
                        {ORGANIZATION_PERMISSION_KEYS.length} 已启用
                      </span>
                    </div>
                  </div>
                  <Button
                    disabled={
                      saving === selectedRole.id ||
                      !hasLocalChanges(selectedRole.id)
                    }
                    onClick={() => savePermissions(selectedRole.id)}
                    size="sm"
                    variant="outline"
                  >
                    {saving === selectedRole.id ? "保存中..." : "保存"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="grid grid-cols-[minmax(100px,1fr)_repeat(4,72px)] items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium">
                  <div>实体</div>
                  {["create", "read", "update", "delete"].map((action) => (
                    <div className="text-center" key={action}>
                      {ACTION_LABELS[action]}
                    </div>
                  ))}
                </div>
                <div className="divide-y">
                  {permissionRows.map((row) => (
                    <div
                      className="grid grid-cols-[minmax(100px,1fr)_repeat(4,72px)] items-center gap-2 px-4 py-2"
                      key={row.entity}
                    >
                      <div className="truncate text-sm font-medium">
                        {row.entity}
                      </div>
                      {["create", "read", "update", "delete"].map((action) => {
                        const key = `${row.entity}:${action}:organization`;
                        return (
                          <div className="flex justify-center" key={key}>
                            <Checkbox
                              aria-label={`${row.entity} ${ACTION_LABELS[action]}`}
                              checked={isChecked(selectedRole.id, key)}
                              onCheckedChange={() =>
                                togglePerm(selectedRole.id, key)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex min-h-48 items-center justify-center text-sm">
              暂无可配置角色
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
