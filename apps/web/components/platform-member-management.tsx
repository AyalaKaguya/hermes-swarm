"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { AppIcon } from "@/components/app-icon";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
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
  searchUsers,
  updatePlatformMember,
  type PlatformMember,
  type Role,
  type User,
} from "@/lib/admin-api";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type PlatformMemberManagementProps = {
  canCreateMember?: boolean;
  canRemoveMember?: boolean;
  canSearchUsers?: boolean;
  canUpdateMember?: boolean;
  canViewMembers?: boolean;
  canViewRoles?: boolean;
  onChanged?: () => Promise<void> | void;
};

type MemberDraft = {
  roleId: string;
  status: PlatformMember["status"];
};

export function PlatformMemberManagement({
  canCreateMember,
  canRemoveMember,
  canSearchUsers,
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
  const [roles, setRoles] = useState<Role[]>([]);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.accessToken || !canViewMembers) {
      setLoading(false);
      return;
    }

    setToken(session.accessToken);
    setLoading(true);
    try {
      const [memberItems, roleItems] = await Promise.all([
        listPlatformMembers(session.accessToken),
        canViewRoles ? listPlatformRoles(session.accessToken) : Promise.resolve([]),
      ]);
      setMembers(memberItems);
      setRoles(roleItems);
      setDrafts(
        Object.fromEntries(
          memberItems.map((member) => [
            member.id,
            {
              roleId: member.roleId ?? "none",
              status: member.status,
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

  const memberUserIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );
  const canOpenCreate = Boolean(
    canCreateMember && canSearchUsers && canViewRoles && roles.length > 0,
  );

  async function saveMember(member: PlatformMember) {
    if (!token || !canUpdateMember) return;
    const draft = drafts[member.id];
    if (!draft) return;

    setSavingMemberId(member.id);
    setError(null);
    try {
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
    if (!token || !canRemoveMember) return;
    setSavingMemberId(member.id);
    setError(null);
    try {
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
            {tr("为已有用户授予平台角色，控制其可使用的平台能力")}
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
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        {!canOpenCreate && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {tr(
              "添加平台用户需要拥有用户搜索、平台成员添加和平台角色查看权限，并至少存在一个平台角色。",
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
                status: member.status,
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
                    <UserAvatar size="sm" user={member.user} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {member.displayName || member.user.displayName}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.user.email}
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
                          status: status as PlatformMember["status"],
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
                      disabled={!canRemoveMember || busy}
                      onClick={() => removeMember(member)}
                      size="icon"
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
        memberUserIds={memberUserIds}
        onChanged={async () => {
          await load();
          await onChanged?.();
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        roles={roles}
        token={token}
      />
    </Card>
  );
}

function AddPlatformMemberDialog({
  memberUserIds,
  onChanged,
  onOpenChange,
  open,
  roles,
  token,
}: {
  memberUserIds: Set<string>;
  onChanged: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  roles: Role[];
  token: string;
}) {
  const tr = useTextTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [status, setStatus] = useState<PlatformMember["status"]>("active");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoleId((current) => current || roles[0]?.id || "");
  }, [open, roles]);

  useEffect(() => {
    if (!open || !token) return;
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      searchUsers(token, normalized)
        .then((items) => {
          setResults(items);
          setError(null);
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : tr("搜索失败")),
        )
        .finally(() => setSearching(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [open, query, token, tr]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedUser || !roleId) return;

    setSaving(true);
    setError(null);
    try {
      await createPlatformMember(token, {
        roleId,
        status,
        userId: selectedUser.id,
      });
      setQuery("");
      setResults([]);
      setSelectedUser(null);
      setStatus("active");
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
            {tr("搜索已有用户，并为其分配一个平台角色。")}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="platform-member-search">{tr("搜索用户")}</Label>
            <Input
              autoComplete="off"
              id="platform-member-search"
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedUser(null);
              }}
              placeholder={tr("输入邮箱、名称或手机号")}
              value={query}
            />
            <div className="grid max-h-64 gap-1 overflow-auto rounded-md border bg-background p-1">
              {selectedUser ? (
                <UserOption
                  selected
                  user={selectedUser}
                  onClick={() => setSelectedUser(null)}
                />
              ) : query.trim().length < 2 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {tr("至少输入 2 个字符开始搜索")}
                </div>
              ) : searching ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {tr("搜索中...")}
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {tr("没有匹配的用户")}
                </div>
              ) : (
                results.map((user) => {
                  const alreadyMember = memberUserIds.has(user.id);
                  return (
                    <UserOption
                      disabled={alreadyMember}
                      key={user.id}
                      selected={false}
                      user={user}
                      onClick={() => {
                        if (!alreadyMember) setSelectedUser(user);
                      }}
                    />
                  );
                })
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="grid gap-2">
              <Label htmlFor="platform-member-status">{tr("状态")}</Label>
              <Select
                onValueChange={(value) =>
                  setStatus(value as PlatformMember["status"])
                }
                value={status}
              >
                <SelectTrigger id="platform-member-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{tr("启用")}</SelectItem>
                  <SelectItem value="disabled">{tr("禁用")}</SelectItem>
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
            <Button disabled={saving || !selectedUser || !roleId} type="submit">
              {saving ? tr("添加中...") : tr("添加")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserOption({
  disabled,
  onClick,
  selected,
  user,
}: {
  disabled?: boolean;
  onClick: () => void;
  selected: boolean;
  user: User;
}) {
  const tr = useTextTranslation();

  return (
    <button
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors",
        selected
          ? "bg-primary/10"
          : "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-3">
        <UserAvatar size="sm" user={user} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {user.displayName}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {user.email}
          </span>
        </span>
      </span>
      {disabled ? (
        <Badge variant="secondary">{tr("已添加")}</Badge>
      ) : selected ? (
        <Badge variant="outline">{tr("已选择")}</Badge>
      ) : null}
    </button>
  );
}
