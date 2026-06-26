"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import {
  createInvites,
  createUser,
  deleteInvite,
  getInvites,
  getSnapshot,
  resendInvite,
  updateManagedUser,
  type Invite,
  type Role,
  type User,
  type UserStatus,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

function statusVariant(status: string) {
  return status === "active" ? "default" : "secondary";
}

function inviteStatusText(status: string) {
  const labels: Record<string, string> = {
    accepted: "已接受",
    expired: "已过期",
    invited: "已邀请",
    revoked: "已撤销",
  };
  return labels[status] ?? status;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    setError(null);
    try {
      const [snap, inviteItems] = await Promise.all([
        getSnapshot(session.token),
        getInvites(session.token),
      ]);
      setUsers(snap.users);
      setRoles(snap.roles);
      setInvites(inviteItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((user) =>
        user.displayName.toLowerCase().includes(q) ||
        user.email?.toLowerCase().includes(q) ||
        user.username?.toLowerCase().includes(q)
      );
    }
    if (roleFilter !== "all") {
      list = list.filter((user) => user.roleId === roleFilter);
    }
    return list;
  }, [users, search, roleFilter]);

  async function resend(inviteId: string) {
    try {
      await resendInvite(token, inviteId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重发失败");
    }
  }

  async function removeInvite(inviteId: string) {
    try {
      await deleteInvite(token, inviteId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="flex items-center justify-center py-16"><div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div></div>;

  return (
    <Tabs className="gap-4" defaultValue="users">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="users">用户</TabsTrigger>
          <TabsTrigger value="invites">邀请</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <Dialog onOpenChange={setInviteOpen} open={inviteOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <AppIcon className="size-3.5" name="invite" />
                邀请用户
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>邀请用户</DialogTitle></DialogHeader>
              <InviteUsersForm
                roles={roles}
                token={token}
                onDone={() => {
                  setInviteOpen(false);
                  void load();
                }}
              />
            </DialogContent>
          </Dialog>
          <Dialog onOpenChange={setCreateOpen} open={createOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <AppIcon className="size-3.5" name="users" />
                添加用户
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>添加用户</DialogTitle></DialogHeader>
              <CreateUserForm
                roles={roles}
                token={token}
                onDone={() => {
                  setCreateOpen(false);
                  void load();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <TabsContent value="users">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>用户管理</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-56"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索名称、邮箱..."
                value={search}
              />
              <Select onValueChange={setRoleFilter} value={roleFilter}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder="角色筛选" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部角色</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-56">用户</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-muted-foreground" colSpan={5}>暂无用户</TableCell>
                  </TableRow>
                ) : filteredUsers.map((user) => {
                  const role = roles.find((item) => item.id === user.roleId);
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <UserAvatar size="sm" user={user} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{user.displayName}</div>
                            {user.username && <div className="truncate text-xs text-muted-foreground">@{user.username}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell>
                        <Badge className="text-xs" variant="outline">{role?.label ?? "-"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className="text-xs" variant={statusVariant(user.status)}>{user.status === "active" ? "启用" : "禁用"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button onClick={() => setEditUser(user)} size="sm" variant="ghost">编辑</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="invites">
        <Card>
          <CardHeader>
            <CardTitle>邀请记录</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>邀请时间</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-muted-foreground" colSpan={5}>暂无邀请</TableCell>
                  </TableRow>
                ) : invites.map((invite) => {
                  const role = roles.find((item) => item.id === invite.roleId);
                  return (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell><Badge variant="outline">{role?.label ?? "-"}</Badge></TableCell>
                      <TableCell><Badge variant={invite.status === "invited" ? "default" : "secondary"}>{inviteStatusText(invite.status)}</Badge></TableCell>
                      <TableCell className="text-sm">{new Date(invite.createdAt).toLocaleString("zh-CN")}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button disabled={invite.status !== "invited"} onClick={() => void resend(invite.id)} size="sm" variant="ghost">重发</Button>
                          <Button onClick={() => void removeInvite(invite.id)} size="sm" variant="ghost">删除</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {editUser && (
        <Dialog onOpenChange={(open) => { if (!open) setEditUser(null); }} open={true}>
          <DialogContent>
            <DialogHeader><DialogTitle>编辑用户</DialogTitle></DialogHeader>
            <EditUserForm
              roles={roles}
              token={token}
              user={editUser}
              onDone={() => {
                setEditUser(null);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </Tabs>
  );
}

function CreateUserForm({ roles, token, onDone }: { roles: Role[]; token: string; onDone: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "none");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      await createUser(token, {
        displayName,
        email,
        password,
        roleId: roleId === "none" ? null : roleId,
      });
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2"><Label>名称</Label><Input onChange={(e) => setDisplayName(e.target.value)} value={displayName} /></div>
      <div className="grid gap-2"><Label>邮箱</Label><Input onChange={(e) => setEmail(e.target.value)} type="email" value={email} /></div>
      <div className="grid gap-2"><Label>密码</Label><Input onChange={(e) => setPassword(e.target.value)} type="password" value={password} /></div>
      <div className="grid gap-2">
        <Label>角色</Label>
        <Select onValueChange={setRoleId} value={roleId}>
          <SelectTrigger><SelectValue placeholder="选择角色" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未分配</SelectItem>
            {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {msg && <div className="text-sm text-destructive">{msg}</div>}
      <Button disabled={saving || !displayName || !email || !password} onClick={submit}>{saving ? "创建中..." : "创建用户"}</Button>
    </div>
  );
}

function InviteUsersForm({ roles, token, onDone }: { roles: Role[]; token: string; onDone: () => void }) {
  const [emails, setEmails] = useState("");
  const [roleId, setRoleId] = useState("none");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const emailIds = emails
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const result = await createInvites(token, {
        emailIds,
        roleId: roleId === "none" ? undefined : roleId,
      });
      setMsg(`已创建 ${result.total} 个邀请，忽略 ${result.ignored} 个重复地址`);
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "邀请失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label>邮箱</Label>
        <Textarea
          className="min-h-28"
          onChange={(e) => setEmails(e.target.value)}
          placeholder="每行一个邮箱，或用逗号分隔"
          value={emails}
        />
      </div>
      <div className="grid gap-2">
        <Label>角色</Label>
        <Select onValueChange={setRoleId} value={roleId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">暂不指定</SelectItem>
            {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      <Button disabled={saving || !emails.trim()} onClick={submit}>{saving ? "邀请中..." : "发送邀请"}</Button>
    </div>
  );
}

function EditUserForm({ roles, token, user, onDone }: { roles: Role[]; token: string; user: User; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [roleId, setRoleId] = useState(user.roleId ?? "none");
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      await updateManagedUser(token, user.id, {
        displayName,
        email,
        roleId: roleId === "none" ? null : roleId,
        status,
      });
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2"><Label>名称</Label><Input onChange={(e) => setDisplayName(e.target.value)} value={displayName} /></div>
      <div className="grid gap-2"><Label>邮箱</Label><Input onChange={(e) => setEmail(e.target.value)} type="email" value={email} /></div>
      <div className="grid gap-2">
        <Label>角色</Label>
        <Select onValueChange={setRoleId} value={roleId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">未分配</SelectItem>
            {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>状态</Label>
        <Select onValueChange={(value) => setStatus(value as UserStatus)} value={status}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">启用</SelectItem>
            <SelectItem value="disabled">禁用</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {msg && <div className="text-sm text-destructive">{msg}</div>}
      <Button disabled={saving} onClick={submit}>{saving ? "保存中..." : "保存"}</Button>
    </div>
  );
}
