"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createEmailTemplate,
  deleteEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
  type EmailTemplateDto,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminToken,
  requireAuthenticatedAdminToken,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";

type LanguageFilter = "all" | "zh-CN" | "en" | "zh-Hans" | "zh-Hant";

const LANGUAGE_LABELS: Record<LanguageFilter, string> = {
  all: "全部",
  "zh-CN": "简体中文",
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

export default function EmailTemplatesPage() {
  const t = useTranslations();
  const tr = useTextTranslation();
  const { snapshot } = useAdminShell();
  const organizationId = snapshot?.organization?.id ?? null;
  const [templates, setTemplates] = useState<EmailTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<EmailTemplateDto | null>(
    null,
  );
  const [deleteTemplate, setDeleteTemplate] = useState<EmailTemplateDto | null>(
    null,
  );
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminToken();
    if (!token || !organizationId) {
      setLoading(false);
      return;
    }
    try {
      const data = await listEmailTemplates(token, organizationId);
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [organizationId, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(templateId: string) {
    try {
      if (!organizationId) return;
      await deleteEmailTemplate(
        await requireAuthenticatedAdminToken(),
        organizationId,
        templateId,
      );
      setMsg(tr("已删除"));
      setDeleteTemplate(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("删除失败"));
    }
  }

  const filtered =
    languageFilter === "all"
      ? templates
      : templates.filter((t) => t.languageCode === languageFilter);

  const availableLanguages = [...new Set(templates.map((t) => t.languageCode))];

  if (loading)
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {tr("加载中...")}
      </div>
    );
  if (error)
    return (
      <div className="flex items-center justify-center py-16">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
          {error}
        </div>
      </div>
    );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{tr("邮件模板")}</CardTitle>
          <CardDescription>{tr("管理组织邮件模板")}</CardDescription>
        </div>
        <Dialog onOpenChange={setCreateOpen} open={createOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <AppIcon className="size-3.5" name="file" />
              {tr("添加模板")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("创建邮件模板")}</DialogTitle>
            </DialogHeader>
            <CreateTemplateForm
              organizationId={organizationId}
              onDone={() => {
                setCreateOpen(false);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {msg && !error && (
          <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {msg}
          </div>
        )}

        {availableLanguages.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(["all", ...availableLanguages] as LanguageFilter[]).map(
              (lang) => (
                <Button
                  key={lang}
                  onClick={() => setLanguageFilter(lang)}
                  size="xs"
                  variant={languageFilter === lang ? "secondary" : "ghost"}
                >
                  {tr(LANGUAGE_LABELS[lang] || lang)}
                </Button>
              ),
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm">
            {tr("暂无邮件模板。点击“添加模板”创建第一个。")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <div
                key={t.id}
                className="flex min-h-44 flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm">{t.name}</div>
                    <Badge className="text-xs" variant="outline">
                      {t.languageCode}
                    </Badge>
                  </div>
                  {t.subject && (
                    <div className="text-xs line-clamp-1">{t.subject}</div>
                  )}
                  {t.mjml && (
                    <div className="text-xs line-clamp-2 font-mono opacity-70">
                      {t.mjml.replace(/<[^>]*>/g, "").slice(0, 120)}
                    </div>
                  )}
                  {!t.mjml && t.hbs && (
                    <div className="text-xs line-clamp-2 font-mono opacity-70">
                      {t.hbs.slice(0, 120)}
                    </div>
                  )}
                  <div className="text-xs">
                    {t.organizationId ? tr("组织模板") : tr("全局模板")}
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-1">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditTemplate(t);
                    }}
                    size="xs"
                    variant="ghost"
                  >
                    {tr("编辑")}
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTemplate(t);
                    }}
                    size="xs"
                    variant="destructive"
                  >
                    {tr("删除")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Edit dialog */}
      {editTemplate && (
        <Dialog
          onOpenChange={(o) => {
            if (!o) setEditTemplate(null);
          }}
          open={true}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{tr("编辑模板")}</DialogTitle>
            </DialogHeader>
            <EditTemplateForm
              organizationId={organizationId}
              template={editTemplate}
              onDone={() => {
                setEditTemplate(null);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <ConfirmActionDialog
        confirmLabel={tr("删除")}
        description={t("dialogs.deleteEmailTemplateDescription", {
          name: deleteTemplate?.name ?? "",
        })}
        onConfirm={() => {
          if (deleteTemplate) void remove(deleteTemplate.id);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTemplate(null);
        }}
        open={Boolean(deleteTemplate)}
        title={tr("删除邮件模板")}
      />
    </Card>
  );
}

function CreateTemplateForm({
  organizationId,
  onDone,
}: {
  organizationId: string | null;
  onDone: () => void;
}) {
  const tr = useTextTranslation();
  const [name, setName] = useState("");
  const [languageCode, setLanguageCode] = useState("zh-CN");
  const [subject, setSubject] = useState("");
  const [hbs, setHbs] = useState("");
  const [mjml, setMjml] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!name.trim() || !organizationId) return;
    setSaving(true);
    setMsg("");
    try {
      const token = await requireAuthenticatedAdminToken();
      await createEmailTemplate(
        token,
        organizationId,
        {
          name: name.trim(),
          languageCode,
          subject: subject.trim() || null,
          hbs: hbs.trim(),
          mjml: mjml.trim() || null,
        },
      );
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr("创建失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>{tr("模板名称")}</Label>
          <Input
            onChange={(e) => setName(e.target.value)}
            placeholder="welcome-user"
            value={name}
          />
        </div>
        <div className="grid gap-2">
          <Label>{tr("语言")}</Label>
          <Select onValueChange={setLanguageCode} value={languageCode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{tr("简体中文")}</SelectItem>
              <SelectItem value="zh-Hans">{tr("简体中文")}</SelectItem>
              <SelectItem value="zh-Hant">{tr("繁體中文")}</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>{tr("邮件主题")}</Label>
        <Input
          onChange={(e) => setSubject(e.target.value)}
          placeholder={tr("欢迎加入 {{orgName}}")}
          value={subject}
        />
      </div>
      <div className="grid gap-2">
        <Label>{tr("HBS 模板内容")}</Label>
        <Textarea
          className="font-mono text-xs"
          onChange={(e) => setHbs(e.target.value)}
          placeholder={tr("Handlebars 模板...")}
          rows={6}
          value={hbs}
        />
      </div>
      <div className="grid gap-2">
        <Label>{tr("MJML (可选)")}</Label>
        <Textarea
          className="font-mono text-xs"
          onChange={(e) => setMjml(e.target.value)}
          placeholder="MJML markup..."
          rows={4}
          value={mjml}
        />
      </div>
      {msg && <div className="text-sm">{msg}</div>}
      <Button disabled={saving || !name.trim() || !hbs.trim()} onClick={submit}>
        {saving ? tr("创建中...") : tr("创建模板")}
      </Button>
    </div>
  );
}

function EditTemplateForm({
  organizationId,
  template,
  onDone,
}: {
  organizationId: string | null;
  template: EmailTemplateDto;
  onDone: () => void;
}) {
  const tr = useTextTranslation();
  const [name, setName] = useState(template.name);
  const [languageCode, setLanguageCode] = useState(template.languageCode);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [hbs, setHbs] = useState(template.hbs);
  const [mjml, setMjml] = useState(template.mjml ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      if (!organizationId) return;
      const token = await requireAuthenticatedAdminToken();
      await updateEmailTemplate(
        token,
        organizationId,
        template.id,
        {
          name: name.trim(),
          languageCode,
          subject: subject.trim() || null,
          hbs: hbs.trim(),
          mjml: mjml.trim() || null,
        },
      );
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>{tr("模板名称")}</Label>
          <Input onChange={(e) => setName(e.target.value)} value={name} />
        </div>
        <div className="grid gap-2">
          <Label>{tr("语言")}</Label>
          <Select onValueChange={setLanguageCode} value={languageCode}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{tr("简体中文")}</SelectItem>
              <SelectItem value="zh-Hans">{tr("简体中文")}</SelectItem>
              <SelectItem value="zh-Hant">{tr("繁體中文")}</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>{tr("邮件主题")}</Label>
        <Input onChange={(e) => setSubject(e.target.value)} value={subject} />
      </div>
      <div className="grid gap-2">
        <Label>{tr("HBS 模板内容")}</Label>
        <Textarea
          className="font-mono text-xs"
          onChange={(e) => setHbs(e.target.value)}
          rows={6}
          value={hbs}
        />
      </div>
      <div className="grid gap-2">
        <Label>{tr("MJML (可选)")}</Label>
        <Textarea
          className="font-mono text-xs"
          onChange={(e) => setMjml(e.target.value)}
          rows={4}
          value={mjml}
        />
      </div>
      {msg && <div className="text-sm">{msg}</div>}
      <Button disabled={saving} onClick={submit}>
        {tr("保存")}
      </Button>
    </div>
  );
}
