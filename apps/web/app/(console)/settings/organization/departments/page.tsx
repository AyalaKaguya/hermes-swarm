"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createDepartment,
  createDepartmentDispatchRelation,
  createDepartmentMember,
  deleteDepartmentDispatchRelation,
  listDepartmentDispatchRelations,
  listDepartmentMembers,
  listDepartments,
  listOrganizationMembers,
  removeDepartmentMember,
  updateDepartment,
  type Department,
  type DepartmentDispatchRelation,
  type DepartmentDispatchType,
  type DepartmentMembership,
  type OrganizationMembership,
} from "@/lib/admin-api";
import { requireAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import {
  availableDepartmentParents,
  flattenDepartmentTree,
} from "@/lib/department-tree";

type DepartmentForm = {
  code: string;
  description: string;
  name: string;
  parentDepartmentId: string;
  slug: string;
};

const EMPTY_DEPARTMENT_FORM: DepartmentForm = {
  code: "",
  description: "",
  name: "",
  parentDepartmentId: "root",
  slug: "",
};

export default function DepartmentsPage() {
  const t = useTranslations("tenantScope");
  const common = useTranslations("common");
  const { snapshot } = useAdminShell();
  const organizationId = snapshot?.organization?.id ?? null;
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tenantDepartments, setTenantDepartments] = useState<Department[]>([]);
  const [relations, setRelations] = useState<DepartmentDispatchRelation[]>([]);
  const [members, setMembers] = useState<DepartmentMembership[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<
    OrganizationMembership[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [departmentDialog, setDepartmentDialog] = useState<Department | "create" | null>(null);
  const [departmentForm, setDepartmentForm] = useState(EMPTY_DEPARTMENT_FORM);
  const [memberOpen, setMemberOpen] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [isDefaultMember, setIsDefaultMember] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({
    priority: "100",
    sourceDepartmentId: "",
    targetDepartmentId: "",
    type: "handoff" as DepartmentDispatchType,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !snapshot) return;
    setLoading(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const organizations = snapshot.organizations.length
        ? snapshot.organizations
        : snapshot.organization
          ? [snapshot.organization]
          : [];
      const [departmentResults, nextOrganizationMembers] = await Promise.all([
        Promise.allSettled(
          organizations.map((organization) =>
            listDepartments(session, organization.id),
          ),
        ),
        listOrganizationMembers(session, organizationId).catch(() => []),
      ]);
      const allDepartments = departmentResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const currentDepartments = allDepartments.filter(
        (department) => department.organizationId === organizationId,
      );
      const relationResults = await Promise.allSettled(
        currentDepartments.map((department) =>
          listDepartmentDispatchRelations(
            session,
            organizationId,
            department.id,
          ),
        ),
      );
      const nextRelations = relationResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      setTenantDepartments(allDepartments);
      setDepartments(currentDepartments);
      setOrganizationMembers(nextOrganizationMembers);
      setRelations(nextRelations);
      setSelectedId((current) =>
        current && currentDepartments.some((item) => item.id === current)
          ? current
          : currentDepartments[0]?.id ?? null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [organizationId, snapshot, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!organizationId || !selectedId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    void requireAuthenticatedAdminSessionMarker()
      .then((session) => listDepartmentMembers(session, organizationId, selectedId))
      .then((items) => {
        if (!cancelled) setMembers(items);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : t("loadFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedId, t]);

  const tree = useMemo(() => flattenDepartmentTree(departments), [departments]);
  const selectedDepartment = departments.find((item) => item.id === selectedId) ?? null;
  const parentOptions = availableDepartmentParents(
    departments,
    departmentDialog && departmentDialog !== "create" ? departmentDialog.id : null,
  );
  const departmentNames = new Map(
    tenantDepartments.map((department) => [department.id, department.name]),
  );

  function openDepartmentDialog(department?: Department) {
    setDepartmentDialog(department ?? "create");
    setDepartmentForm(
      department
        ? {
            code: department.code ?? "",
            description: department.description ?? "",
            name: department.name,
            parentDepartmentId: department.parentDepartmentId ?? "root",
            slug: department.slug,
          }
        : EMPTY_DEPARTMENT_FORM,
    );
  }

  async function saveDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !departmentDialog) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const payload = {
        code: departmentForm.code.trim() || null,
        description: departmentForm.description.trim() || null,
        name: departmentForm.name.trim(),
        parentDepartmentId:
          departmentForm.parentDepartmentId === "root"
            ? null
            : departmentForm.parentDepartmentId,
        slug: departmentForm.slug.trim() || undefined,
      };
      if (departmentDialog === "create") {
        await createDepartment(session, organizationId, payload);
      } else {
        await updateDepartment(session, organizationId, departmentDialog.id, payload);
      }
      setDepartmentDialog(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleDepartment(department: Department) {
    if (!organizationId) return;
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await updateDepartment(session, organizationId, department.id, {
        status: department.status === "active" ? "disabled" : "active",
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !selectedId) return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await createDepartmentMember(session, organizationId, selectedId, {
        isDefault: isDefaultMember,
        membershipId: membershipId.trim(),
      });
      setMembers(await listDepartmentMembers(session, organizationId, selectedId));
      setMemberOpen(false);
      setMembershipId("");
      setIsDefaultMember(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(item: DepartmentMembership) {
    if (!organizationId || !selectedId) return;
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await removeDepartmentMember(session, organizationId, selectedId, item.id);
      setMembers((current) => current.filter((member) => member.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("removeFailed"));
    }
  }

  async function addDispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await createDepartmentDispatchRelation(session, organizationId, {
        priority: Number(dispatchForm.priority) || 100,
        sourceDepartmentId: dispatchForm.sourceDepartmentId,
        targetDepartmentId: dispatchForm.targetDepartmentId,
        type: dispatchForm.type,
      });
      setDispatchOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function removeDispatch(relationId: string) {
    if (!organizationId) return;
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const relation = relations.find((item) => item.id === relationId);
      if (!relation) return;
      await deleteDepartmentDispatchRelation(
        session,
        organizationId,
        relation.sourceDepartmentId,
        relationId,
      );
      setRelations((current) => current.filter((item) => item.id !== relationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("removeFailed"));
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm">{common("loading")}</div>;
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("departments")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("departmentsDescription")}
          </p>
        </div>
        <Button onClick={() => openDepartmentDialog()}>
          <AppIcon name="plus" />
          {t("newDepartment")}
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("departments")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {tree.map(({ depth, item }) => (
              <div
                className={`flex items-center gap-2 rounded-md border px-2 py-2 ${
                  item.id === selectedId ? "bg-muted" : "border-transparent"
                }`}
                key={item.id}
                style={{ marginLeft: `${depth * 16}px` }}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelectedId(item.id)}
                  type="button"
                >
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {item.code ?? item.slug}
                  </span>
                </button>
                <Badge variant={item.status === "active" ? "default" : "secondary"}>
                  {t(item.status)}
                </Badge>
                <Button onClick={() => openDepartmentDialog(item)} size="icon-sm" variant="ghost">
                  <AppIcon name="pencil" />
                </Button>
                <Button onClick={() => void toggleDepartment(item)} size="sm" variant="ghost">
                  {item.status === "active" ? t("disable") : t("enable")}
                </Button>
              </div>
            ))}
            {tree.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("emptyDepartments")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              {selectedDepartment?.name ?? t("members")}
            </CardTitle>
            <Button disabled={!selectedId} onClick={() => setMemberOpen(true)} size="sm">
              <AppIcon name="plus" />
              {t("addMember")}
            </Button>
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("selectDepartment")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{common("name")}</TableHead>
                    <TableHead>{t("membershipId")}</TableHead>
                    <TableHead>{t("defaultMembership")}</TableHead>
                    <TableHead className="text-right">{common("remove")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.membership?.user.displayName ?? item.membershipId}</TableCell>
                      <TableCell className="font-mono text-xs">{item.membershipId}</TableCell>
                      <TableCell>{item.isDefault ? common("confirm") : "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button onClick={() => void removeMember(item)} size="icon-sm" variant="ghost">
                          <AppIcon name="trash" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {members.length === 0 && (
                    <TableRow>
                      <TableCell className="py-8 text-center" colSpan={4}>
                        {t("emptyMembers")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">{t("dispatch")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("dispatchDescription")}</p>
          </div>
          <Button onClick={() => setDispatchOpen(true)} size="sm">
            <AppIcon name="plus" />
            {t("newRelation")}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sourceDepartment")}</TableHead>
                <TableHead>{t("targetDepartment")}</TableHead>
                <TableHead>{t("type")}</TableHead>
                <TableHead>{t("priority")}</TableHead>
                <TableHead className="text-right">{common("remove")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {relations.map((relation) => (
                <TableRow key={relation.id}>
                  <TableCell>{relation.sourceDepartment?.name ?? departmentNames.get(relation.sourceDepartmentId)}</TableCell>
                  <TableCell>{relation.targetDepartment?.name ?? departmentNames.get(relation.targetDepartmentId)}</TableCell>
                  <TableCell>{t(relation.type)}</TableCell>
                  <TableCell>{relation.priority}</TableCell>
                  <TableCell className="text-right">
                    <Button onClick={() => void removeDispatch(relation.id)} size="icon-sm" variant="ghost">
                      <AppIcon name="trash" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {relations.length === 0 && (
                <TableRow>
                  <TableCell className="py-8 text-center" colSpan={5}>
                    {t("emptyRelations")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={(open) => !open && setDepartmentDialog(null)} open={Boolean(departmentDialog)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{departmentDialog === "create" ? t("newDepartment") : t("editDepartment")}</DialogTitle>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={saveDepartment}>
            <Field label={common("name")}>
              <Input required value={departmentForm.name} onChange={(event) => setDepartmentForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("identifier")}>
                <Input value={departmentForm.slug} onChange={(event) => setDepartmentForm((current) => ({ ...current, slug: event.target.value }))} />
              </Field>
              <Field label={t("code")}>
                <Input value={departmentForm.code} onChange={(event) => setDepartmentForm((current) => ({ ...current, code: event.target.value }))} />
              </Field>
            </div>
            <Field label={t("parentDepartment")}>
              <Select value={departmentForm.parentDepartmentId} onValueChange={(value) => setDepartmentForm((current) => ({ ...current, parentDepartmentId: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">{t("rootDepartment")}</SelectItem>
                  {parentOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("description")}>
              <Textarea value={departmentForm.description} onChange={(event) => setDepartmentForm((current) => ({ ...current, description: event.target.value }))} />
            </Field>
            <DialogFooter>
              <Button onClick={() => setDepartmentDialog(null)} type="button" variant="outline">{common("cancel")}</Button>
              <Button disabled={saving} type="submit">{saving ? common("saving") : common("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setMemberOpen} open={memberOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("addMember")}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={addMember}>
            <Field label={t("membershipId")}>
              <Select onValueChange={setMembershipId} value={membershipId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {organizationMembers
                    .filter((item) => item.status === "active")
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.displayName ?? item.user.displayName ?? item.user.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isDefaultMember} onCheckedChange={(value) => setIsDefaultMember(value === true)} />
              {t("defaultMembership")}
            </label>
            <DialogFooter>
              <Button onClick={() => setMemberOpen(false)} type="button" variant="outline">{common("cancel")}</Button>
              <Button disabled={saving || !membershipId} type="submit">{common("add")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDispatchOpen} open={dispatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newRelation")}</DialogTitle>
            <DialogDescription>{t("dispatchDescription")}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={addDispatch}>
            <Field label={t("sourceDepartment")}>
              <DepartmentSelect departments={departments} value={dispatchForm.sourceDepartmentId} onChange={(value) => setDispatchForm((current) => ({ ...current, sourceDepartmentId: value }))} />
            </Field>
            <Field label={t("targetDepartment")}>
              <DepartmentSelect departments={tenantDepartments.filter((item) => item.id !== dispatchForm.sourceDepartmentId)} value={dispatchForm.targetDepartmentId} onChange={(value) => setDispatchForm((current) => ({ ...current, targetDepartmentId: value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("type")}>
                <Select value={dispatchForm.type} onValueChange={(value) => setDispatchForm((current) => ({ ...current, type: value as DepartmentDispatchType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(["handoff", "escalation", "collaboration", "fallback"] as const).map((type) => <SelectItem key={type} value={type}>{t(type)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t("priority")}>
                <Input min={0} type="number" value={dispatchForm.priority} onChange={(event) => setDispatchForm((current) => ({ ...current, priority: event.target.value }))} />
              </Field>
            </div>
            <DialogFooter>
              <Button onClick={() => setDispatchOpen(false)} type="button" variant="outline">{common("cancel")}</Button>
              <Button disabled={saving || !dispatchForm.sourceDepartmentId || !dispatchForm.targetDepartmentId} type="submit">{common("create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="grid gap-2"><Label>{label}</Label>{children}</div>;
}

function DepartmentSelect({ departments, onChange, value }: { departments: Department[]; onChange: (value: string) => void; value: string }) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}
