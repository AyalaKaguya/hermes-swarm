"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { useNotifications } from "@/components/app-notifications";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  createOrganizationMember,
  deleteOrganizationMember,
  getOrganization,
  listOrganizationMemberCandidates,
  listOrganizationMembers,
  listOrganizationRoles,
  replaceOrganizationMemberRole,
  updateOrganization,
  type Organization,
  type OrganizationMemberCandidate,
  type OrganizationMembership,
  type Role,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";

type OrganizationForm = {
  name: string;
  parentOrganizationId: string;
  slug: string;
  status: "active" | "suspended";
};

export function OrganizationDetailPage({
  organizationId,
  section = "profile",
}: {
  organizationId?: string;
  section?: "members" | "profile";
}) {
  const tr = useTextTranslation();
  const access = usePermission();
  const notifications = useNotifications();
  const { refreshSnapshot } = useAdminShell();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [memberCandidates, setMemberCandidates] = useState<
    OrganizationMemberCandidate[]
  >([]);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [organizationRoles, setOrganizationRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<OrganizationForm>(emptyForm());
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMembership | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextOrganization = await getOrganization(session, organizationId);
      const [nextMemberships, nextRoles] = section === "members"
        ? await Promise.all([
            listOrganizationMembers(session, organizationId),
            listOrganizationRoles(session, organizationId),
          ])
        : [[], []];
      setOrganization(nextOrganization);
      setMemberships(nextMemberships);
      setOrganizationRoles(nextRoles);
      setForm(toForm(nextOrganization));
      setMemberRoleDrafts(
        Object.fromEntries(nextMemberships.map((item) => [item.id, item.role?.id ?? ""])),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("组织加载失败"));
    } finally {
      setLoading(false);
    }
  }, [organizationId, section, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const isRoot = Boolean(organization && !organization.parentOrganizationId);
  const canCreateMember = access.hasPermission(
    "user.organization_member.create:organization",
  );
  const canListCandidates = access.hasPermission(
    "user.organization_member.list_candidates:organization",
  );
  const canAddMember = canCreateMember && canListCandidates;

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const updated = await updateOrganization(session, organization.id, {
        name: form.name.trim(),
        slug: form.slug.trim(),
      });
      setOrganization(updated);
      setForm(toForm(updated));
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  function selectMemberRole(membershipId: string, roleId: string) {
    setMemberRoleDrafts((current) => {
      return {
        ...current,
        [membershipId]: roleId,
      };
    });
  }

  async function saveMemberRoles(membership: OrganizationMembership) {
    if (!organization) return;
    setSavingMemberId(membership.id);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await replaceOrganizationMemberRole(
        session,
        organization.id,
        membership.id,
        memberRoleDrafts[membership.id] ?? "",
      );
      await load();
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("成员角色保存失败"));
    } finally {
      setSavingMemberId(null);
    }
  }

  async function removeMember() {
    if (!organization || !memberToRemove) return;
    setSavingMemberId(memberToRemove.id);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await deleteOrganizationMember(session, organization.id, memberToRemove.id);
      setMemberToRemove(null);
      await load();
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("移除成员失败"));
    } finally {
      setSavingMemberId(null);
    }
  }

  async function openAddMember() {
    if (!organization || !canAddMember || organizationRoles.length === 0) {
      return;
    }
    setAddMemberOpen(true);
    setSelectedCandidateId("");
    setSelectedRoleId(
      organizationRoles.find((role) => role.name === "member")?.id ??
        organizationRoles[0]?.id ??
        "",
    );
    setMemberCandidates([]);
    setLoadingCandidates(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      setMemberCandidates(
        await listOrganizationMemberCandidates(session, organization.id),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function addMember() {
    if (!organization || !selectedCandidateId || !selectedRoleId) return;
    setAddingMember(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await createOrganizationMember(session, organization.id, {
        roleId: selectedRoleId,
        userId: selectedCandidateId,
      });
      setAddMemberOpen(false);
      notifications.success(tr("组织成员已添加"));
      await load();
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("添加成员失败"));
    } finally {
      setAddingMember(false);
    }
  }

  function changeAddMemberOpen(open: boolean) {
    if (!open && addingMember) return;
    setAddMemberOpen(open);
    if (!open) {
      setMemberCandidates([]);
      setSelectedCandidateId("");
      setSelectedRoleId("");
    }
  }

  if (!organizationId) {
    return <EmptyState text={tr("请先选择一个组织")} />;
  }
  if (loading) {
    return <EmptyState text={tr("加载中...")} />;
  }
  if (!organization) {
    return <EmptyState text={error ?? tr("组织不存在或无权访问")} />;
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{organization.name}</h1>
            {isRoot && <Badge variant="secondary">{tr("根组织")}</Badge>}
            <Badge variant={organization.status === "active" ? "default" : "outline"}>
              {organization.status === "active" ? tr("启用") : tr("停用")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.slug}
          </p>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {section === "profile" && <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("基本信息")}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={saveOrganization}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("名称")}>
                  <Input onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required value={form.name} />
                </Field>
                <Field label={tr("标识符")}>
                  <Input onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} required value={form.slug} />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button disabled={saving || !form.name.trim() || !form.slug.trim()} type="submit">
                  {saving ? tr("保存中...") : tr("保存")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

      </div>}

      {section === "members" && <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">{tr("成员与角色")} · {memberships.length}</CardTitle>
          {canAddMember && (
            <Button
              disabled={organizationRoles.length === 0}
              onClick={() => void openAddMember()}
              size="sm"
              type="button"
            >
              <AppIcon className="size-3.5" name="plus" />
              {tr("添加成员")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-2">
          {memberships.map((membership) => {
            const draft = memberRoleDrafts[membership.id] ?? "";
            const persisted = membership.role?.id ?? "";
            const dirty = draft !== persisted;
            return (
              <div className="grid gap-3 rounded-md border px-3 py-3 lg:grid-cols-[minmax(180px,.8fr)_minmax(0,1.5fr)_auto] lg:items-center" key={membership.id}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{membership.displayName || membership.user.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{membership.user.email}</div>
                </div>
                <div className="min-w-0">
                  {organizationRoles.length > 0 && (
                    <MemberRoleSelect
                      disabled={savingMemberId === membership.id}
                      onValueChange={(roleId) => selectMemberRole(membership.id, roleId)}
                      roles={organizationRoles}
                      value={draft}
                      roleLabel={tr("角色")}
                    />
                  )}
                  {organizationRoles.length === 0 && <span className="text-xs text-muted-foreground">{tr("请先在角色与权限中创建组织角色")}</span>}
                </div>
                <div className="flex justify-end gap-2">
                  <Button disabled={!dirty || savingMemberId === membership.id} onClick={() => void saveMemberRoles(membership)} size="sm" type="button" variant="outline">{tr("保存角色")}</Button>
                  <Button disabled={savingMemberId === membership.id} onClick={() => setMemberToRemove(membership)} size="sm" type="button" variant="ghost">{tr("移除")}</Button>
                </div>
              </div>
            );
          })}
          {memberships.length === 0 && <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">{tr("暂无成员")}</div>}
        </CardContent>
      </Card>}

      <Dialog onOpenChange={changeAddMemberOpen} open={addMemberOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("添加组织成员")}</DialogTitle>
            <DialogDescription>
              {tr("从工作空间已有用户中选择人员，并分配组织角色。")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>{tr("选择工作空间用户")}</Label>
              <Command className="rounded-lg border">
                <CommandInput placeholder={tr("搜索工作空间用户")} />
                <CommandList>
                  <CommandEmpty>
                    {loadingCandidates
                      ? tr("加载中...")
                      : tr("暂无可添加用户")}
                  </CommandEmpty>
                  <CommandGroup>
                    {memberCandidates.map((candidate) => (
                      <CommandItem
                        data-checked={selectedCandidateId === candidate.id}
                        key={candidate.id}
                        onSelect={() => setSelectedCandidateId(candidate.id)}
                        value={`${candidate.displayName} ${candidate.email}`}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {candidateInitials(candidate)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {candidate.displayName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {candidate.email}
                          </span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>

            <Field label={tr("组织角色")}>
              <MemberRoleSelect
                disabled={addingMember}
                onValueChange={setSelectedRoleId}
                roleLabel={tr("请选择角色")}
                roles={organizationRoles}
                value={selectedRoleId}
              />
            </Field>
          </div>

          <DialogFooter showCloseButton>
            <Button
              disabled={
                addingMember ||
                loadingCandidates ||
                !selectedCandidateId ||
                !selectedRoleId
              }
              onClick={() => void addMember()}
              type="button"
            >
              {addingMember ? tr("添加中...") : tr("添加成员")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        confirmLabel={tr("移除")}
        description={tr("移除成员关系不会删除工作空间用户。")}
        onConfirm={() => void removeMember()}
        onOpenChange={(open) => { if (!open && !savingMemberId) setMemberToRemove(null); }}
        open={Boolean(memberToRemove)}
        pending={Boolean(savingMemberId)}
        title={tr("移除组织成员？")}
      />
    </div>
  );
}

function MemberRoleSelect({
  disabled,
  onValueChange,
  roleLabel,
  roles,
  value,
}: {
  disabled: boolean;
  onValueChange: (roleId: string) => void;
  roleLabel: string;
  roles: Role[];
  value: string;
}) {
  return (
    <Select disabled={disabled} onValueChange={onValueChange} value={value || undefined}>
      <SelectTrigger aria-label={roleLabel} className="w-full max-w-sm">
        <SelectValue placeholder={roleLabel} />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.id} value={role.id}>
            {role.displayName ?? role.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">{text}</div>;
}

function candidateInitials(candidate: OrganizationMemberCandidate) {
  return (candidate.displayName || candidate.email)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

function emptyForm(): OrganizationForm {
  return { name: "", parentOrganizationId: "", slug: "", status: "active" };
}

function toForm(organization: Organization): OrganizationForm {
  return {
    name: organization.name,
    parentOrganizationId: organization.parentOrganizationId ?? "",
    slug: organization.slug,
    status: organization.status,
  };
}
