"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createGroup,
  deleteGroup,
  getSnapshot,
  listGroups,
  updateGroup,
  updateGroupMembers,
  type GroupDto,
  type User,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [token, setToken] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    setError(null);
    try {
      const [groupItems, snapshot] = await Promise.all([
        listGroups(session.token),
        getSnapshot(session.token),
      ]);
      setGroups(groupItems);
      setUsers(snapshot.users);
      setSelectedGroupId((current) => current ?? groupItems[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedGroup) {
      setName("");
      setDescription("");
      setMemberIds([]);
      return;
    }
    setName(selectedGroup.name);
    setDescription(selectedGroup.description ?? "");
    setMemberIds(selectedGroup.memberIds);
  }, [selectedGroup]);

  async function saveDetails() {
    if (!selectedGroup) return;
    setSaving(true);
    setError(null);
    try {
      await updateGroup(token, selectedGroup.id, {
        name: name.trim(),
        description: description.trim() || null,
      });
      await updateGroupMembers(token, selectedGroup.id, memberIds);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!selectedGroup) return;
    setSaving(true);
    setError(null);
    try {
      await deleteGroup(token, selectedGroup.id);
      setSelectedGroupId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleMember(userId: string) {
    setMemberIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  if (error && !groups.length) return <div className="flex items-center justify-center py-16"><div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div></div>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>用户组</CardTitle>
        <Dialog onOpenChange={setCreateOpen} open={createOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <AppIcon className="size-3.5" name="layers" />
              添加用户组
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>添加用户组</DialogTitle></DialogHeader>
            <CreateGroupForm
              token={token}
              onDone={(group) => {
                setCreateOpen(false);
                setSelectedGroupId(group.id);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-md border">
            {groups.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无用户组</div>
            ) : groups.map((group) => (
              <Button
                className={cn(
                  "h-auto w-full justify-between rounded-none border-b px-4 py-3 text-left last:border-b-0",
                  group.id === selectedGroupId && "bg-muted text-foreground",
                )}
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
                variant="ghost"
              >
                <span>
                  <span className="block font-medium">{group.name}</span>
                  <span className="text-xs text-muted-foreground">{group.description || "无描述"}</span>
                </span>
                <Badge variant="secondary">{group.memberCount}</Badge>
              </Button>
            ))}
          </div>

          {selectedGroup ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>名称</Label>
                  <Input onChange={(event) => setName(event.target.value)} value={name} />
                </div>
                <div className="grid gap-2">
                  <Label>创建时间</Label>
                  <Input disabled value={new Date(selectedGroup.createdAt).toLocaleString("zh-CN")} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>描述</Label>
                <Textarea onChange={(event) => setDescription(event.target.value)} value={description} />
              </div>
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">成员</div>
                    <div className="text-xs text-muted-foreground">仅显示当前组织内用户</div>
                  </div>
                  <Badge variant="outline">{memberIds.length} 人</Badge>
                </div>
                <div className="max-h-[420px] divide-y overflow-auto">
                  {users.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无可选用户</div>
                  ) : users.map((user) => (
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50" key={user.id}>
                      <Checkbox checked={memberIds.includes(user.id)} onCheckedChange={() => toggleMember(user.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{user.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                      </span>
                      <Badge variant={user.status === "active" ? "default" : "secondary"}>{user.status === "active" ? "启用" : "禁用"}</Badge>
                    </label>
                  ))}
                </div>
              </div>
              {error && <div className="text-sm text-destructive">{error}</div>}
              <div className="flex items-center justify-end gap-2">
                <Button disabled={saving} onClick={() => void removeSelected()} variant="outline">删除用户组</Button>
                <Button disabled={saving || !name.trim()} onClick={() => void saveDetails()}>{saving ? "保存中..." : "保存"}</Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-80 items-center justify-center rounded-md border text-sm text-muted-foreground">选择或创建一个用户组</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateGroupForm({ token, onDone }: { token: string; onDone: (group: GroupDto) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const group = await createGroup(token, {
        name: name.trim(),
        description: description.trim() || null,
      });
      onDone(group);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2"><Label>名称</Label><Input onChange={(e) => setName(e.target.value)} value={name} /></div>
      <div className="grid gap-2"><Label>描述</Label><Textarea onChange={(e) => setDescription(e.target.value)} value={description} /></div>
      {msg && <div className="text-sm text-destructive">{msg}</div>}
      <Button disabled={saving || !name.trim()} onClick={submit}>{saving ? "创建中..." : "创建用户组"}</Button>
    </div>
  );
}
