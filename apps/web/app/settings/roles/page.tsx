"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { PermissionTree } from "@/components/permission-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createOrganizationRole,
  deleteOrganizationRole,
  listPermissionCatalog,
  listOrganizationRoles,
  replaceOrganizationRolePermissions,
  updateOrganizationRole,
  type PermissionCatalog,
  type Role,
  type RolePermission,
  type RolePayload,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type RoleDialogState =
  | {
      mode: "create";
      role?: never;
    }
  | {
      mode: "edit";
      role: Role;
    };

type RoleForm = {
  color: string;
  description: string;
  displayName: string;
  name: string;
};

export default function RolesPage() {
  const { snapshot } = useAdminShell();
  const organizationId = snapshot?.organization?.id ?? null;
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [roleDialog, setRoleDialog] = useState<RoleDialogState | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(emptyRoleForm());
  const [localPerms, setLocalPerms] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.accessToken || !organizationId) {
      setLoading(false);
      return;
    }
    setToken(session.accessToken);
    try {
      const [roleItems, organizationCatalog, ownCatalog] = await Promise.all([
        listOrganizationRoles(session.accessToken, organizationId),
        listPermissionCatalog(session.accessToken, "organization"),
        listPermissionCatalog(session.accessToken, "own"),
      ]);
      setRoles(roleItems);
      setCatalog(mergeCatalogs(organizationCatalog, ownCatalog));
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
    if (!organizationId) return;
    setSaving(roleId);
    try {
      await replaceOrganizationRolePermissions(
        token,
        organizationId,
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

  function openRoleDialog(next: RoleDialogState) {
    setRoleDialog(next);
    setRoleForm(
      next.mode === "edit" ? roleToForm(next.role) : emptyRoleForm(),
    );
  }

  async function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !roleDialog) return;
    setSavingRole(true);
    setError(null);
    try {
      const payload: RolePayload = {
        color: nullableText(roleForm.color),
        description: nullableText(roleForm.description),
        displayName: roleForm.displayName.trim(),
        name: roleForm.name.trim() || undefined,
      };

      const saved =
        roleDialog.mode === "create"
          ? await createOrganizationRole(token, organizationId, payload)
          : await updateOrganizationRole(
              token,
              organizationId,
              roleDialog.role.id,
              payload,
            );

      setSelectedRoleId(saved.id);
      setRoleDialog(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingRole(false);
    }
  }

  async function removeRole(role: Role) {
    if (!organizationId || role.isSystem) return;
    const confirmed = window.confirm(`删除角色「${role.displayName ?? role.label}」？`);
    if (!confirmed) return;

    setSavingRole(true);
    setError(null);
    try {
      await deleteOrganizationRole(token, organizationId, role.id);
      setSelectedRoleId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSavingRole(false);
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
        <Button
          onClick={() => openRoleDialog({ mode: "create" })}
          size="sm"
          type="button"
        >
          <AppIcon className="size-3.5" name="plus" />
          新建角色
        </Button>
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
                        {permissionKeys.length}
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
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
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
                        {permissionKeys.length} 已启用
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 md:ml-auto">
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
                    <Button
                      disabled={savingRole}
                      onClick={() =>
                        openRoleDialog({ mode: "edit", role: selectedRole })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      编辑
                    </Button>
                    <Button
                      disabled={savingRole || selectedRole.isSystem}
                      onClick={() => void removeRole(selectedRole)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <PermissionTree
                  catalog={catalog}
                  disabled={saving === selectedRole.id}
                  isChecked={(permission) =>
                    isChecked(selectedRole.id, permission)
                  }
                  onToggle={(permission, enabled) =>
                    togglePerm(selectedRole.id, permission, enabled)
                  }
                />
              </CardContent>
            </>
          ) : (
            <CardContent className="flex min-h-48 items-center justify-center text-sm">
              暂无可配置角色
            </CardContent>
          )}
        </Card>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !savingRole) setRoleDialog(null);
        }}
        open={Boolean(roleDialog)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {roleDialog?.mode === "edit" ? "编辑角色" : "新建角色"}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitRole}>
            <div className="grid gap-2">
              <Label htmlFor="role-display-name">显示名称</Label>
              <Input
                id="role-display-name"
                onChange={(event) =>
                  setRoleForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                required
                value={roleForm.displayName}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-name">标识</Label>
              <Input
                id="role-name"
                onChange={(event) =>
                  setRoleForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="留空后根据显示名称生成"
                value={roleForm.name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-color">颜色</Label>
              <div className="flex items-center gap-2">
                <Input
                  className="h-9 w-14 p-1"
                  id="role-color"
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                  type="color"
                  value={roleForm.color || "#64748b"}
                />
                <Input
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                  placeholder="#64748b"
                  value={roleForm.color}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-description">描述</Label>
              <Textarea
                id="role-description"
                onChange={(event) =>
                  setRoleForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                value={roleForm.description}
              />
            </div>
            <DialogFooter>
              <Button
                disabled={savingRole}
                onClick={() => setRoleDialog(null)}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button disabled={savingRole || !roleForm.displayName.trim()}>
                {savingRole ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function emptyRoleForm(): RoleForm {
  return {
    color: "#64748b",
    description: "",
    displayName: "",
    name: "",
  };
}

function roleToForm(role: Role): RoleForm {
  return {
    color: role.color ?? "#64748b",
    description: role.description ?? "",
    displayName: role.displayName ?? role.label,
    name: role.name,
  };
}

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
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

function mergeCatalogs(...catalogs: PermissionCatalog[]) {
  return {
    scopes: catalogs.flatMap((catalog) => catalog.scopes),
  };
}
