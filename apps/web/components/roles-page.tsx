"use client";

import { useState, useEffect, useCallback } from "react";
import { getSnapshot, type Role, type RolePermission, type Menu } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    try {
      const snapshot = await getSnapshot(session.token);
      setRoles(snapshot.roles);
      setPermissions(snapshot.rolePermissions);
      setMenus(snapshot.menus.filter((m) => m.isActive));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function getRolePermissions(roleId: string) {
    return permissions.filter((p) => p.roleId === roleId);
  }

  function hasPermission(roleId: string, menuCode: string, action: "manage" | "view") {
    const key = `menu:${menuCode}:${action}`;
    return permissions.some((p) => p.roleId === roleId && p.permission === key && p.enabled);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-sm text-text-secondary">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-6">
        <h1 className="text-lg font-semibold text-text-primary">角色与权限</h1>
        <p className="mt-0.5 text-sm text-text-secondary">
          管理系统角色并为每个角色配置菜单和操作权限
        </p>
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary text-left">
                <th className="px-4 py-3 font-medium text-text-secondary">角色</th>
                <th className="px-4 py-3 font-medium text-text-secondary">代码</th>
                <th className="px-4 py-3 font-medium text-text-secondary">系统</th>
                <th className="px-4 py-3 font-medium text-text-secondary">权限数</th>
                <th className="px-4 py-3 font-medium text-text-secondary w-16" />
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const rolePerms = getRolePermissions(role.id);
                const enabledCount = rolePerms.filter((p) => p.enabled).length;
                const isExpanded = expandedRole === role.id;

                return (
                  <tr key={role.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {role.label}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{role.name}</td>
                    <td className="px-4 py-3">
                      {role.isSystem ? (
                        <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                          系统
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-surface-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
                          自定义
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {enabledCount} / {rolePerms.length}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        className="text-xs font-medium text-brand hover:text-brand/80"
                        onClick={() =>
                          setExpandedRole(isExpanded ? null : role.id)
                        }
                        type="button"
                      >
                        {isExpanded ? "收起" : "查看"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {roles.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-8 text-center text-text-secondary"
                    colSpan={5}
                  >
                    暂无角色数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Expanded permissions view */}
        {expandedRole && (
          <div className="mt-6 rounded-lg border border-border p-6">
            <h3 className="text-sm font-semibold text-text-primary">
              {roles.find((r) => r.id === expandedRole)?.label ?? "角色"} 的权限
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {menus.map((menu) => (
                <div
                  className="rounded-lg border border-border bg-surface-secondary/50 px-4 py-3"
                  key={menu.code}
                >
                  <div className="text-sm font-medium text-text-primary">
                    {menu.label}
                  </div>
                  <div className="mt-2 flex gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <span
                        className={
                          hasPermission(expandedRole, menu.code, "view")
                            ? "flex h-4 w-4 items-center justify-center rounded bg-brand/20 text-brand"
                            : "flex h-4 w-4 items-center justify-center rounded bg-surface text-text-tertiary"
                        }
                      >
                        {hasPermission(expandedRole, menu.code, "view")
                          ? "✓"
                          : "—"}
                      </span>
                      查看
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <span
                        className={
                          hasPermission(expandedRole, menu.code, "manage")
                            ? "flex h-4 w-4 items-center justify-center rounded bg-brand/20 text-brand"
                            : "flex h-4 w-4 items-center justify-center rounded bg-surface text-text-tertiary"
                        }
                      >
                        {hasPermission(expandedRole, menu.code, "manage")
                          ? "✓"
                          : "—"}
                      </span>
                      管理
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
