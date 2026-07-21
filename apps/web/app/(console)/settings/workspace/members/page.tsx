"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  listWorkspaceMembers,
  listWorkspaceRoles,
  removeWorkspaceMember,
  replaceWorkspaceMemberRole,
  updateWorkspaceMemberStatus,
  type Role,
  type WorkspaceMember,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";

export default function MembersPage() {
  const tr = useTextTranslation();
  const access = usePermission();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);

  const canInvite = access.hasPermission("invite.workspace_invite.create:workspace");
  const canAssign = access.hasPermission("membership.workspace_member.replace_role:workspace");
  const canUpdateStatus = access.hasPermission("membership.workspace_member.update_status:workspace");
  const canRemove = access.hasPermission("membership.workspace_member.remove:workspace");

  const load = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    try {
      const [nextMembers, nextRoles] = await Promise.all([
        listWorkspaceMembers(session),
        listWorkspaceRoles(session),
      ]);
      setMembers(nextMembers);
      setRoles(nextRoles);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : tr("成员加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter(({ account }) =>
      [account.displayName, account.email, account.username]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [members, search]);

  async function changeRole(member: WorkspaceMember, roleId: string) {
    setSavingId(member.membershipId);
    setError(null);
    try {
      await replaceWorkspaceMemberRole(
        await requireAuthenticatedAdminSessionMarker(),
        member.membershipId,
        roleId,
      );
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tr("保存失败"));
    } finally {
      setSavingId(null);
    }
  }

  async function toggleStatus(member: WorkspaceMember) {
    setSavingId(member.membershipId);
    setError(null);
    try {
      await updateWorkspaceMemberStatus(
        await requireAuthenticatedAdminSessionMarker(),
        member.membershipId,
        member.status === "active" ? "disabled" : "active",
        member.role?.id,
      );
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tr("保存失败"));
    } finally {
      setSavingId(null);
    }
  }

  async function removeMember() {
    if (!memberToRemove) return;
    setSavingId(memberToRemove.membershipId);
    setError(null);
    try {
      await removeWorkspaceMember(
        await requireAuthenticatedAdminSessionMarker(),
        memberToRemove.membershipId,
      );
      setMemberToRemove(null);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : tr("移除失败"));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{tr("加载中...")}</div>;
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("成员")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr("管理当前工作空间的成员关系、状态和角色。账号资料与密码由成员本人统一管理。")}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Input
            className="w-full sm:w-72"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("搜索成员...")}
            value={search}
          />
          {canInvite && (
            <Button asChild>
              <Link href="/settings/invites">{tr("邀请成员")}</Link>
            </Button>
          )}
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("成员")}</TableHead>
                <TableHead>{tr("成员关系状态")}</TableHead>
                <TableHead>{tr("工作空间角色")}</TableHead>
                <TableHead className="w-48 text-right">{tr("操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => {
                const protectedOwner =
                  member.role?.name === "workspace-owner" &&
                  member.status === "active";
                return (
                  <TableRow key={member.membershipId}>
                    <TableCell>
                      <div className="font-medium">{member.account.displayName}</div>
                      <div className="text-xs text-muted-foreground">{member.account.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.status === "active" ? "default" : "secondary"}>
                        {member.status === "active"
                          ? tr("启用")
                          : member.status === "disabled"
                            ? tr("停用")
                            : tr("已移除")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {member.status === "removed" ? (
                        <span className="text-sm text-muted-foreground">{tr("等待重新邀请")}</span>
                      ) : (
                        <Select
                          disabled={!canAssign || savingId === member.membershipId}
                          onValueChange={(roleId) => void changeRole(member, roleId)}
                          value={member.role?.id}
                        >
                          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roles.map((role) => (
                              <SelectItem
                                disabled={protectedOwner && role.name !== "workspace-owner"}
                                key={role.id}
                                value={role.id}
                              >
                                {role.displayName ?? role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {member.status !== "removed" && (
                          <Button
                            disabled={!canUpdateStatus || protectedOwner || savingId === member.membershipId}
                            onClick={() => void toggleStatus(member)}
                            size="sm"
                            variant="ghost"
                          >
                            {member.status === "active" ? tr("停用") : tr("恢复")}
                          </Button>
                        )}
                        <Button
                          disabled={!canRemove || protectedOwner || member.status === "removed"}
                          onClick={() => setMemberToRemove(member)}
                          size="sm"
                          variant="ghost"
                        >
                          {tr("移除")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={4}>
                    {tr("暂无成员")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmActionDialog
        confirmLabel={tr("移除")}
        description={tr("只会移除当前工作空间成员关系；全局账号及其在其他工作空间的访问不会受到影响。")}
        onConfirm={() => void removeMember()}
        onOpenChange={(open) => {
          if (!open && !savingId) setMemberToRemove(null);
        }}
        open={Boolean(memberToRemove)}
        pending={Boolean(savingId)}
        title={tr("移除成员？")}
      />
    </section>
  );
}
