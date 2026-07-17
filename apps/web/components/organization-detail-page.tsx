"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAdminShell } from "@/components/admin-shell";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  deleteOrganizationMember,
  getOrganization,
  listOrganizationMembers,
  listOrganizationRoles,
  replaceOrganizationMemberRole,
  updateOrganization,
  type Organization,
  type OrganizationMembership,
  type Role,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
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
  const { refreshSnapshot } = useAdminShell();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [organizationRoles, setOrganizationRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<OrganizationForm>(emptyForm());
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
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
        <CardHeader><CardTitle className="text-base">{tr("成员与角色")} · {memberships.length}</CardTitle></CardHeader>
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
