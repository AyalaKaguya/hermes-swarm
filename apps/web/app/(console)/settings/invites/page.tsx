"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { useAdminShell } from "@/components/admin-shell";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  createInvite,
  listInvites,
  listOrganizations,
  listOrganizationRoles,
  listTenantRoles,
  resendInvite,
  revokeInvite,
  type Invite,
  type Organization,
  type Role,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

type OrganizationAssignmentDraft = {
  isDefault: boolean;
  organizationId: string;
  roleId: string;
};

export default function InvitesPage() {
  const tr = useTextTranslation();
  const { snapshot } = useAdminShell();
  const access = usePermission();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [tenantRoles, setTenantRoles] = useState<Role[]>([]);
  const [organizationRoles, setOrganizationRoles] = useState<Record<string, Role[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<Invite | null>(null);

  const canCreate = access.hasPermission("invite.workspace_invite.create:tenant");
  const canResend = access.hasPermission("invite.workspace_invite.resend:tenant");
  const canRevoke = access.hasPermission("invite.workspace_invite.delete:tenant");

  const load = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    try {
      const [nextInvites, allOrganizations, nextTenantRoles] = await Promise.all([
        listInvites(session),
        listOrganizations(session),
        listTenantRoles(session),
      ]);
      const manageableIds = new Set(
        (snapshot?.memberships ?? [])
          .filter(
            (membership) =>
              membership.status === "active" &&
              membership.role?.permissions?.some(
                (permission) =>
                  permission.enabled &&
                  permission.permission ===
                    "user.organization_member.create:organization",
              ),
          )
          .map((membership) => membership.organizationId),
      );
      const nextOrganizations = allOrganizations.filter((organization) => manageableIds.has(organization.id));
      const nextOrganizationRoles = Object.fromEntries(
        await Promise.all(nextOrganizations.map(async (organization) => [
          organization.id,
          await listOrganizationRoles(session, organization.id),
        ] as const)),
      );
      setInvites(nextInvites);
      setOrganizations(nextOrganizations);
      setTenantRoles(nextTenantRoles);
      setOrganizationRoles(nextOrganizationRoles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("邀请加载失败"));
    } finally {
      setLoading(false);
    }
  }, [snapshot?.memberships, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const organizationById = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization])),
    [organizations],
  );

  function toggleOrganization(organizationId: string, checked: boolean) {
    setForm((current) => {
      if (checked) {
        return {
          ...current,
          organizations: [...current.organizations, { isDefault: current.organizations.length === 0, organizationId, roleId: "" }],
        };
      }

      const removed = current.organizations.find((item) => item.organizationId === organizationId);
      const remaining = current.organizations.filter((item) => item.organizationId !== organizationId);
      return {
        ...current,
        organizations: removed?.isDefault && remaining.length > 0
          ? remaining.map((item, index) => ({ ...item, isDefault: index === 0 }))
          : remaining,
      };
    });
  }

  function updateAssignment(
    organizationId: string,
    update: (assignment: OrganizationAssignmentDraft) => OrganizationAssignmentDraft,
  ) {
    setForm((current) => ({
      ...current,
      organizations: current.organizations.map((assignment) =>
        assignment.organizationId === organizationId ? update(assignment) : assignment,
      ),
    }));
  }

  function setDefaultOrganization(organizationId: string) {
    setForm((current) => ({
      ...current,
      organizations: current.organizations.map((assignment) => ({
        ...assignment,
        isDefault: assignment.organizationId === organizationId,
      })),
    }));
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await createInvite(session, form);
      setForm(emptyForm());
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("创建邀请失败"));
    } finally {
      setSaving(false);
    }
  }

  async function resend(item: Invite) {
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await resendInvite(session, item.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("重发邀请失败"));
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!inviteToRevoke) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await revokeInvite(session, inviteToRevoke.id);
      setInviteToRevoke(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("撤销邀请失败"));
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
        <div><h1 className="text-lg font-semibold">{tr("邀请")}</h1><p className="text-sm text-muted-foreground">{tr("通过一个入口邀请用户，并同时分配工作空间角色和多个组织成员关系。")}</p></div>
        {canCreate && <Button onClick={() => setCreateOpen(true)} type="button"><AppIcon className="size-3.5" name="mail" />{tr("创建邀请")}</Button>}
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>{tr("邮箱")}</TableHead><TableHead>{tr("组织")}</TableHead><TableHead>{tr("状态")}</TableHead><TableHead>{tr("有效期")}</TableHead><TableHead className="w-40 text-right">{tr("操作")}</TableHead></TableRow></TableHeader>
        <TableBody>
          {invites.map((invite) => <TableRow key={invite.id}>
            <TableCell><div className="font-medium">{invite.email}</div>{invite.existingUser && <div className="text-xs text-muted-foreground">{tr("已有工作空间账号")}</div>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{invite.organizationAssignments.length ? invite.organizationAssignments.map((assignment) => <Badge key={assignment.organizationId} variant="outline">{organizationById.get(assignment.organizationId)?.name ?? assignment.organizationId}{assignment.isDefault ? ` · ${tr("默认")}` : ""}</Badge>) : <span className="text-sm text-muted-foreground">{tr("仅工作空间")}</span>}</div></TableCell>
            <TableCell><Badge variant={invite.status === "invited" ? "default" : "secondary"}>{statusLabel(invite.status, tr)}</Badge></TableCell>
            <TableCell className="text-sm text-muted-foreground">{invite.expireDate ? new Date(invite.expireDate).toLocaleString() : tr("永久")}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-1">{invite.status === "invited" && <><Button disabled={!canResend || saving} onClick={() => void resend(invite)} size="sm" variant="ghost">{tr("重发")}</Button><Button disabled={!canRevoke || saving} onClick={() => setInviteToRevoke(invite)} size="sm" variant="ghost">{tr("撤销")}</Button></>}</div></TableCell>
          </TableRow>)}
          {invites.length === 0 && <TableRow><TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={5}>{tr("暂无邀请")}</TableCell></TableRow>}
        </TableBody>
      </Table></CardContent></Card>

      <Dialog onOpenChange={(open) => { if (!open && !saving) { setCreateOpen(false); setForm(emptyForm()); } }} open={createOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{tr("创建邀请")}</DialogTitle><DialogDescription>{tr("受邀用户接受后，会在一个事务中获得账号、组织成员关系和所选角色。")}</DialogDescription></DialogHeader>
          <form className="grid gap-5" onSubmit={submitInvite}>
            <div className="grid gap-1.5"><Label htmlFor="invite-email">{tr("邮箱")}</Label><Input autoComplete="email" id="invite-email" onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required type="email" value={form.email} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-expiry">{tr("有效期")}</Label>
              <Select onValueChange={(value) => setForm((current) => ({ ...current, expiresIn: value as typeof current.expiresIn }))} value={form.expiresIn}>
                <SelectTrigger className="w-full" id="invite-expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3d">{tr("3 天")}</SelectItem>
                  <SelectItem value="7d">{tr("7 天")}</SelectItem>
                  <SelectItem value="never">{tr("永久")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label>{tr("工作空间角色")}</Label><Select onValueChange={(workspaceRoleId) => setForm((current) => ({ ...current, workspaceRoleId }))} value={form.workspaceRoleId || undefined}><SelectTrigger className="w-full"><SelectValue placeholder={tr("请选择角色")} /></SelectTrigger><SelectContent>{tenantRoles.map((role) => <SelectItem key={role.id} value={role.id}>{role.displayName ?? role.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2">
              <Label>{tr("组织成员关系")}</Label>
              <div className="grid gap-2">
                {organizations.filter((organization) => organization.status === "active").map((organization) => {
                  const assignment = form.organizations.find((item) => item.organizationId === organization.id);
                  return (
                    <Card key={organization.id} size="sm">
                      <CardContent className="grid gap-3">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <Checkbox checked={Boolean(assignment)} onCheckedChange={(checked) => toggleOrganization(organization.id, checked === true)} />
                          {organization.name}
                        </label>
                        {assignment && (
                          <div className="grid gap-3 border-t pt-3">
                            <OrganizationRoleSelect
                              label={tr("组织角色")}
                              onValueChange={(roleId) =>
                                updateAssignment(organization.id, (current) => ({
                                  ...current,
                                  roleId,
                                }))
                              }
                              roles={organizationRoles[organization.id] ?? []}
                              tr={tr}
                              value={assignment.roleId}
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                {organizations.length === 0 && <span className="text-sm text-muted-foreground">{tr("暂无可分配组织")}</span>}
              </div>
            </div>
            {form.organizations.length > 0 && (
              <div className="grid gap-2">
                <Label>{tr("默认组织")}</Label>
                <RadioGroup className="rounded-lg border p-3" onValueChange={setDefaultOrganization} value={form.organizations.find((item) => item.isDefault)?.organizationId ?? ""}>
                  {form.organizations.map((assignment) => {
                    const organization = organizations.find((item) => item.id === assignment.organizationId);
                    const defaultId = `default-organization-${assignment.organizationId}`;
                    return (
                      <div className="flex items-center gap-2" key={assignment.organizationId}>
                        <RadioGroupItem id={defaultId} value={assignment.organizationId} />
                        <Label htmlFor={defaultId}>{organization?.name ?? assignment.organizationId}</Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </div>
            )}
            <DialogFooter><Button onClick={() => setCreateOpen(false)} type="button" variant="outline">{tr("取消")}</Button><Button disabled={saving || !form.email.trim() || !form.workspaceRoleId || form.organizations.some((assignment) => !assignment.roleId)} type="submit">{saving ? tr("创建中...") : tr("创建邀请")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog confirmLabel={tr("撤销")} description={tr("撤销后，邀请链接会立即失效。已经接受的账号和成员关系不会被删除。")} onConfirm={() => void revoke()} onOpenChange={(open) => { if (!open && !saving) setInviteToRevoke(null); }} open={Boolean(inviteToRevoke)} pending={saving} title={tr("撤销邀请？")} />
    </section>
  );
}

function OrganizationRoleSelect({ label, onValueChange, roles, tr, value }: { label: string; onValueChange: (roleId: string) => void; roles: Role[]; tr: (value: string) => string; value: string }) {
  return <div className="grid gap-2"><Label>{label}</Label>{roles.length > 0 ? <Select onValueChange={onValueChange} value={value || undefined}><SelectTrigger className="w-full"><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.displayName ?? role.label}</SelectItem>)}</SelectContent></Select> : <span className="text-sm text-muted-foreground">{tr("暂无可分配角色")}</span>}</div>;
}

function emptyForm() {
  return { email: "", expiresIn: "3d" as "3d" | "7d" | "never", organizations: [] as OrganizationAssignmentDraft[], workspaceRoleId: "" };
}

function statusLabel(status: Invite["status"], tr: (value: string) => string) {
  return tr({ accepted: "已接受", declined: "已拒绝", expired: "已过期", invited: "待接受", revoked: "已撤销" }[status]);
}
