"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  createOrganization,
  listOrganizations,
  type Organization,
  type OrganizationPayload,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";
import { useOrganizationContext } from "@/components/organization-context-provider";

export default function OrganizationsPage() {
  const tr = useTextTranslation();
  const router = useRouter();
  const { switchOrganization } = useOrganizationContext();
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const canViewOrganizations =
    snapshot && resolvedSession
      ? access.hasPageAccess("settings.organizations")
      : false;
  const canCreateOrganization =
    canViewOrganizations && snapshot && resolvedSession
      ? access.hasPermission("organization.tenant_organization.create:tenant")
      : false;
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    parentOrganizationId: "",
    slug: "",
  });
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token || !canViewOrganizations) {
      setLoading(false);
      return;
    }
    try {
      setItems(await listOrganizations(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [canViewOrganizations, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.slug].some((field) =>
        field?.toLowerCase().includes(value),
      ),
    );
  }, [items, search]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateOrganization) return;

    setCreating(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const payload: OrganizationPayload = {
        name: createForm.name,
        parentOrganizationId: createForm.parentOrganizationId,
        slug: createForm.slug.trim() || undefined,
        status: "active",
      };
      const created = await createOrganization(token, payload);
      setItems((current) => [...current, created]);
      setCreateForm({ name: "", parentOrganizationId: "", slug: "" });
      setCreateOpen(false);
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("创建失败"));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {tr("加载中...")}
      </div>
    );
  }

  if (!canViewOrganizations) {
    return (
      <div className="flex items-center justify-center py-16">
        <InlineNotice className="max-w-xl">{tr("当前账号无权访问组织列表。")}</InlineNotice>
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("组织")}</h1>
          <p className="text-sm text-muted-foreground">{tr("管理当前工作空间的轻量组织树")}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Input
            className="w-full sm:w-72"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("搜索组织...")}
            value={search}
          />
          {canCreateOrganization && (
            <Button onClick={() => setCreateOpen(true)} type="button">
              <AppIcon className="size-3.5" name="building" />
              {tr("新建组织")}
            </Button>
          )}
        </div>
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tr("组织")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("名称")}</TableHead>
                <TableHead>{tr("标识")}</TableHead>
                <TableHead>{tr("上级组织")}</TableHead>
                <TableHead>{tr("状态")}</TableHead>
                <TableHead className="w-24 text-right">
                  {tr("操作")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.slug}
                  </TableCell>
                  <TableCell>
                    {items.find((candidate) => candidate.id === item.parentOrganizationId)?.name ?? tr("根组织")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === "active" ? "default" : "secondary"
                      }
                    >
                      {item.status === "active" ? tr("启用") : tr("停用")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      disabled={!snapshot?.memberships.some((membership) => membership.organizationId === item.id && membership.status === "active")}
                      onClick={async () => {
                        await switchOrganization(item.id);
                        router.push("/settings/organization");
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <AppIcon className="size-3.5" name="settings" />
                      {tr("配置")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell className="py-8 text-center text-sm" colSpan={5}>
                    {tr("暂无组织")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("新建组织")}</DialogTitle>
            <DialogDescription>
              {tr("新组织必须挂在当前工作空间已有组织下。")}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitCreate}>
            <div className="grid gap-2">
              <Label htmlFor="organization-create-name">{tr("名称")}</Label>
              <Input
                id="organization-create-name"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                value={createForm.name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="organization-create-parent">{tr("上级组织")}</Label>
              <Select
                onValueChange={(value) =>
                  setCreateForm((current) => ({
                    ...current,
                    parentOrganizationId: value,
                  }))
                }
                required
                value={createForm.parentOrganizationId || undefined}
              >
                <SelectTrigger className="w-full" id="organization-create-parent"><SelectValue placeholder={tr("请选择")} /></SelectTrigger>
                <SelectContent>
                  {items.filter((item) => item.status === "active").map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="organization-create-slug">{tr("标识符")}</Label>
              <Input
                id="organization-create-slug"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    slug: event.target.value,
                  }))
                }
                placeholder={tr("留空后根据名称生成")}
                value={createForm.slug}
              />
            </div>
            <DialogFooter>
              <Button
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                type="button"
                variant="outline"
              >
                {tr("取消")}
              </Button>
              <Button
                disabled={creating || !createForm.parentOrganizationId}
                type="submit"
              >
                {creating ? tr("创建中...") : tr("创建")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
