"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getSnapshot,
  replaceRolePermissions,
  type Menu,
  type Role,
  type RolePermission,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

const ROLE_RANKS: Record<string, number> = {
  "platform-admin": 500,
  owner: 400,
  admin: 300,
  member: 200,
  viewer: 100,
};
const CUSTOM_ROLE_RANK = 150;
const PLATFORM_MENU_CODES = new Set(["tenant", "organizations"]);

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [currentRoleName, setCurrentRoleName] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>({});

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    setToken(session.token);
    try {
      const snap = await getSnapshot(session.token);
      setRoles(snap.roles);
      setPermissions(snap.rolePermissions);
      setCurrentRoleName(snap.currentUser.role?.name ?? null);
      setMenus(
        snap.menus.filter(
          (m) =>
            m.isActive &&
            (snap.scope.level === "platform" || !PLATFORM_MENU_CODES.has(m.code)),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function isChecked(roleId: string, menuCode: string, action: "manage" | "view") {
    const key = `menu:${menuCode}:${action}`;
    if (localPerms[roleId]) {
      return localPerms[roleId][key] ?? permissions.some(p => p.roleId === roleId && p.permission === key && p.enabled);
    }
    return permissions.some(p => p.roleId === roleId && p.permission === key && p.enabled);
  }

  function togglePerm(roleId: string, key: string) {
    const role = roles.find((item) => item.id === roleId);
    if (!role || !canManageRole(currentRoleName, role)) return;
    setLocalPerms(prev => {
      const rp = { ...(prev[roleId] ?? {}) };
      rp[key] = !(rp[key] ?? permissions.some(p => p.roleId === roleId && p.permission === key && p.enabled));
      return { ...prev, [roleId]: rp };
    });
  }

  async function savePermissions(roleId: string) {
    const role = roles.find((item) => item.id === roleId);
    if (!role || !canManageRole(currentRoleName, role)) return;
    setSaving(roleId);
    try {
      const perms = menus.flatMap(m => {
        const viewKey = `menu:${m.code}:view`;
        const manageKey = `menu:${m.code}:manage`;
        return [
          { permission: viewKey, enabled: isChecked(roleId, m.code, "view") },
          { permission: manageKey, enabled: isChecked(roleId, m.code, "manage") },
        ];
      });
      await replaceRolePermissions(token, roleId, perms);
      setLocalPerms(prev => { const n = { ...prev }; delete n[roleId]; return n; });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally { setSaving(null); }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="flex items-center justify-center py-16"><div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>角色与权限</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">角色</TableHead>
              <TableHead>名称</TableHead>
              <TableHead className="w-40">类型</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map(role => {
              const rolePerms = permissions.filter(p => p.roleId === role.id && p.enabled);
              const isExpanded = expandedRole === role.id;
              const editable = canManageRole(currentRoleName, role);
              return (
                <Fragment key={role.id}>
                  <TableRow className={isExpanded ? "border-b-0" : ""}>
                    <TableCell className="font-medium">{role.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{role.name}</TableCell>
                    <TableCell><Badge variant={role.isSystem ? "secondary" : "outline"}>{role.isSystem ? "系统" : "自定义"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                          size="xs"
                          variant="ghost"
                        >
                          {isExpanded ? "收起" : "权限"}
                        </Button>
                        {localPerms[role.id] && editable && (
                          <Button
                            disabled={saving === role.id}
                            onClick={() => savePermissions(role.id)}
                            size="xs"
                            variant="outline"
                          >
                            {saving === role.id ? "保存中..." : "保存"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={4} className="pt-0">
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="grid grid-cols-[minmax(140px,200px)_1fr] gap-3 px-1">
                            <div className="text-xs font-medium text-muted-foreground">菜单</div>
                            <div className="grid max-w-48 grid-cols-2 gap-3 text-xs font-medium text-muted-foreground">
                              <span>查看</span>
                              <span>管理</span>
                            </div>
                          </div>
                          {menus.map(menu => (
                            <div key={menu.code} className="grid grid-cols-[minmax(140px,200px)_1fr] items-center gap-3 border-t border-border/40 px-1 py-1.5">
                              <span className="text-sm">{menu.label}</span>
                              <div className="grid max-w-48 grid-cols-2 gap-3">
                                <Checkbox
                                  checked={isChecked(role.id, menu.code, "view")}
                                  disabled={!editable}
                                  id={`${role.id}-${menu.code}-view`}
                                  onCheckedChange={() => togglePerm(role.id, `menu:${menu.code}:view`)}
                                />
                                <Checkbox
                                  checked={isChecked(role.id, menu.code, "manage")}
                                  disabled={!editable}
                                  id={`${role.id}-${menu.code}-manage`}
                                  onCheckedChange={() => togglePerm(role.id, `menu:${menu.code}:manage`)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function getRoleRank(roleName: string | null | undefined) {
  if (!roleName) return 0;
  return ROLE_RANKS[roleName] ?? CUSTOM_ROLE_RANK;
}

function canManageRole(currentRoleName: string | null, role: Role) {
  if (role.name === "platform-admin") return false;
  return getRoleRank(role.name) < getRoleRank(currentRoleName);
}
