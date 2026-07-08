"use client";

import { useCallback, useEffect, useState } from "react";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createPlatformEmailTemplate,
  deletePlatformEmailTemplate,
  listPlatformEmailTemplates,
  updatePlatformEmailTemplate,
  type EmailTemplateDto,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminToken,
  requireAuthenticatedAdminToken,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";

export default function PlatformEmailTemplatesPage() {
  const tr = useTextTranslation();
  const notifications = useNotifications();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplateDto | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplateDto | null>(null);
  const [items, setItems] = useState<EmailTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setItems(await listPlatformEmailTemplates(token));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (!deleting) return;
    try {
      const token = await requireAuthenticatedAdminToken();
      await deletePlatformEmailTemplate(token, deleting.id);
      notifications.success(tr("已删除"));
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("删除失败"));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {tr("加载中...")}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{tr("平台邮件模板")}</CardTitle>
          <CardDescription>
            {tr("作为组织未配置模板时的全局回退")}
          </CardDescription>
        </div>
        <Dialog onOpenChange={setCreateOpen} open={createOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <AppIcon className="size-3.5" name="plus" />
              {tr("添加模板")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{tr("创建平台邮件模板")}</DialogTitle>
            </DialogHeader>
            <TemplateForm
              onSubmit={async (payload) => {
                const token = await requireAuthenticatedAdminToken();
                await createPlatformEmailTemplate(token, payload);
                notifications.success(tr("已创建"));
                setCreateOpen(false);
                await load();
              }}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        {items.length === 0 ? (
          <div className="rounded-md border bg-muted/30 px-3 py-8 text-center text-sm">
            {tr("暂无平台邮件模板")}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <div className="grid gap-3 rounded-md border p-3" key={item.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {item.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.subject ?? "-"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {item.isSystem && (
                      <Badge className="text-xs" variant="secondary">
                        {tr("系统模板")}
                      </Badge>
                    )}
                    <Badge className="text-xs" variant="outline">
                      {item.languageCode}
                    </Badge>
                  </div>
                </div>
                <div className="line-clamp-3 font-mono text-xs text-muted-foreground">
                  {item.hbs}
                </div>
                <div className="flex justify-end gap-1">
                  <Button
                    onClick={() => setEditing(item)}
                    size="sm"
                    variant="ghost"
                  >
                    {tr("编辑")}
                  </Button>
                  <Button
                    disabled={item.isSystem}
                    onClick={() => setDeleting(item)}
                    size="sm"
                    variant="ghost"
                  >
                    {tr("删除")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {editing && (
        <Dialog
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          open={true}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{tr("编辑平台邮件模板")}</DialogTitle>
            </DialogHeader>
            <TemplateForm
              initial={editing}
              onSubmit={async (payload) => {
                const token = await requireAuthenticatedAdminToken();
                await updatePlatformEmailTemplate(token, editing.id, payload);
                notifications.success(tr("已保存"));
                setEditing(null);
                await load();
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <ConfirmActionDialog
        confirmLabel="删除"
        description={deleting ? `${tr("删除邮件模板")} ${deleting.name}` : ""}
        onConfirm={() => void remove()}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        open={Boolean(deleting)}
        title="删除邮件模板"
      />
    </Card>
  );
}

function TemplateForm({
  initial,
  onSubmit,
}: {
  initial?: EmailTemplateDto;
  onSubmit: (payload: {
    description?: string | null;
    hbs?: string;
    languageCode?: string;
    mjml?: string | null;
    name?: string;
    subject?: string | null;
  }) => Promise<void>;
}) {
  const tr = useTextTranslation();
  const [description, setDescription] = useState(initial?.description ?? "");
  const [hbs, setHbs] = useState(initial?.hbs ?? "");
  const [languageCode, setLanguageCode] = useState(
    initial?.languageCode ?? "zh-CN",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        description: description.trim() || null,
        hbs,
        languageCode,
        name,
        subject: subject.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Field id="platform-template-name" label="模板名称">
        <Input
          disabled={Boolean(initial?.isSystem)}
          id="platform-template-name"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="platform-template-language" label="语言编码">
          <Input
            disabled={Boolean(initial?.isSystem)}
            id="platform-template-language"
            onChange={(event) => setLanguageCode(event.target.value)}
            value={languageCode}
          />
        </Field>
        <Field id="platform-template-subject" label="主题">
          <Input
            id="platform-template-subject"
            onChange={(event) => setSubject(event.target.value)}
            value={subject}
          />
        </Field>
      </div>
      <Field id="platform-template-description" label="说明">
        <Input
          id="platform-template-description"
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </Field>
      <Field id="platform-template-hbs" label="模板内容">
        <Textarea
          className="font-mono text-xs"
          id="platform-template-hbs"
          onChange={(event) => setHbs(event.target.value)}
          rows={9}
          value={hbs}
        />
      </Field>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <Button
        disabled={saving || !name.trim() || !languageCode.trim() || !hbs.trim()}
        onClick={submit}
      >
        {saving ? tr("保存中...") : tr("保存")}
      </Button>
    </div>
  );
}

function Field({
  children,
  id,
  label,
}: {
  children: React.ReactNode;
  id: string;
  label: string;
}) {
  const tr = useTextTranslation();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{tr(label)}</Label>
      {children}
    </div>
  );
}
