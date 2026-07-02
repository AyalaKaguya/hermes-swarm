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
import {
  createNotificationDestination,
  deleteNotificationDestination,
  listNotificationDestinations,
  listNotificationDestinationTypes,
  updateNotificationDestination,
  type NotificationDestination,
  type NotificationDestinationType,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function NotificationDestinationsPage() {
  const { snapshot } = useAdminShell();
  const organizationId = snapshot?.organization?.id ?? null;
  const [items, setItems] = useState<NotificationDestination[]>([]);
  const [types, setTypes] = useState<NotificationDestinationType[]>([]);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationDestination | null>(null);
  const [deleting, setDeleting] = useState<NotificationDestination | null>(
    null,
  );

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.accessToken || !organizationId) {
      setLoading(false);
      return;
    }
    setToken(session.accessToken);
    try {
      const [destinationTypes, destinations] = await Promise.all([
        listNotificationDestinationTypes(session.accessToken, organizationId),
        listNotificationDestinations(session.accessToken, organizationId),
      ]);
      setTypes(destinationTypes);
      setItems(destinations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeMap = useMemo(
    () => new Map(types.map((type) => [type.type, type])),
    [types],
  );

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
          <h1 className="text-lg font-semibold">通知</h1>
          <p className="text-sm">配置组织通知目的地</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <AppIcon className="size-4" name="bell" />
              新建通知目的地
            </Button>
          </DialogTrigger>
          <DestinationForm
            organizationId={organizationId}
            onSaved={async () => {
              setOpen(false);
              await load();
            }}
            token={token}
            types={types}
          />
        </Dialog>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const type = typeMap.get(item.type);
          return (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">
                    {item.name}
                  </CardTitle>
                  <div className="mt-1">
                    <Badge variant="secondary">{type?.name ?? item.type}</Badge>
                  </div>
                </div>
                <AppIcon className="size-4" name="bell" />
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="rounded-md border bg-muted/20 px-3 py-2 font-mono text-xs">
                  {Object.keys(item.options ?? {}).length} 个配置项
                </div>
                <div className="flex justify-end gap-2">
                  <Dialog
                    open={editing?.id === item.id}
                    onOpenChange={(next) => setEditing(next ? item : null)}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        编辑
                      </Button>
                    </DialogTrigger>
                    <DestinationForm
                      item={item}
                      organizationId={organizationId}
                      onSaved={async () => {
                        setEditing(null);
                        await load();
                      }}
                      token={token}
                      types={types}
                    />
                  </Dialog>
                  <Button
                    onClick={() => setDeleting(item)}
                    size="sm"
                    variant="outline"
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {items.length === 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-sm">
              暂无通知目的地
            </CardContent>
          </Card>
        )}
      </div>
      <ConfirmActionDialog
        description={deleting ? `删除通知目的地 ${deleting.name}` : ""}
        onConfirm={async () => {
          if (!deleting) return;
          if (!organizationId) return;
          await deleteNotificationDestination(token, organizationId, deleting.id);
          setDeleting(null);
          await load();
        }}
        onOpenChange={(next) => !next && setDeleting(null)}
        open={Boolean(deleting)}
        title="删除通知目的地"
      />
    </section>
  );
}

function DestinationForm({
  item,
  organizationId,
  onSaved,
  token,
  types,
}: {
  item?: NotificationDestination;
  organizationId: string | null;
  onSaved: () => Promise<void>;
  token: string;
  types: NotificationDestinationType[];
}) {
  const [type, setType] = useState(item?.type ?? types[0]?.type ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [options, setOptions] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(item?.options ?? {}).map(([key, value]) => [
        key,
        String(value ?? ""),
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);

  const selectedType = types.find((entry) => entry.type === type);
  const fields = Object.entries(selectedType?.schema?.properties ?? {});

  useEffect(() => {
    setOptions((current) => {
      const next = { ...current };
      for (const [key] of fields) {
        next[key] ??= "";
      }
      return next;
    });
  }, [selectedType?.type]);

  async function save() {
    setSaving(true);
    try {
      const compactOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value.trim() !== ""),
      );
      const payload = { name: name.trim(), options: compactOptions, type };
      if (!organizationId) return;
      if (item) {
        await updateNotificationDestination(token, organizationId, item.id, payload);
      } else {
        await createNotificationDestination(token, organizationId, payload);
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{item ? "编辑通知目的地" : "新建通知目的地"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label>类型</Label>
          <Select disabled={Boolean(item)} onValueChange={setType} value={type}>
            <SelectTrigger>
              <SelectValue placeholder="选择通知类型" />
            </SelectTrigger>
            <SelectContent>
              {types.map((entry) => (
                <SelectItem key={entry.type} value={entry.type}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>名称</Label>
          <Input
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </div>
        {fields.map(([key, field]) => (
          <div className="grid gap-2" key={key}>
            <Label>{field.title ?? key}</Label>
            <Input
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              type={
                selectedType?.schema?.secret?.includes(key)
                  ? "password"
                  : "text"
              }
              value={options[key] ?? ""}
            />
          </div>
        ))}
        <Button disabled={!name.trim() || !type || saving} onClick={save}>
          保存
        </Button>
      </div>
    </DialogContent>
  );
}
