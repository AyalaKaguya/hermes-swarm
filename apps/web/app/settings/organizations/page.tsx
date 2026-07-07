"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
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
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";
import { getStoredSession } from "@/lib/session";

export default function OrganizationsPage() {
  const tr = useTextTranslation();
  const router = useRouter();
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const canViewPlatformOrganizations =
    snapshot && resolvedSession
      ? access.hasPageAccess("settings.organizations")
      : false;
  const canManage =
    canViewPlatformOrganizations && snapshot && resolvedSession
      ? access.hasPermission([
          "organization.platform_organization.create:platform",
          "organization.platform_organization.delete:platform",
        ])
      : false;
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    slug: "",
    subdomain: "",
  });
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.accessToken || !canViewPlatformOrganizations) {
      setLoading(false);
      return;
    }
    try {
      setItems(await listOrganizations(session.accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [canViewPlatformOrganizations, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.slug, item.subdomain].some((field) =>
        field?.toLowerCase().includes(value),
      ),
    );
  }, [items, search]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = getStoredSession();
    if (!session?.accessToken || !canManage) return;

    setCreating(true);
    setError(null);
    try {
      const payload: OrganizationPayload = {
        name: createForm.name,
        slug: createForm.slug.trim() || undefined,
        subdomain: createForm.subdomain.trim() || null,
        status: "active",
      };
      const created = await createOrganization(session.accessToken, payload);
      setItems((current) => [...current, created]);
      setCreateForm({ name: "", slug: "", subdomain: "" });
      setCreateOpen(false);
      await refreshSnapshot();
      router.push(`/settings/organizations/${created.id}`);
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

  if (!canViewPlatformOrganizations) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
          {tr("当前账号无权访问组织列表。")}
        </div>
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{tr("组织列表")}</h1>
          <p className="text-sm">{tr("平台范围内的组织管理视图")}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Input
            className="w-full sm:w-72"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("搜索组织...")}
            value={search}
          />
          {canManage && (
            <Button onClick={() => setCreateOpen(true)} type="button">
              <AppIcon className="size-3.5" name="building" />
              {tr("新建组织")}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          {error}
        </div>
      )}
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
                <TableHead>{tr("子域名")}</TableHead>
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
                  <TableCell>{item.subdomain ?? "-"}</TableCell>
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
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/settings/organizations/${item.id}`}>
                        <AppIcon className="size-3.5" name="settings" />
                        {tr("配置")}
                      </Link>
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
              {tr("创建后进入该组织的完整配置页。")}
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
            <div className="grid gap-2">
              <Label htmlFor="organization-create-subdomain">
                {tr("子域名")}
              </Label>
              <Input
                id="organization-create-subdomain"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    subdomain: event.target.value,
                  }))
                }
                value={createForm.subdomain}
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
              <Button disabled={creating} type="submit">
                {creating ? tr("创建中...") : tr("创建")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
