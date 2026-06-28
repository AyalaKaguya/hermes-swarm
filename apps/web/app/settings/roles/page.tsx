"use client";

import { useState, useEffect, useCallback } from "react";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getSnapshot,
  replaceRolePermissions,
  type Menu,
  type Role,
  type RolePermission,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  buildMenuPermissionKey,
  getRoleRank,
  isPlatformAdminRoleName,
  isPlatformMenuCode,
  type MenuPermissionAction,
} from "@hermes-swarm/core/tenancy/permissions";

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [currentRoleName, setCurrentRoleName] = useState<string | null>(null);
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
    if (!session?.token) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    try {
      const snap = await getSnapshot(session.token);
      const visibleRoles = snap.isPlatformAdmin
        ? snap.roles
        : snap.roles.filter((role) => !isPlatformAdminRoleName(role.name));
      const visibleRoleIds = new Set(visibleRoles.map((role) => role.id));
      setRoles(visibleRoles);
      setPermissions(
        snap.rolePermissions.filter((permission) =>
          visibleRoleIds.has(permission.roleId),
        ),
      );
      setCurrentRoleName(snap.currentUser.role?.name ?? null);
      setSelectedRoleId((current) =>
        visibleRoles.some((role) => role.id === current)
          ? current
          : (visibleRoles[0]?.id ?? null),
      );
      setMenus(
        snap.menus.filter(
          (m) =>
            m.isActive && (snap.isPlatformAdmin || !isPlatformMenuCode(m.code)),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRole =
    roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null;
  const totalPermissionCount = menus.length * 2;

  function persistedPermission(roleId: string, key: string) {
    return permissions.some(
      (p) => p.roleId === roleId && p.permission === key && p.enabled,
    );
  }

  function isChecked(
    roleId: string,
    menuCode: string,
    action: MenuPermissionAction,
  ) {
    const key = buildMenuPermissionKey(menuCode, action);
    return localPerms[roleId]?.[key] ?? persistedPermission(roleId, key);
  }

  function enabledPermissionCount(roleId: string) {
    return menus.reduce(
      (count, menu) =>
        count +
        (isChecked(roleId, menu.code, "view") ? 1 : 0) +
        (isChecked(roleId, menu.code, "manage") ? 1 : 0),
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
    const role = roles.find((item) => item.id === roleId);
    if (!role || !canManageRole(currentRoleName, role)) return;
    setLocalPerms((prev) => {
      const next = { ...prev };
      const rp = { ...(next[roleId] ?? {}) };
      const persisted = persistedPermission(roleId, key);
      const enabled = !(rp[key] ?? persisted);
      if (enabled === persisted) {
        delete rp[key];
      } else {
        rp[key] = enabled;
      }
      if (Object.keys(rp).length === 0) {
        delete next[roleId];
      } else {
        next[roleId] = rp;
      }
      return next;
    });
  }

  async function savePermissions(roleId: string) {
    const role = roles.find((item) => item.id === roleId);
    if (!role || !canManageRole(currentRoleName, role)) return;
    setSaving(roleId);
    try {
      const perms = menus.flatMap((m) => {
        const viewKey = buildMenuPermissionKey(m.code, "view");
        const manageKey = buildMenuPermissionKey(m.code, "manage");
        return [
          { permission: viewKey, enabled: isChecked(roleId, m.code, "view") },
          {
            permission: manageKey,
            enabled: isChecked(roleId, m.code, "manage"),
          },
        ];
      });
      await replaceRolePermissions(token, roleId, perms);
      setLocalPerms((prev) => {
        const n = { ...prev };
        delete n[roleId];
        return n;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(null);
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  if (error)
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          {error}
        </div>
      </div>
    );

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
              可选角色
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="flex flex-col gap-1">
              {roles.map((role) => {
                const selected = selectedRole?.id === role.id;
                const editable = canManageRole(currentRoleName, role);
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
                        className={cn(
                          "size-2 shrink-0 rounded-full border",
                          selected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium leading-5">
                          {role.label}
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
                      <Badge
                        className="px-1.5 text-[11px]"
                        variant={editable ? "outline" : "secondary"}
                      >
                        {enabledPermissionCount(role.id)}/{totalPermissionCount}
                      </Badge>
                      {selected && (
                        <AppIcon
                          className="size-3.5 -rotate-90"
                          name="chevron-down"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
              {roles.length === 0 && (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm">
                  暂无角色
                </div>
              )}
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
                      {selectedRole.label}
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="truncate">{selectedRole.name}</span>
                      <Badge
                        variant={
                          selectedRole.isSystem ? "secondary" : "outline"
                        }
                      >
                        {selectedRole.isSystem ? "系统" : "自定义"}
                      </Badge>
                      {!canManageRole(currentRoleName, selectedRole) && (
                        <Badge variant="secondary">只读</Badge>
                      )}
                      <span>
                        {enabledPermissionCount(selectedRole.id)} /{" "}
                        {totalPermissionCount} 已启用
                      </span>
                    </div>
                  </div>
                  <Button
                    disabled={
                      saving === selectedRole.id ||
                      !hasLocalChanges(selectedRole.id) ||
                      !canManageRole(currentRoleName, selectedRole)
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
                <div className="grid grid-cols-[minmax(100px,1fr)_64px_64px] items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium sm:grid-cols-[minmax(120px,1fr)_96px_96px] sm:gap-3">
                  <div>菜单</div>
                  <div className="text-center">查看</div>
                  <div className="text-center">管理</div>
                </div>
                <div className="divide-y">
                  {menus.map((menu) => {
                    const editable = canManageRole(
                      currentRoleName,
                      selectedRole,
                    );
                    const viewKey = buildMenuPermissionKey(menu.code, "view");
                    const manageKey = buildMenuPermissionKey(
                      menu.code,
                      "manage",
                    );
                    return (
                      <div
                        className="grid grid-cols-[minmax(100px,1fr)_64px_64px] items-center gap-2 px-4 py-2 sm:grid-cols-[minmax(120px,1fr)_96px_96px] sm:gap-3"
                        key={menu.code}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {menu.label}
                          </div>
                          <div className="truncate text-xs">{menu.code}</div>
                        </div>
                        <div className="flex justify-center">
                          <Checkbox
                            aria-label={`${menu.label} 查看`}
                            checked={isChecked(
                              selectedRole.id,
                              menu.code,
                              "view",
                            )}
                            disabled={!editable}
                            id={`${selectedRole.id}-${menu.code}-view`}
                            onCheckedChange={() =>
                              togglePerm(selectedRole.id, viewKey)
                            }
                          />
                        </div>
                        <div className="flex justify-center">
                          <Checkbox
                            aria-label={`${menu.label} 管理`}
                            checked={isChecked(
                              selectedRole.id,
                              menu.code,
                              "manage",
                            )}
                            disabled={!editable}
                            id={`${selectedRole.id}-${menu.code}-manage`}
                            onCheckedChange={() =>
                              togglePerm(selectedRole.id, manageKey)
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
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

function canManageRole(currentRoleName: string | null, role: Role) {
  if (isPlatformAdminRoleName(role.name)) return false;
  return getRoleRank(role.name) < getRoleRank(currentRoleName);
}
