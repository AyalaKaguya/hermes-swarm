"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
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
  createWorkspaceRole,
  deleteWorkspaceRole,
  listPermissionCatalog,
  listWorkspaceRoles,
  replaceWorkspaceRolePermissions,
  updateWorkspaceRole,
  type PermissionCatalog,
  type Role,
  type RolePayload,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";
import { isProtectedWorkspaceRole } from "@/lib/workspace-role-protection";

type RoleForm = {
  color: string;
  description: string;
  displayName: string;
  name: string;
};

type RoleDialog = { mode: "create" } | { mode: "edit"; role: Role };

export default function WorkspaceAccessPage() {
  const tr = useTextTranslation();
  const access = usePermission();
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<RoleDialog | null>(null);
  const [form, setForm] = useState<RoleForm>(emptyForm());
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    try {
      const [nextRoles, nextCatalog] = await Promise.all([
        listWorkspaceRoles(session),
        listPermissionCatalog(session),
      ]);
      const workspaceRoles = nextRoles;
      setRoles(workspaceRoles);
      setCatalog(nextCatalog);
      setSelectedRoleId((current) => workspaceRoles.some((item) => item.id === current) ? current : workspaceRoles[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const selectedCatalog = useMemo(
    () => filterCatalog(catalog),
    [catalog],
  );
  const permissionKeys = useMemo(() => flattenCatalog(selectedCatalog), [selectedCatalog]);
  const canCreate = access.hasPermission("role.workspace_role.create:workspace");
  const canUpdate = access.hasPermission("role.workspace_role.update:workspace");
  const canConfigure = access.hasPermission("role.workspace_role.replace_permissions:workspace");
  const canDelete = access.hasPermission("role.workspace_role.delete:workspace");

  function isPermissionEnabled(permission: string) {
    if (permission in permissionDrafts) return permissionDrafts[permission];
    return Boolean(selectedRole?.permissions?.some((item) => item.permission === permission && item.enabled));
  }

  function hasPermissionChanges() {
    return Object.keys(permissionDrafts).length > 0;
  }

  function togglePermission(permission: string, enabled?: boolean) {
    if (!selectedRole || isProtectedWorkspaceRole(selectedRole) || !canConfigure) return;
    const persisted = Boolean(selectedRole.permissions?.some((item) => item.permission === permission && item.enabled));
    const next = enabled ?? !isPermissionEnabled(permission);
    setPermissionDrafts((current) => {
      const result = { ...current };
      if (next === persisted) delete result[permission];
      else result[permission] = next;
      return result;
    });
  }

  async function savePermissions() {
    if (!selectedRole || isProtectedWorkspaceRole(selectedRole) || !canConfigure) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await replaceWorkspaceRolePermissions(
        session,
        selectedRole.id,
        permissionKeys.map((permission) => ({ permission, enabled: isPermissionEnabled(permission) })),
      );
      setPermissionDrafts({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  function selectRole(roleId: string) {
    setSelectedRoleId(roleId);
    setPermissionDrafts({});
  }

  function openDialog(next: RoleDialog) {
    setDialog(next);
    setForm(next.mode === "edit" ? roleToForm(next.role) : emptyForm());
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const payload: RolePayload = {
        color: form.color.trim() || null,
        description: form.description.trim() || null,
        displayName: form.displayName.trim(),
        name: dialog.mode === "edit" && dialog.role.isSystem ? undefined : form.name.trim() || undefined,
      };
      const saved = dialog.mode === "create"
        ? await createWorkspaceRole(session, payload)
        : await updateWorkspaceRole(session, dialog.role.id, payload);
      setDialog(null);
      setSelectedRoleId(saved.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function removeRole() {
    if (!roleToDelete || roleToDelete.isSystem) return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await deleteWorkspaceRole(session, roleToDelete.id);
      setRoleToDelete(null);
      setSelectedRoleId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("删除失败"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{tr("加载中...")}</div>;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("角色和权限")}</h1>
          <p className="text-sm text-muted-foreground">{tr("配置工作空间控制台、成员治理和个人能力的访问权限。")}</p>
        </div>
        <Button disabled={!canCreate || saving} onClick={() => openDialog({ mode: "create" })} size="sm">
          <AppIcon className="size-3.5" name="plus" />{tr("新建角色")}
        </Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardContent className="grid gap-4 p-3">
            <RoleGroup label={tr("工作空间角色")} roles={roles} selectedRoleId={selectedRoleId} selectRole={selectRole} systemLabel={tr("系统")} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          {selectedRole ? <>
            <CardHeader className="border-b py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: selectedRole.color ?? undefined }}
                    />
                    <CardTitle className="truncate text-base">{selectedRole.displayName ?? selectedRole.label}</CardTitle>
                  </div>
                  <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{tr("工作空间角色")}</Badge>
                    {selectedRole.isSystem && <Badge variant="secondary">{tr("系统")}</Badge>}
                    <span>{selectedRole.name}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={!canConfigure || isProtectedWorkspaceRole(selectedRole) || saving || !hasPermissionChanges()} onClick={() => void savePermissions()} size="sm" variant="outline">{tr("保存权限")}</Button>
                  <Button disabled={!canUpdate || saving} onClick={() => openDialog({ mode: "edit", role: selectedRole })} size="sm" variant="outline">{tr("编辑")}</Button>
                  <Button disabled={!canDelete || selectedRole.isSystem || saving} onClick={() => setRoleToDelete(selectedRole)} size="sm" variant="ghost">{tr("删除")}</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <PermissionTree
                catalog={selectedCatalog}
                disabled={!canConfigure || isProtectedWorkspaceRole(selectedRole) || saving}
                isChecked={isPermissionEnabled}
                onToggle={togglePermission}
              />
            </CardContent>
          </> : <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{tr("暂无可配置角色")}</div>}
        </Card>
      </div>

      <Dialog onOpenChange={(open) => { if (!open && !saving) setDialog(null); }} open={Boolean(dialog)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.mode === "edit" ? tr("编辑角色") : tr("新建角色")}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={saveRole}>
            <div className="grid gap-1.5"><Label htmlFor="role-display-name">{tr("显示名称")}</Label><Input id="role-display-name" onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required value={form.displayName} /></div>
            <div className="grid gap-1.5"><Label htmlFor="role-name">{tr("标识")}</Label><Input disabled={dialog?.mode === "edit" && dialog.role.isSystem} id="role-name" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={tr("留空后根据显示名称生成")} value={form.name} /></div>
            <div className="grid gap-1.5"><Label htmlFor="role-color">{tr("颜色")}</Label><Input id="role-color" onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} type="color" value={form.color} /></div>
            <div className="grid gap-1.5"><Label htmlFor="role-description">{tr("描述")}</Label><Textarea id="role-description" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} value={form.description} /></div>
            <DialogFooter><Button onClick={() => setDialog(null)} type="button" variant="outline">{tr("取消")}</Button><Button disabled={saving || !form.displayName.trim()} type="submit">{saving ? tr("保存中...") : tr("保存")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog confirmLabel={tr("删除")} description={tr("删除后，已分配该角色的成员将失去对应权限。") } onConfirm={() => void removeRole()} onOpenChange={(open) => { if (!open && !saving) setRoleToDelete(null); }} open={Boolean(roleToDelete)} pending={saving} title={tr("删除角色？")} />
    </div>
  );
}

function RoleGroup({ label, roles, selectedRoleId, selectRole, systemLabel }: { label: string; roles: Role[]; selectedRoleId: string | null; selectRole: (roleId: string) => void; systemLabel: string }) {
  return <div className="grid gap-1.5"><div className="px-1 text-xs font-medium text-muted-foreground">{label} · {roles.length}</div>{roles.map((role) => <Button className="w-full justify-between" key={role.id} onClick={() => selectRole(role.id)} type="button" variant={role.id === selectedRoleId ? "secondary" : "ghost"}><span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full border" style={{ backgroundColor: role.color ?? undefined }} /><span className="truncate">{role.displayName ?? role.label}</span></span>{role.isSystem && <Badge variant="secondary">{systemLabel}</Badge>}</Button>)}</div>;
}

function emptyForm(): RoleForm {
  return { color: "#64748b", description: "", displayName: "", name: "" };
}

function roleToForm(role: Role): RoleForm {
  return { color: role.color ?? "#64748b", description: role.description ?? "", displayName: role.displayName ?? role.label, name: role.name };
}

function filterCatalog(catalog: PermissionCatalog | null): PermissionCatalog | null {
  if (!catalog) return null;
  return { scopes: catalog.scopes.filter((scope) => scope.scope === "workspace" || scope.scope === "own") };
}

function flattenCatalog(catalog: PermissionCatalog | null) {
  return catalog?.scopes.flatMap((scope) => scope.entities.flatMap((entity) => entity.purposes.flatMap((purpose) => purpose.operations.map((operation) => operation.permission)))) ?? [];
}
