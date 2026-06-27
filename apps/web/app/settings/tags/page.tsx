"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTag, deleteTag, listTags, updateTag, type Tag } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function TagsPage() {
  const [items, setItems] = useState<Tag[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    try {
      setItems(await listTags(session.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.category, item.description].some((field) =>
        field?.toLowerCase().includes(value),
      ),
    );
  }, [items, search]);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">标签</h1>
          <p className="text-sm text-muted-foreground">组织范围内的标签和分类</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <AppIcon className="size-4" name="layers" />
              新建标签
            </Button>
          </DialogTrigger>
          <TagDialogForm
            onSaved={async () => {
              setOpen(false);
              await load();
            }}
            token={token}
          />
        </Dialog>
      </div>
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex justify-end">
        <Input
          className="w-full sm:w-72"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索标签..."
          value={search}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => (
          <Card key={item.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{item.name}</CardTitle>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.category && <Badge variant="secondary">{item.category}</Badge>}
                  {item.isSystem && <Badge variant="outline">系统</Badge>}
                </div>
              </div>
              <span
                className="mt-1 size-4 shrink-0 rounded-full border"
                style={{ backgroundColor: item.color ?? "transparent" }}
              />
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="min-h-10 text-muted-foreground">{item.description || "无描述"}</p>
              <div className="flex justify-end gap-2">
                <Dialog open={editing?.id === item.id} onOpenChange={(next) => setEditing(next ? item : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">编辑</Button>
                  </DialogTrigger>
                  <TagDialogForm
                    item={item}
                    onSaved={async () => {
                      setEditing(null);
                      await load();
                    }}
                    token={token}
                  />
                </Dialog>
                <Button onClick={() => setDeleting(item)} size="sm" variant="outline">删除</Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">暂无标签</CardContent>
          </Card>
        )}
      </div>
      <ConfirmActionDialog
        description={deleting ? `删除标签 ${deleting.name}` : ""}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteTag(token, deleting.id);
          setDeleting(null);
          await load();
        }}
        onOpenChange={(next) => !next && setDeleting(null)}
        open={Boolean(deleting)}
        title="删除标签"
      />
    </section>
  );
}

function TagDialogForm({
  item,
  onSaved,
  token,
}: {
  item?: Tag;
  onSaved: () => Promise<void>;
  token: string;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [color, setColor] = useState(item?.color ?? "#64748b");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const payload = {
        category: category.trim() || null,
        color: color.trim() || null,
        description: description.trim() || null,
        name: name.trim(),
      };
      if (item) {
        await updateTag(token, item.id, payload);
      } else {
        await createTag(token, payload);
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{item ? "编辑标签" : "新建标签"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>名称</Label>
          <Input onChange={(event) => setName(event.target.value)} value={name} />
        </div>
        <div className="grid gap-2">
          <Label>分类</Label>
          <Input onChange={(event) => setCategory(event.target.value)} value={category} />
        </div>
        <div className="grid gap-2">
          <Label>颜色</Label>
          <Input onChange={(event) => setColor(event.target.value)} type="color" value={color} />
        </div>
        <div className="grid gap-2">
          <Label>描述</Label>
          <Textarea onChange={(event) => setDescription(event.target.value)} value={description} />
        </div>
        <Button disabled={!name.trim() || saving} onClick={save}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </DialogContent>
  );
}
