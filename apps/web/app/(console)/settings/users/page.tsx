"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  createUser,
  deleteManagedUser,
  listTenantRoles,
  listUsers,
  replaceUserTenantRoles,
  updateManagedUser,
  type Role,
  type User,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

type UserDialog = { mode: "create" } | { mode: "edit"; user: User };

export default function UsersPage() {
  const tr = useTextTranslation();
  const access = usePermission();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [dialog, setDialog] = useState<UserDialog | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const canCreate = access.hasPermission("user.tenant_user.create:tenant");
  const canUpdate = access.hasPermission("user.tenant_user.update_basic:tenant");
  const canAssignRoles = access.hasPermission("user.tenant_user.replace_roles:tenant");
  const canDelete = access.hasPermission("user.tenant_user.delete:tenant");

  const load = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    try {
      const [nextUsers, nextRoles] = await Promise.all([
        listUsers(session),
        listTenantRoles(session),
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("用户加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) =>
      [user.displayName, user.email, user.username]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [search, users]);

  function openDialog(next: UserDialog) {
    setDialog(next);
    setForm(
      next.mode === "edit"
        ? {
            displayName: next.user.displayName,
            email: next.user.email,
            password: "",
            roleId: next.user.tenantRole?.id ?? "",
            status: next.user.status,
          }
        : emptyForm(),
    );
    setError(null);
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      if (dialog.mode === "create") {
        await createUser(session, {
          displayName: form.displayName,
          email: form.email,
          password: form.password || undefined,
          roleId: form.roleId,
          status: form.status,
        });
      } else {
        await updateManagedUser(session, dialog.user.id, {
          displayName: form.displayName,
          email: form.email,
          status: form.status,
        });
        if (canAssignRoles) {
          await replaceUserTenantRoles(session, dialog.user.id, form.roleId);
        }
      }
      setDialog(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function removeUser() {
    if (!userToDelete) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await deleteManagedUser(session, userToDelete.id);
      setUserToDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("删除失败"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{tr("加载中...")}</div>;
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("用户")}</h1>
          <p className="text-sm text-muted-foreground">{tr("管理工作空间账号、状态和工作空间角色。组织归属在组织详情中维护。")}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Input className="w-full sm:w-72" onChange={(event) => setSearch(event.target.value)} placeholder={tr("搜索用户...")} value={search} />
          {canCreate && <Button onClick={() => openDialog({ mode: "create" })} type="button"><AppIcon className="size-3.5" name="plus" />{tr("新建用户")}</Button>}
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>{tr("用户")}</TableHead><TableHead>{tr("状态")}</TableHead><TableHead>{tr("工作空间角色")}</TableHead><TableHead className="w-32 text-right">{tr("操作")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell><div className="font-medium">{user.displayName}</div><div className="text-xs text-muted-foreground">{user.email}</div></TableCell>
                  <TableCell><Badge variant={user.status === "active" ? "default" : "secondary"}>{user.status === "active" ? tr("启用") : tr("停用")}</Badge></TableCell>
                  <TableCell>{user.tenantRole ? <Badge variant="outline">{user.tenantRole.displayName ?? user.tenantRole.label}</Badge> : <span className="text-sm text-muted-foreground">{tr("未分配")}</span>}</TableCell>
                  <TableCell className="text-right"><div className="flex justify-end gap-1"><Button disabled={!canUpdate} onClick={() => openDialog({ mode: "edit", user })} size="sm" variant="ghost">{tr("编辑")}</Button><Button disabled={!canDelete || user.tenantRole?.name === "tenant-owner"} onClick={() => setUserToDelete(user)} size="sm" variant="ghost">{tr("删除")}</Button></div></TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 && <TableRow><TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={4}>{tr("暂无用户")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={(open) => { if (!open && !saving) setDialog(null); }} open={Boolean(dialog)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.mode === "create" ? tr("新建用户") : tr("编辑用户")}</DialogTitle><DialogDescription>{tr("工作空间角色对所有组织生效；组织角色请在组织成员中分配。")}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={saveUser}>
            <div className="grid gap-1.5"><Label htmlFor="user-name">{tr("显示名称")}</Label><Input id="user-name" onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required value={form.displayName} /></div>
            <div className="grid gap-1.5"><Label htmlFor="user-email">{tr("邮箱")}</Label><Input id="user-email" onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required type="email" value={form.email} /></div>
            {dialog?.mode === "create" && <div className="grid gap-1.5"><Label htmlFor="user-password">{tr("初始密码")}</Label><Input autoComplete="new-password" id="user-password" minLength={8} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder={tr("可留空，稍后通过邀请激活")} type="password" value={form.password} /></div>}
            <div className="grid gap-1.5">
              <Label htmlFor="user-status">{tr("状态")}</Label>
              <Select onValueChange={(value) => setForm((current) => ({ ...current, status: value as User["status"] }))} value={form.status}>
                <SelectTrigger className="w-full" id="user-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{tr("启用")}</SelectItem>
                  <SelectItem value="disabled">{tr("停用")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{tr("工作空间角色")}</Label><Select disabled={!canAssignRoles && dialog?.mode === "edit"} onValueChange={(roleId) => setForm((current) => ({ ...current, roleId }))} value={form.roleId || undefined}><SelectTrigger className="w-full"><SelectValue placeholder={tr("请选择角色")} /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem disabled={dialog?.mode === "edit" && dialog.user.tenantRole?.name === "tenant-owner" && role.name !== "tenant-owner"} key={role.id} value={role.id}>{role.displayName ?? role.label}</SelectItem>)}</SelectContent></Select></div>
            <DialogFooter><Button onClick={() => setDialog(null)} type="button" variant="outline">{tr("取消")}</Button><Button disabled={saving || !form.displayName.trim() || !form.email.trim() || !form.roleId} type="submit">{saving ? tr("保存中...") : tr("保存")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog confirmLabel={tr("删除")} description={tr("删除用户会立即撤销其会话和集成 Token，并移除所有组织成员关系。")} onConfirm={() => void removeUser()} onOpenChange={(open) => { if (!open && !saving) setUserToDelete(null); }} open={Boolean(userToDelete)} pending={saving} title={tr("删除用户？")} />
    </section>
  );
}

function emptyForm() {
  return { displayName: "", email: "", password: "", roleId: "", status: "active" as User["status"] };
}
