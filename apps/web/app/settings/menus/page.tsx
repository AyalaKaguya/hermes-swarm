"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createMenu,
  deleteMenu,
  listMenus,
  updateMenu,
  type Menu,
  type MenuPayload,
} from "@/lib/admin-api";
import { getStoredSession, hasMenuAccess } from "@/lib/session";

const NO_PARENT = "__none__";

export default function MenusPage() {
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const [items, setItems] = useState<Menu[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [deleting, setDeleting] = useState<Menu | null>(null);
  const canManage =
    snapshot && resolvedSession
      ? hasMenuAccess(snapshot, resolvedSession, "menus", "manage")
      : false;

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }

    setToken(session.token);
    setError(null);
    try {
      setItems(await listMenus(session.token, { includeInactive: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parentLabel = useMemo(
    () => new Map(items.map((item) => [item.id, item.label])),
    [items],
  );
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.label, item.code, item.path]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [items, query]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">网页</h1>
          <p className="text-sm">管理控制台页面、路由和权限入口</p>
        </div>
        <Dialog onOpenChange={setCreateOpen} open={createOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canManage} size="sm">
              <AppIcon className="size-4" name="menu" />
              新建网页
            </Button>
          </DialogTrigger>
          <MenuForm
            menus={items}
            onSaved={async () => {
              setCreateOpen(false);
              await load();
              await refreshSnapshot();
            }}
            token={token}
          />
        </Dialog>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {!canManage && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          当前账号只有查看权限，不能新增、编辑或停用网页。
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 py-4">
          <CardTitle className="text-base">网页列表</CardTitle>
          <Input
            className="h-8 w-full sm:w-64"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、编码或路径"
            value={query}
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[20%]">名称</TableHead>
                <TableHead className="w-[18%]">编码</TableHead>
                <TableHead>路径</TableHead>
                <TableHead className="w-[16%]">父级</TableHead>
                <TableHead className="w-24">排序</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.code}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.path}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.parentId
                      ? (parentLabel.get(item.parentId) ?? "未知父级")
                      : "-"}
                  </TableCell>
                  <TableCell className="text-sm">{item.sortOrder}</TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? "secondary" : "outline"}>
                      {item.isActive ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Dialog
                        onOpenChange={(next) => setEditing(next ? item : null)}
                        open={editing?.id === item.id}
                      >
                        <DialogTrigger asChild>
                          <Button
                            disabled={!canManage}
                            size="xs"
                            variant="ghost"
                          >
                            编辑
                          </Button>
                        </DialogTrigger>
                        <MenuForm
                          item={item}
                          menus={items}
                          onSaved={async () => {
                            setEditing(null);
                            await load();
                            await refreshSnapshot();
                          }}
                          token={token}
                        />
                      </Dialog>
                      <Button
                        disabled={!canManage || !item.isActive}
                        onClick={() => setDeleting(item)}
                        size="xs"
                        variant="ghost"
                      >
                        停用
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell className="py-10 text-center text-sm" colSpan={7}>
                    暂无网页
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmActionDialog
        confirmLabel="停用"
        description={
          deleting
            ? `停用网页「${deleting.label}」后，它不会再出现在管理导航中。`
            : ""
        }
        onConfirm={async () => {
          if (!deleting) return;
          await deleteMenu(token, deleting.id);
          setDeleting(null);
          await load();
          await refreshSnapshot();
        }}
        onOpenChange={(next) => !next && setDeleting(null)}
        open={Boolean(deleting)}
        title="停用网页"
      />
    </section>
  );
}

function MenuForm({
  item,
  menus,
  onSaved,
  token,
}: {
  item?: Menu;
  menus: Menu[];
  onSaved: () => Promise<void>;
  token: string;
}) {
  const [code, setCode] = useState(item?.code ?? "");
  const [label, setLabel] = useState(item?.label ?? "");
  const [path, setPath] = useState(item?.path ?? "");
  const [parentId, setParentId] = useState(item?.parentId ?? null);
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentOptions = menus.filter(
    (menu) => menu.id !== item?.id && menu.isActive,
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: MenuPayload = {
        code: code.trim(),
        isActive,
        label: label.trim(),
        parentId,
        path: path.trim(),
        sortOrder: Number(sortOrder) || 0,
      };
      if (item) {
        await updateMenu(token, item.id, payload);
      } else {
        await createMenu(token, payload);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{item ? "编辑网页" : "新建网页"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="名称" htmlFor="menu-label">
            <Input
              id="menu-label"
              onChange={(event) => setLabel(event.target.value)}
              value={label}
            />
          </Field>
          <Field label="编码" htmlFor="menu-code">
            <Input
              className="font-mono"
              id="menu-code"
              onChange={(event) => setCode(event.target.value)}
              value={code}
            />
          </Field>
        </div>
        <Field label="路径" htmlFor="menu-path">
          <Input
            className="font-mono"
            id="menu-path"
            onChange={(event) => setPath(event.target.value)}
            placeholder="/settings/example"
            value={path}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="父级" htmlFor="menu-parent">
            <Select
              onValueChange={(value) =>
                setParentId(value === NO_PARENT ? null : value)
              }
              value={parentId ?? NO_PARENT}
            >
              <SelectTrigger id="menu-parent">
                <SelectValue placeholder="选择父级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>无父级</SelectItem>
                {parentOptions.map((menu) => (
                  <SelectItem key={menu.id} value={menu.id}>
                    {menu.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="排序" htmlFor="menu-sort-order">
            <Input
              id="menu-sort-order"
              inputMode="numeric"
              onChange={(event) => setSortOrder(event.target.value)}
              type="number"
              value={sortOrder}
            />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div className="grid gap-0.5">
            <Label htmlFor="menu-active">启用网页</Label>
            <span className="text-xs">停用后不会出现在管理导航中</span>
          </div>
          <Switch
            checked={isActive}
            id="menu-active"
            onCheckedChange={setIsActive}
          />
        </div>
        <Button
          disabled={!code.trim() || !label.trim() || !path.trim() || saving}
          onClick={save}
        >
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </DialogContent>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
