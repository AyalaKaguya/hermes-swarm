"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { AppShell } from "@/components/app-shell";
import type { AppShellNavItem } from "@/components/app-shell";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings-navigation";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteInvite, getInvites, getSnapshot, resendInvite } from "@/lib/admin-api";
import type { Invite, Role, Snapshot, User } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export function OrganizationUserManagement() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [activeTab, setActiveTab] = useState<"users" | "invites">("users");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSnapshot() {
      setLoading(true);
      setError("");

      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setSessionToken(session.token);

      try {
        const [data, inviteItems] = await Promise.all([
          getSnapshot(session.token),
          getInvites(session.token),
        ]);
        const nextResolvedSession = resolveSession(data);
        setSnapshot(data);
        setInvites(inviteItems);
        setResolvedSession(nextResolvedSession);
      } catch (loadError) {
        const message = getErrorMessage(loadError);
        if (message.includes("登录") || message.includes("401")) {
          clearStoredSession();
          router.replace("/login");
          return;
        }
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    void loadSnapshot();
  }, [router]);

  const organization = snapshot?.organization ?? resolvedSession?.organization;
  const roles = snapshot?.roles ?? [];
  const allUsers = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.users.filter(
      (user) => user.organizationId === resolvedSession?.organization.id,
    );
  }, [resolvedSession?.organization.id, snapshot]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allUsers.filter((user) => {
      const role = roles.find((item) => item.id === user.roleId);
      if (roleFilter && role?.name !== roleFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        user.displayName,
        user.email,
        user.username,
        user.firstName,
        user.lastName,
        role?.label,
        role?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [allUsers, roleFilter, roles, search]);

  useEffect(() => {
    if (!filteredUsers.length) {
      setSelectedUserId("");
      return;
    }

    setSelectedUserId((current) =>
      filteredUsers.some((user) => user.id === current)
        ? current
        : filteredUsers[0]?.id ?? "",
    );
  }, [filteredUsers]);

  const navSections = SETTINGS_NAV_SECTIONS;

  function logout() {
    clearStoredSession();
    router.replace("/login");
  }

  function navigateToMenu(item: AppShellNavItem) {
    const tabMap: Partial<Record<string, typeof activeTab>> = {
      users: "users",
      invites: "invites",
    };
    const tab = tabMap[item.key];
    if (tab) {
      setActiveTab(tab);
    }

    if (item.key !== "users") {
      router.push(item.href);
    }
  }

  async function handleResendInvite(inviteId: string) {
    if (!sessionToken) return;
    setError("");
    try {
      const updatedInvite = await resendInvite(sessionToken, inviteId);
      setInvites((current) =>
        current.map((invite) => (invite.id === inviteId ? updatedInvite : invite)),
      );
    } catch (inviteError) {
      setError(getErrorMessage(inviteError));
    }
  }

  async function handleDeleteInvite(inviteId: string, email: string) {
    if (!sessionToken) return;
    if (!window.confirm("删除 " + email + " 的邀请？")) return;
    setError("");
    try {
      await deleteInvite(sessionToken, inviteId);
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
    } catch (inviteError) {
      setError(getErrorMessage(inviteError));
    }
  }

  return (
    <AppShell
      actions={
        <Button className="w-full justify-start" onClick={logout} type="button" variant="ghost">
          <AppIcon className="size-4" name="logout" />
          退出
        </Button>
      }
      activeItem="users"
      navSections={navSections}
      onNavigate={navigateToMenu}
      organizationName={organization?.name}
      user={resolvedSession?.user}
    >
      <section className="grid gap-5">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">管理用户</h1>
          </div>
          <Button type="button" variant="outline">
            <AppIcon className="size-4" name="invite" />
            <span>邀请</span>
          </Button>
        </header>

        <Tabs
          onValueChange={(value) => setActiveTab(value as typeof activeTab)}
          value={activeTab}
        >
          <TabsList variant="line">
            <TabsTrigger value="users">
              <AppIcon className="size-4" name="users" />
              用户
            </TabsTrigger>
            <TabsTrigger value="invites">
              <AppIcon className="size-4" name="invite" />
              邀请
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {error && (
          <div className="grid min-h-14 place-items-center rounded-lg border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="grid min-h-28 place-items-center rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            加载中
          </div>
        )}

        {!loading && activeTab === "users" && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative block w-full max-w-sm">
                <AppIcon className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" name="search" />
                <Input
                  aria-label="搜索"
                  className="pl-8"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索"
                  value={search}
                />
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">角色:</span>
                <Select
                  onValueChange={(value) => setRoleFilter(value === "all" ? "" : value)}
                  value={roleFilter || "all"}
                >
                  <SelectTrigger aria-label="选择角色" className="w-56">
                    <SelectValue placeholder="选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">选择角色</SelectItem>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.name}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <section className="grid grid-cols-[repeat(auto-fit,minmax(20rem,25rem))] gap-4">
              {filteredUsers.map((user) => (
                <Card
                  key={user.id}
                  className={cn(
                    "cursor-pointer gap-3 rounded-lg border p-4 shadow-xs transition-colors hover:bg-muted/40",
                    user.id === selectedUserId && "border-foreground/30 bg-muted/30",
                  )}
                  onClick={() => setSelectedUserId(user.id)}
                >
                  <UserCard
                    role={getRoleById(roles, user.roleId)}
                    user={user}
                  />
                </Card>
              ))}
              {!filteredUsers.length && (
                <div className="grid min-h-28 place-items-center rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
                  暂无用户
                </div>
              )}
            </section>
          </>
        )}

        {!loading && activeTab === "invites" && (
          <InviteTable
            invites={invites}
            onDelete={handleDeleteInvite}
            onResend={handleResendInvite}
            roles={roles}
            users={snapshot?.users ?? []}
          />
        )}

      </section>
    </AppShell>
  );
}

function InviteTable({
  invites,
  onDelete,
  onResend,
  roles,
  users,
}: {
  invites: Invite[];
  onDelete: (inviteId: string, email: string) => void;
  onResend: (inviteId: string) => void;
  roles: Role[];
  users: User[];
}) {
  if (!invites.length) {
    return (
      <div className="grid min-h-28 place-items-center rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
        暂无邀请
      </div>
    );
  }

  return (
    <Card className="rounded-lg p-0" aria-label="邀请列表">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>邮箱</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>邀请人</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead>过期时间</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.map((invite) => {
            const role = getRoleById(roles, invite.roleId);
            const invitedBy = users.find((user) => user.id === invite.invitedById) ?? null;
            return (
              <TableRow key={invite.id}>
                <TableCell>{invite.email}</TableCell>
                <TableCell>{role?.name ?? "无角色"}</TableCell>
                <TableCell>
                  {invitedBy ? (
                    <span className="flex items-center gap-2">
                      <UserAvatar size="sm" user={invitedBy} />
                      <span className="grid min-w-0 leading-tight">
                        <strong className="truncate text-sm font-medium">{invitedBy.displayName}</strong>
                        <small className="truncate text-xs text-muted-foreground">{invitedBy.email}</small>
                      </span>
                    </span>
                  ) : (
                    "系统"
                  )}
                </TableCell>
                <TableCell>{formatDate(invite.createdAt)}</TableCell>
                <TableCell>{formatDate(invite.expireDate) || "永不过期"}</TableCell>
                <TableCell>
                  <Badge className="gap-1.5" variant="outline">
                    <span
                      aria-hidden="true"
                      className={cn("size-1.5 rounded-full", inviteStatusDotClass(invite.status))}
                    />
                    {inviteStatusText(invite.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button onClick={() => onResend(invite.id)} size="icon-sm" title="重新发送" type="button" variant="ghost">
                      <AppIcon className="size-4" name="refresh" />
                    </Button>
                    <Button onClick={() => onDelete(invite.id, invite.email)} size="icon-sm" title="删除" type="button" variant="ghost">
                      <AppIcon className="size-4" name="trash" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function UserCard({
  role,
  user,
}: {
  role: Role | null;
  user: User;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <UserAvatar size="md" user={user} />
        <div className="grid min-w-0 leading-tight">
          <strong className="truncate text-sm font-medium">{user.displayName}</strong>
          <span className="truncate text-sm text-muted-foreground">{user.email}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">角色:</span>
        {role ? (
          <Badge className={roleBadgeClass(role.name)} variant="outline">
            {role.name.toUpperCase()}
          </Badge>
        ) : (
          <Badge className={roleBadgeClass(null)} variant="outline">
            无角色
          </Badge>
        )}
      </div>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
            <Button size="icon-sm" type="button" variant="ghost">
              <AppIcon className="size-4" name="more" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem>
              <AppIcon className="size-4" name="pencil" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              <AppIcon className="size-4" name="trash" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

function roleBadgeClass(roleName: string | undefined | null): string {
  if (!roleName) return "border-dashed text-muted-foreground";
  if (roleName === "super_admin") return "border-destructive/20 text-destructive";
  if (roleName === "admin") return "border-amber-500/30 text-amber-700";
  if (roleName === "viewer") return "text-muted-foreground";
  return "";
}

function inviteStatusDotClass(status: Invite["status"]) {
  if (status === "accepted") return "bg-emerald-500";
  if (status === "expired" || status === "revoked") return "bg-destructive";
  return "bg-amber-500";
}

function getRoleById(roles: Role[], roleId: string | null) {
  return roles.find((role) => role.id === roleId) ?? null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function inviteStatusText(status: Invite["status"]) {
  const labels: Record<Invite["status"], string> = {
    accepted: "已接受",
    expired: "已过期",
    invited: "已邀请",
    revoked: "已撤销",
  };
  return labels[status] ?? status;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
