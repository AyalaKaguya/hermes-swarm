"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  createOrganizationGroup,
  deleteOrganizationGroup,
  listOrganizationGroupMembers,
  listOrganizationGroups,
  listOrganizationMembers,
  replaceOrganizationGroupMembers,
  updateOrganizationGroup,
  type OrganizationGroup,
  type OrganizationGroupPayload,
  type OrganizationMembership,
} from "@/lib/admin-api";
import { usePermission } from "@/hooks/use-permission";
import { getStoredSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type GroupDialogState =
  | {
      group?: never;
      mode: "create";
    }
  | {
      group: OrganizationGroup;
      mode: "edit";
    };

type GroupForm = {
  color: string;
  description: string;
  displayName: string;
  name: string;
};

export default function GroupsPage() {
  const { resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const organizationId = snapshot?.organization?.id ?? null;
  const canManage =
    snapshot && resolvedSession
      ? access.hasPermission([
          "group.organization_group.create:organization",
          "group.organization_group.update_basic:organization",
          "group.organization_group.delete:organization",
          "group.organization_group.replace_members:organization",
        ])
      : false;

  const [groups, setGroups] = useState<OrganizationGroup[]>([]);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [persistedMemberIds, setPersistedMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroupForm());

  const token = getStoredSession()?.token ?? "";
  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const memberDirty = !sameSet(selectedMemberIds, persistedMemberIds);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [groupItems, memberItems] = await Promise.all([
        listOrganizationGroups(session.token, organizationId),
        listOrganizationMembers(session.token, organizationId),
      ]);
      setGroups(groupItems);
      setMemberships(memberItems);
      setSelectedGroupId((current) =>
        groupItems.some((group) => group.id === current)
          ? current
          : (groupItems[0]?.id ?? null),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const loadGroupMembers = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !organizationId || !selectedGroup) {
      setSelectedMemberIds(new Set());
      setPersistedMemberIds(new Set());
      return;
    }
    setLoadingMembers(true);
    setError(null);
    try {
      const items = await listOrganizationGroupMembers(
        session.token,
        organizationId,
        selectedGroup.id,
      );
      const next = new Set(items.map((item) => item.membershipId));
      setSelectedMemberIds(next);
      setPersistedMemberIds(new Set(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载成员失败");
    } finally {
      setLoadingMembers(false);
    }
  }, [organizationId, selectedGroup]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadGroupMembers();
  }, [loadGroupMembers]);

  const selectedMemberCount = selectedMemberIds.size;
  const sortedMemberships = useMemo(
    () =>
      [...memberships].sort((left, right) =>
        membershipLabel(left).localeCompare(membershipLabel(right)),
      ),
    [memberships],
  );

  function openGroupDialog(next: GroupDialogState) {
    setGroupDialog(next);
    setGroupForm(
      next.mode === "edit" ? groupToForm(next.group) : emptyGroupForm(),
    );
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupDialog || !organizationId || !token) return;
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      const payload: OrganizationGroupPayload = {
        color: nullableText(groupForm.color),
        description: nullableText(groupForm.description),
        displayName: groupForm.displayName.trim(),
        name: groupForm.name.trim() || undefined,
      };
      const saved =
        groupDialog.mode === "create"
          ? await createOrganizationGroup(token, organizationId, payload)
          : await updateOrganizationGroup(
              token,
              organizationId,
              groupDialog.group.id,
              payload,
            );
      setSelectedGroupId(saved.id);
      setGroupDialog(null);
      setMessage("保存成功");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(group: OrganizationGroup) {
    if (!organizationId || !token || !canManage) return;
    const confirmed = window.confirm(`删除用户组「${group.displayName}」？`);
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      await deleteOrganizationGroup(token, organizationId, group.id);
      setSelectedGroupId(null);
      setMessage("已删除用户组");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleMember(membershipId: string) {
    if (!canManage) return;
    setSelectedMemberIds((current) => {
      const next = new Set(current);
      if (next.has(membershipId)) {
        next.delete(membershipId);
      } else {
        next.add(membershipId);
      }
      return next;
    });
  }

  async function saveMembers() {
    if (!organizationId || !token || !selectedGroup) return;
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      await replaceOrganizationGroupMembers(
        token,
        organizationId,
        selectedGroup.id,
        [...selectedMemberIds],
      );
      setPersistedMemberIds(new Set(selectedMemberIds));
      setMessage("成员已更新");
      await load();
      await loadGroupMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存成员失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">用户组</h1>
          <p className="text-sm text-muted-foreground">
            管理组织内成员分组，便于协作和细分管理。
          </p>
        </div>
        <Button
          disabled={!canManage}
          onClick={() => openGroupDialog({ mode: "create" })}
          size="sm"
          type="button"
        >
          <AppIcon className="size-3.5" name="plus" />
          新建用户组
        </Button>
      </div>

      {message && !error && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(240px,320px)_1fr]">
        <Card className="min-w-0 self-start overflow-hidden shadow-none">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AppIcon className="size-4" name="users" />
              组织用户组
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {groups.length === 0 ? (
              <div className="grid gap-2 px-2 py-8 text-center">
                <div className="text-sm font-medium">暂无用户组</div>
                <div className="text-xs text-muted-foreground">
                  创建用户组后，可以按团队或职责维护成员集合。
                </div>
              </div>
            ) : (
              <div className="grid gap-1">
                {groups.map((group) => {
                  const selected = selectedGroup?.id === group.id;
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        selected
                          ? "border-primary/30 bg-primary/5"
                          : "border-transparent hover:border-border hover:bg-muted/60",
                      )}
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full border"
                          style={{ backgroundColor: group.color ?? undefined }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium leading-5">
                            {group.displayName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {group.name}
                          </span>
                        </span>
                      </span>
                      <Badge className="shrink-0 px-1.5 text-[11px]" variant="outline">
                        {group.memberCount}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden shadow-none">
          {selectedGroup ? (
            <>
              <CardHeader className="border-b px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
                      <span
                        className="size-2.5 shrink-0 rounded-full border"
                        style={{
                          backgroundColor: selectedGroup.color ?? undefined,
                        }}
                      />
                      <span className="truncate">
                        {selectedGroup.displayName}
                      </span>
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{selectedGroup.name}</span>
                      <span>{selectedMemberCount} 人已选择</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={!canManage || saving}
                      onClick={() =>
                        openGroupDialog({ group: selectedGroup, mode: "edit" })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      编辑
                    </Button>
                    <Button
                      disabled={!canManage || saving}
                      onClick={() => void removeGroup(selectedGroup)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      删除
                    </Button>
                    <Button
                      disabled={!canManage || saving || !memberDirty}
                      onClick={() => void saveMembers()}
                      size="sm"
                      type="button"
                    >
                      {saving ? "保存中..." : "保存成员"}
                    </Button>
                  </div>
                </div>
                {selectedGroup.description && (
                  <p className="pt-1 text-sm text-muted-foreground">
                    {selectedGroup.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {loadingMembers ? (
                  <div className="flex items-center justify-center py-16 text-sm">
                    成员加载中...
                  </div>
                ) : sortedMemberships.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                    当前组织暂无成员
                  </div>
                ) : (
                  <div className="divide-y">
                    {sortedMemberships.map((membership) => {
                      const checked = selectedMemberIds.has(membership.id);
                      return (
                        <label
                          className={cn(
                            "grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
                            !canManage && "cursor-default opacity-80",
                          )}
                          key={membership.id}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={!canManage}
                            onCheckedChange={() => toggleMember(membership.id)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {membershipLabel(membership)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {membership.user?.email ?? membership.userId}
                            </span>
                          </span>
                          <span className="flex min-w-0 max-w-48 flex-wrap justify-end gap-1">
                            {membership.role && (
                              <Badge variant="outline">
                                {membership.role.displayName ??
                                  membership.role.label}
                              </Badge>
                            )}
                            {membership.groups?.map((group) => (
                              <Badge key={group.id} variant="secondary">
                                {group.displayName}
                              </Badge>
                            ))}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </>
          ) : (
            <CardContent className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
              选择或创建一个用户组
            </CardContent>
          )}
        </Card>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !saving) setGroupDialog(null);
        }}
        open={Boolean(groupDialog)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {groupDialog?.mode === "edit" ? "编辑用户组" : "新建用户组"}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitGroup}>
            <div className="grid gap-2">
              <Label htmlFor="group-display-name">名称</Label>
              <Input
                id="group-display-name"
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                required
                value={groupForm.displayName}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-name">标识</Label>
              <Input
                id="group-name"
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="留空后根据名称生成"
                value={groupForm.name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-color">颜色</Label>
              <div className="flex items-center gap-2">
                <Input
                  className="h-9 w-14 p-1"
                  id="group-color"
                  onChange={(event) =>
                    setGroupForm((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                  type="color"
                  value={groupForm.color || "#0ea5e9"}
                />
                <Input
                  onChange={(event) =>
                    setGroupForm((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                  placeholder="#0ea5e9"
                  value={groupForm.color}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-description">描述</Label>
              <Textarea
                id="group-description"
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                value={groupForm.description}
              />
            </div>
            <DialogFooter>
              <Button
                disabled={saving}
                onClick={() => setGroupDialog(null)}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button disabled={saving || !groupForm.displayName.trim()}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function emptyGroupForm(): GroupForm {
  return {
    color: "#0ea5e9",
    description: "",
    displayName: "",
    name: "",
  };
}

function groupToForm(group: OrganizationGroup): GroupForm {
  return {
    color: group.color ?? "#0ea5e9",
    description: group.description ?? "",
    displayName: group.displayName,
    name: group.name,
  };
}

function membershipLabel(membership: OrganizationMembership) {
  return (
    membership.displayName ||
    membership.user?.displayName ||
    membership.user?.nickname ||
    membership.user?.email ||
    membership.userId
  );
}

function nullableText(value: string) {
  const text = value.trim();
  return text ? text : null;
}

function sameSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}
