"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  createPlatformMember,
  deletePlatformMember,
  listPlatformMembers,
  listPlatformRoles,
  updatePlatformMember,
  type PlatformMember,
  type Role,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";

type PlatformMemberManagementProps = {
  canCreateMember?: boolean;
  canRemoveMember?: boolean;
  canUpdateMember?: boolean;
  canViewMembers?: boolean;
  canViewRoles?: boolean;
  onChanged?: () => Promise<void> | void;
};

type MemberDraft = {
  roleId: string;
  status: "active" | "disabled";
};

export function PlatformMemberManagement({
  canCreateMember,
  canRemoveMember,
  canUpdateMember,
  canViewMembers,
  canViewRoles,
  onChanged,
}: PlatformMemberManagementProps) {
  const tr = useTextTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<PlatformMember[]>([]);
  const [memberToRemove, setMemberToRemove] = useState<PlatformMember | null>(
    null,
  );
  const [roles, setRoles] = useState<Role[]>([]);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canViewMembers) {
      setLoading(false);
      return;
    }

    const token = await getAuthenticatedAdminSessionMarker();
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [memberItems, roleItems] = await Promise.all([
        listPlatformMembers(token),
        canViewRoles ? listPlatformRoles(token) : Promise.resolve([]),
      ]);
      setMembers(memberItems);
      setRoles(roleItems);
      setDrafts(
        Object.fromEntries(
          memberItems.map((member) => [
            member.id,
            {
              roleId: member.roleId ?? "none",
              status: member.status === "active" ? "active" : "disabled",
            },
          ]),
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [canViewMembers, canViewRoles, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const canOpenCreate = Boolean(
    canCreateMember && canViewRoles && roles.length > 0,
  );

  async function saveMember(member: PlatformMember) {
    if (!canUpdateMember) return;
    const draft = drafts[member.id];
    if (!draft) return;

    setSavingMemberId(member.id);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await updatePlatformMember(token, member.id, {
        roleId: draft.roleId === "none" ? null : draft.roleId,
        status: draft.status,
      });
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSavingMemberId(null);
    }
  }

  async function removeMember(member: PlatformMember) {
    if (!canRemoveMember) return;
    setSavingMemberId(member.id);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await deletePlatformMember(token, member.id);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("移除失败"));
    } finally {
      setSavingMemberId(null);
    }
  }

  if (loading) {
    return <div className="py-10 text-center text-sm">{tr("加载中...")}</div>;
  }

  if (!canViewMembers) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm">
        {tr("当前账号无权查看平台用户。")}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{tr("平台用户管理")}</CardTitle>
          <CardDescription>
            {tr("管理全局账号的平台成员关系、状态与平台角色")}
          </CardDescription>
        </div>
        <Button
          disabled={!canOpenCreate}
          onClick={() => setCreateOpen(true)}
          size="sm"
          type="button"
        >
          <AppIcon className="size-3.5" name="plus" />
          {tr("添加")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        {!canOpenCreate && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {tr(
              "添加平台用户需要拥有平台成员添加和平台角色查看权限，并至少存在一个平台角色。",
            )}
          </div>
        )}
        {members.length === 0 ? (
          <div className="rounded-md border bg-muted/30 px-3 py-8 text-center text-sm">
            {tr("暂无平台用户")}
          </div>
        ) : (
          <div className="grid gap-2">
            {members.map((member) => {
              const draft = drafts[member.id] ?? {
                roleId: member.roleId ?? "none",
                status: member.status === "active" ? "active" : "disabled",
              };
              const dirty =
                draft.roleId !== (member.roleId ?? "none") ||
                draft.status !== member.status;
              const busy = savingMemberId === member.id;

              return (
                <div
                  className="grid gap-3 rounded-md border px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)_8rem_auto] md:items-center"
                  key={member.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar size="sm" user={member} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {member.displayName || member.email}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </div>
                    </div>
                  </div>
                  <Select
                    disabled={!canUpdateMember || busy || roles.length === 0}
                    onValueChange={(roleId) =>
                      setDrafts((current) => ({
                        ...current,
                        [member.id]: { ...draft, roleId },
                      }))
                    }
                    value={draft.roleId}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr("未分配")}</SelectItem>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.displayName ?? role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    disabled={!canUpdateMember || busy}
                    onValueChange={(status) =>
                      setDrafts((current) => ({
                        ...current,
                        [member.id]: {
                          ...draft,
                          status: status as "active" | "disabled",
                        },
                      }))
                    }
                    value={draft.status}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">{tr("启用")}</SelectItem>
                      <SelectItem value="disabled">{tr("禁用")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end gap-1">
                    <Button
                      disabled={!canUpdateMember || !dirty || busy}
                      onClick={() => saveMember(member)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {tr("保存")}
                    </Button>
                    <Button
                      aria-label={`${tr("移除平台用户")} ${
                        member.displayName || member.email
                      }`}
                      disabled={!canRemoveMember || busy}
                      onClick={() => setMemberToRemove(member)}
                      size="icon"
                      title={
                        !canRemoveMember
                          ? tr("当前账号无权移除平台用户")
                          : `${tr("移除平台用户")} ${
                              member.displayName || member.email
                            }`
                      }
                      type="button"
                      variant="ghost"
                    >
                      <AppIcon className="size-4" name="trash" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <AddPlatformMemberDialog
        onChanged={async () => {
          await load();
          await onChanged?.();
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        roles={roles}
      />
      <ConfirmActionDialog
        confirmLabel={tr("移除")}
        description={
          memberToRemove
            ? `${tr("将移除平台用户")} ${
                memberToRemove.displayName || memberToRemove.email
              } (${memberToRemove.email})`
            : ""
        }
        onConfirm={() => {
          if (memberToRemove) void removeMember(memberToRemove);
          setMemberToRemove(null);
        }}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
        open={Boolean(memberToRemove)}
        pending={Boolean(memberToRemove && savingMemberId === memberToRemove.id)}
        title={tr("移除平台用户")}
      />
    </Card>
  );
}

function AddPlatformMemberDialog({
  onChanged,
  onOpenChange,
  open,
  roles,
}: {
  onChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  roles: Role[];
}) {
  const tr = useTextTranslation();
  const [email, setEmail] = useState("");
  const [expiresIn, setExpiresIn] = useState<"3d" | "7d" | "never">("7d");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoleId((current) => current || roles[0]?.id || "");
  }, [open, roles]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !roleId) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await createPlatformMember(token, {
        email: email.trim(),
        expiresIn,
        roleId,
      });
      setEmail("");
      setExpiresIn("7d");
      onOpenChange(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("添加失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("添加平台用户")}</DialogTitle>
          <DialogDescription>
            {tr("已有账号将直接获得平台角色；新邮箱将收到创建账号的邀请。")}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="platform-member-email">{tr("邮箱")}</Label>
              <Input
                autoComplete="email"
                id="platform-member-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
                required
                type="email"
                value={email}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="platform-member-role">{tr("平台角色")}</Label>
              <Select onValueChange={setRoleId} value={roleId}>
                <SelectTrigger id="platform-member-role">
                  <SelectValue placeholder={tr("选择平台角色")} />
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
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="platform-member-expiry">{tr("邀请有效期")}</Label>
              <Select
                onValueChange={(value) => setExpiresIn(value as typeof expiresIn)}
                value={expiresIn}
              >
                <SelectTrigger id="platform-member-expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3d">{tr("3 天")}</SelectItem>
                  <SelectItem value="7d">{tr("7 天")}</SelectItem>
                  <SelectItem value="never">{tr("长期有效")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={saving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {tr("取消")}
            </Button>
            <Button
              disabled={
                saving ||
                !email.trim() ||
                !roleId
              }
              type="submit"
            >
              {saving ? tr("添加中...") : tr("添加")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
