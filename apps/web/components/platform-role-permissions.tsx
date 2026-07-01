"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { PermissionTree } from "@/components/permission-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listPermissionCatalog,
  listPlatformRoles,
  replacePlatformRolePermissions,
  type PermissionCatalog,
  type Role,
  type RolePermission,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export function PlatformRolePermissions({
  disabled,
}: {
  disabled?: boolean;
}) {
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [localPerms, setLocalPerms] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }

    setToken(session.token);
    try {
      const [roleItems, nextCatalog] = await Promise.all([
        listPlatformRoles(session.token),
        listPermissionCatalog(session.token, "platform"),
      ]);
      setCatalog(nextCatalog);
      setRoles(roleItems);
      setPermissions(roleItems.flatMap((role) => role.permissions ?? []));
      setSelectedRoleId((current) =>
        roleItems.some((role) => role.id === current)
          ? current
          : (roleItems[0]?.id ?? null),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const permissionKeys = useMemo(() => flattenCatalog(catalog), [catalog]);
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
    return permissionKeys.reduce(
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

  function togglePerm(roleId: string, key: string, enabledValue?: boolean) {
    setLocalPerms((prev) => {
      const next = { ...prev };
      const roleChanges = { ...(next[roleId] ?? {}) };
      const persisted = persistedPermission(roleId, key);
      const enabled = enabledValue ?? !(roleChanges[key] ?? persisted);
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
    setSaving(roleId);
    setError(null);
    try {
      await replacePlatformRolePermissions(
        token,
        roleId,
        permissionKeys.map((permission) => ({
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
    return <div className="py-10 text-center text-sm">加载中...</div>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(220px,280px)_1fr]">
      <Card className="min-w-0 self-start overflow-hidden shadow-none">
        <CardHeader className="border-b px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AppIcon className="size-4" name="shield" />
            平台角色
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
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {role.displayName ?? role.label}
                    </span>
                    <span className="block truncate text-xs">{role.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {dirty && <span className="size-1.5 rounded-full bg-primary" />}
                    <Badge className="px-1.5 text-[11px]" variant="outline">
                      {enabledPermissionCount(role.id)}/{permissionKeys.length}
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
                    <span>{selectedRole.name}</span>
                    <Badge variant={selectedRole.isSystem ? "secondary" : "outline"}>
                      {selectedRole.isSystem ? "系统" : "自定义"}
                    </Badge>
                    <span>
                      {enabledPermissionCount(selectedRole.id)} /{" "}
                      {permissionKeys.length} 已启用
                    </span>
                  </div>
                </div>
                <Button
                  disabled={
                    disabled ||
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
              <PermissionTree
                catalog={catalog}
                disabled={disabled || saving === selectedRole.id}
                isChecked={(permission) => isChecked(selectedRole.id, permission)}
                onToggle={(permission, enabled) =>
                  togglePerm(selectedRole.id, permission, enabled)
                }
              />
            </CardContent>
          </>
        ) : (
          <CardContent className="flex min-h-48 items-center justify-center text-sm">
            暂无平台角色
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function flattenCatalog(catalog: PermissionCatalog | null) {
  return (
    catalog?.scopes.flatMap((scope) =>
      scope.entities.flatMap((entity) =>
        entity.purposes.flatMap((purpose) =>
          purpose.operations.map((operation) => operation.permission),
        ),
      ),
    ) ?? []
  );
}
