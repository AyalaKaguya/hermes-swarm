"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { useOrganizationContext } from "@/components/organization-context-provider";
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
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  createOrganizationRole,
  deleteOrganizationRole,
  listOrganizationPermissionCatalog,
  listOrganizationRoles,
  replaceOrganizationRolePermissions,
  updateOrganizationRole,
  type PermissionCatalog,
  type Role,
  type RolePayload,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

type RoleForm = {
  color: string;
  description: string;
  displayName: string;
  name: string;
};

type RoleDialog = { mode: "create" } | { mode: "edit"; role: Role };

export default function OrganizationRolesPage() {
  const { activeOrganizationId } = useOrganizationContext();
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
    if (!activeOrganizationId) {
      setLoading(false);
      return;
    }
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) return;
    setLoading(true);
    try {
      const [nextRoles, nextCatalog] = await Promise.all([
        listOrganizationRoles(session, activeOrganizationId),
        listOrganizationPermissionCatalog(session, activeOrganizationId),
      ]);
      setRoles(nextRoles);
      setCatalog(nextCatalog);
      setSelectedRoleId((current) =>
        nextRoles.some((role) => role.id === current) ? current : nextRoles[0]?.id ?? null,
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("组织角色加载失败"));
    } finally {
      setLoading(false);
    }
  }, [activeOrganizationId, tr]);

  useEffect(() => { void load(); }, [load]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const permissionKeys = useMemo(() => flattenCatalog(catalog), [catalog]);
  const canCreate = access.hasPermission("role.organization_role.create:organization");
  const canUpdate = access.hasPermission("role.organization_role.update:organization");
  const canConfigure = access.hasPermission("role.organization_role.replace_permissions:organization");
  const canDelete = access.hasPermission("role.organization_role.delete:organization");

  function isPermissionEnabled(permission: string) {
    if (permission in permissionDrafts) return permissionDrafts[permission];
    return Boolean(selectedRole?.permissions?.some((item) => item.permission === permission && item.enabled));
  }

  function togglePermission(permission: string, enabled?: boolean) {
    if (!selectedRole || selectedRole.name === "owner" || !canConfigure) return;
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
    if (!activeOrganizationId || !selectedRole || selectedRole.name === "owner") return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await replaceOrganizationRolePermissions(
        session,
        activeOrganizationId,
        selectedRole.id,
        permissionKeys.map((permission) => ({ permission, enabled: isPermissionEnabled(permission) })),
      );
      setPermissionDrafts({});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("权限保存失败"));
    } finally {
      setSaving(false);
    }
  }

  function openDialog(next: RoleDialog) {
    setDialog(next);
    setForm(next.mode === "edit" ? toForm(next.role) : emptyForm());
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrganizationId || !dialog) return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const payload: RolePayload = {
        color: form.color || null,
        description: form.description.trim() || null,
        displayName: form.displayName.trim(),
        name: dialog.mode === "edit" && dialog.role.isSystem ? undefined : form.name.trim() || undefined,
      };
      const role = dialog.mode === "create"
        ? await createOrganizationRole(session, activeOrganizationId, payload)
        : await updateOrganizationRole(session, activeOrganizationId, dialog.role.id, payload);
      setDialog(null);
      setSelectedRoleId(role.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("角色保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function removeRole() {
    if (!activeOrganizationId || !roleToDelete || roleToDelete.isSystem) return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await deleteOrganizationRole(session, activeOrganizationId, roleToDelete.id);
      setRoleToDelete(null);
      setSelectedRoleId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("角色删除失败"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{tr("加载中...")}</div>;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("角色与权限")}</h1>
          <p className="text-sm text-muted-foreground">{tr("角色仅属于当前组织，不会影响其他组织或自动向下级继承。")}</p>
        </div>
        <Button disabled={!canCreate || saving} onClick={() => openDialog({ mode: "create" })} size="sm">
          <AppIcon className="size-3.5" name="plus" />{tr("新建角色")}
        </Button>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardContent className="grid gap-1.5 p-3">
            {roles.map((role) => (
              <Button className="justify-between" key={role.id} onClick={() => { setSelectedRoleId(role.id); setPermissionDrafts({}); }} variant={role.id === selectedRoleId ? "secondary" : "ghost"}>
                <span className="truncate">{role.displayName ?? role.label}</span>
                {role.isSystem && <Badge variant="secondary">{tr("系统")}</Badge>}
              </Button>
            ))}
          </CardContent>
        </Card>
        <Card className="min-w-0 overflow-hidden">
          {selectedRole ? <>
            <CardHeader className="border-b py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><CardTitle className="text-base">{selectedRole.displayName ?? selectedRole.label}</CardTitle><div className="mt-1 font-mono text-xs text-muted-foreground">{selectedRole.name}</div></div>
                <div className="flex gap-2">
                  <Button disabled={!canConfigure || selectedRole.name === "owner" || saving || !Object.keys(permissionDrafts).length} onClick={() => void savePermissions()} size="sm" variant="outline">{tr("保存权限")}</Button>
                  <Button disabled={!canUpdate || saving} onClick={() => openDialog({ mode: "edit", role: selectedRole })} size="sm" variant="outline">{tr("编辑")}</Button>
                  <Button disabled={!canDelete || selectedRole.isSystem || saving} onClick={() => setRoleToDelete(selectedRole)} size="sm" variant="ghost">{tr("删除")}</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0"><PermissionTree catalog={catalog} disabled={!canConfigure || selectedRole.name === "owner" || saving} isChecked={isPermissionEnabled} onToggle={togglePermission} /></CardContent>
          </> : <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{tr("暂无组织角色")}</div>}
        </Card>
      </div>
      <Dialog onOpenChange={(open) => { if (!open && !saving) setDialog(null); }} open={Boolean(dialog)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.mode === "edit" ? tr("编辑角色") : tr("新建角色")}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={saveRole}>
            <Field label={tr("显示名称")}><Input onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required value={form.displayName} /></Field>
            <Field label={tr("标识")}><Input disabled={dialog?.mode === "edit" && dialog.role.isSystem} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} value={form.name} /></Field>
            <Field label={tr("颜色")}><Input onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} type="color" value={form.color} /></Field>
            <Field label={tr("描述")}><Textarea onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} value={form.description} /></Field>
            <DialogFooter><Button onClick={() => setDialog(null)} type="button" variant="outline">{tr("取消")}</Button><Button disabled={saving || !form.displayName.trim()} type="submit">{saving ? tr("保存中...") : tr("保存")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog confirmLabel={tr("删除")} description={tr("已分配给成员的角色不能删除。") } onConfirm={() => void removeRole()} onOpenChange={(open) => { if (!open && !saving) setRoleToDelete(null); }} open={Boolean(roleToDelete)} pending={saving} title={tr("删除角色？")} />
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

function emptyForm(): RoleForm {
  return { color: "#2563eb", description: "", displayName: "", name: "" };
}

function toForm(role: Role): RoleForm {
  return { color: role.color ?? "#2563eb", description: role.description ?? "", displayName: role.displayName ?? role.label, name: role.name };
}

function flattenCatalog(catalog: PermissionCatalog | null) {
  return catalog?.scopes.flatMap((scope) => scope.entities.flatMap((entity) => entity.purposes.flatMap((purpose) => purpose.operations.map((operation) => operation.permission)))) ?? [];
}
