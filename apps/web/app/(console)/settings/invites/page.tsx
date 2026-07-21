"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { useI18n } from "@/components/i18n-provider";
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
  createInvite,
  listInvites,
  listWorkspaceRoles,
  resendInvite,
  revokeInvite,
  type Invite,
  type Role,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { formatRuntimeDateTime } from "@/lib/runtime-format";

export default function InvitesPage() {
  const tr = useTextTranslation();
  const { runtimePreferences } = useI18n();
  const access = usePermission();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToRevoke, setInviteToRevoke] = useState<Invite | null>(null);

  const canCreate = access.hasPermission("invite.workspace_invite.create:workspace");
  const canResend = access.hasPermission("invite.workspace_invite.resend:workspace");
  const canRevoke = access.hasPermission("invite.workspace_invite.delete:workspace");

  const load = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    try {
      const [nextInvites, nextRoles] = await Promise.all([
        listInvites(session),
        listWorkspaceRoles(session),
      ]);
      setInvites(nextInvites);
      setRoles(nextRoles);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("邀请加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("创建邀请失败"));
    } finally {
      setSaving(false);
    }
  }

  async function resend(invite: Invite) {
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await resendInvite(session, invite.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("重发邀请失败"));
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!inviteToRevoke) return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await revokeInvite(session, inviteToRevoke.id);
      setInviteToRevoke(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr("撤销邀请失败"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
        {tr("加载中...")}
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("邀请")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("邀请成员加入当前工作空间，并为其分配唯一的工作空间角色。")}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} type="button">
            <AppIcon className="size-3.5" name="mail" />
            {tr("创建邀请")}
          </Button>
        )}
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("邮箱")}</TableHead>
                <TableHead>{tr("角色")}</TableHead>
                <TableHead>{tr("状态")}</TableHead>
                <TableHead>{tr("有效期")}</TableHead>
                <TableHead className="w-40 text-right">{tr("操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell>
                    <div className="font-medium">{invite.email}</div>
                    {invite.existingUser && (
                      <div className="text-xs text-muted-foreground">
                        {tr("已有工作空间账号")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {roles.find((role) => role.id === invite.workspaceRoleId)
                      ?.displayName ??
                      roles.find((role) => role.id === invite.workspaceRoleId)
                        ?.label ??
                      invite.workspaceRoleId}
                  </TableCell>
                  <TableCell>
                    <Badge variant={invite.status === "invited" ? "default" : "secondary"}>
                      {statusLabel(invite.status, tr)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {invite.expireDate
                      ? formatRuntimeDateTime(invite.expireDate, runtimePreferences)
                      : tr("永久")}
                  </TableCell>
                  <TableCell className="text-right">
                    {invite.status === "invited" && (
                      <div className="flex justify-end gap-1">
                        <Button
                          disabled={!canResend || saving}
                          onClick={() => void resend(invite)}
                          size="sm"
                          variant="ghost"
                        >
                          {tr("重发")}
                        </Button>
                        <Button
                          disabled={!canRevoke || saving}
                          onClick={() => setInviteToRevoke(invite)}
                          size="sm"
                          variant="ghost"
                        >
                          {tr("撤销")}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {invites.length === 0 && (
                <TableRow>
                  <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={5}>
                    {tr("暂无邀请")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !saving) {
            setCreateOpen(false);
            setForm(emptyForm());
          }
        }}
        open={createOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("创建邀请")}</DialogTitle>
            <DialogDescription>
              {tr("接受邀请后，成员账号与角色会在同一事务中创建。")}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitInvite}>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">{tr("邮箱")}</Label>
              <Input
                autoComplete="email"
                id="invite-email"
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                required
                type="email"
                value={form.email}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-expiry">{tr("有效期")}</Label>
              <Select
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    expiresIn: value as typeof current.expiresIn,
                  }))
                }
                value={form.expiresIn}
              >
                <SelectTrigger className="w-full" id="invite-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3d">{tr("3 天")}</SelectItem>
                  <SelectItem value="7d">{tr("7 天")}</SelectItem>
                  <SelectItem value="never">{tr("永久")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{tr("工作空间角色")}</Label>
              <Select
                onValueChange={(workspaceRoleId) =>
                  setForm((current) => ({ ...current, workspaceRoleId }))
                }
                value={form.workspaceRoleId || undefined}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={tr("请选择角色")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.displayName ?? role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={() => setCreateOpen(false)} type="button" variant="outline">
                {tr("取消")}
              </Button>
              <Button
                disabled={saving || !form.email.trim() || !form.workspaceRoleId}
                type="submit"
              >
                {saving ? tr("创建中...") : tr("创建邀请")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        confirmLabel={tr("撤销")}
        description={tr("撤销后，该邀请链接将立即失效。")}
        onConfirm={() => void revoke()}
        onOpenChange={(open) => {
          if (!open && !saving) setInviteToRevoke(null);
        }}
        open={Boolean(inviteToRevoke)}
        pending={saving}
        title={tr("撤销邀请？")}
      />
    </section>
  );
}

function emptyForm() {
  return {
    email: "",
    expiresIn: "3d" as "3d" | "7d" | "never",
    workspaceRoleId: "",
  };
}

function statusLabel(
  status: Invite["status"],
  tr: (value: string) => string,
) {
  const labels: Record<Invite["status"], string> = {
    accepted: tr("已接受"),
    declined: tr("已拒绝"),
    expired: tr("已过期"),
    invited: tr("待接受"),
    revoked: tr("已撤销"),
  };
  return labels[status];
}
