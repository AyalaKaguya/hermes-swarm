"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmailTemplatePreview } from "@/components/email-template-preview";
import { InlineNotice } from "@/components/inline-notice";
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
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
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
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await listEmailTemplates(token);
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(templateId: string) {
    try {
      await deleteEmailTemplate(
        await requireAuthenticatedAdminSessionMarker(),
        templateId,
      );
      setMsg(
        deleteTemplate?.hasPlatformDefault
          ? tr("已恢复系统默认")
          : tr("已删除"),
      );
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
        <InlineNotice className="max-w-xl" tone="error">{error}</InlineNotice>
      </div>
    );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>{tr("邮件模板")}</CardTitle>
          <CardDescription>{tr("管理工作空间邮件模板")}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/custom-smtp">{tr("SMTP 设置")}</Link>
          </Button>
        <Dialog onOpenChange={setCreateOpen} open={createOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <AppIcon className="size-3.5" name="file" />
              {tr("添加模板")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>{tr("创建邮件模板")}</DialogTitle>
            </DialogHeader>
            <CreateTemplateForm
              onDone={() => {
                setCreateOpen(false);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {msg && !error && <InlineNotice className="mb-4" tone="success">{msg}</InlineNotice>}

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
                    <div className="flex flex-wrap justify-end gap-1">
                      {t.isSystem && (
                        <Badge className="text-xs" variant="secondary">
                          {tr("系统模板")}
                        </Badge>
                      )}
                      {t.inherited ? (
                        <Badge className="text-xs" variant="outline">
                          {tr("系统默认")}
                        </Badge>
                      ) : t.hasPlatformDefault ? (
                        <Badge className="text-xs" variant="outline">
                          {tr("工作空间自定义模板")}
                        </Badge>
                      ) : null}
                      <Badge className="text-xs" variant="outline">
                        {t.languageCode}
                      </Badge>
                    </div>
                  </div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground">
                      {tr(t.description)}
                    </div>
                  )}
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
                    {t.inherited
                      ? tr("当前使用系统默认内容")
                      : t.hasPlatformDefault
                        ? tr("当前使用工作空间模板")
                        : tr("工作空间自定义模板")}
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
                    {t.inherited ? tr("创建工作空间模板") : tr("编辑与预览")}
                  </Button>
                  <Button
                    disabled={t.inherited}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTemplate(t);
                    }}
                    size="xs"
                    variant="destructive"
                  >
                    {t.hasPlatformDefault ? tr("恢复默认") : tr("删除")}
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
          <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {editTemplate.inherited ? tr("创建工作空间模板") : tr("编辑模板")}
              </DialogTitle>
            </DialogHeader>
            <EditTemplateForm
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
        confirmLabel={
          deleteTemplate?.hasPlatformDefault ? tr("恢复默认") : tr("删除")
        }
        description={
          deleteTemplate?.hasPlatformDefault
            ? tr("删除工作空间模板后，将重新使用对应语言的系统模板。")
            : t("dialogs.deleteEmailTemplateDescription", {
                name: deleteTemplate?.name ?? "",
              })
        }
        onConfirm={() => {
          if (deleteTemplate) void remove(deleteTemplate.id);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTemplate(null);
        }}
        open={Boolean(deleteTemplate)}
        title={
          deleteTemplate?.hasPlatformDefault
            ? tr("恢复系统默认")
            : tr("删除邮件模板")
        }
      />
    </Card>
  );
}

function CreateTemplateForm({ onDone }: { onDone: () => void }) {
  const tr = useTextTranslation();
  const [name, setName] = useState("");
  const [languageCode, setLanguageCode] = useState("zh-CN");
  const [subject, setSubject] = useState("");
  const [hbs, setHbs] = useState("");
  const [mjml, setMjml] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    setMsg("");
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await createEmailTemplate(
        token,
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1fr)]">
      <div className="grid content-start gap-4">
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
            placeholder={tr("欢迎加入 {{organizationName}}")}
            value={subject}
          />
        </div>
        <div className="grid gap-2">
          <Label>{tr("HBS 模板内容")}</Label>
          <Textarea
            className="font-mono text-xs"
            onChange={(e) => setHbs(e.target.value)}
            placeholder={tr("Handlebars 模板...")}
            rows={9}
            value={hbs}
          />
        </div>
        <div className="grid gap-2">
          <Label>{tr("MJML (可选)")}</Label>
          <Textarea
            className="font-mono text-xs"
            onChange={(e) => setMjml(e.target.value)}
            placeholder={tr("MJML 标记...")}
            rows={3}
            value={mjml}
          />
        </div>
        {msg && <div className="text-sm text-destructive">{msg}</div>}
        <Button
          disabled={saving || !name.trim() || !hbs.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? tr("创建中...") : tr("创建模板")}
        </Button>
      </div>
      <EmailTemplatePreview hbs={hbs} subject={subject} />
    </div>
  );
}

function EditTemplateForm({
  template,
  onDone,
}: {
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
      const token = await requireAuthenticatedAdminSessionMarker();
      const payload = {
        description: template.description,
        name: name.trim(),
        languageCode,
        subject: subject.trim() || null,
        hbs: hbs.trim(),
        mjml: mjml.trim() || null,
      };
      if (template.inherited) {
        await createEmailTemplate(token, payload);
      } else {
        await updateEmailTemplate(token, template.id, payload);
      }
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1fr)]">
      <div className="grid content-start gap-4">
        <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>{tr("模板名称")}</Label>
          <Input
            disabled={template.isSystem || template.hasPlatformDefault}
            onChange={(e) => setName(e.target.value)}
            value={name}
          />
        </div>
        <div className="grid gap-2">
          <Label>{tr("语言")}</Label>
          <Select
            disabled={template.isSystem || template.hasPlatformDefault}
            onValueChange={setLanguageCode}
            value={languageCode}
          >
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
          rows={9}
          value={hbs}
        />
        </div>
        <div className="grid gap-2">
        <Label>{tr("MJML (可选)")}</Label>
        <Textarea
          className="font-mono text-xs"
          onChange={(e) => setMjml(e.target.value)}
          rows={3}
          value={mjml}
        />
        </div>
        {msg && <div className="text-sm text-destructive">{msg}</div>}
        <Button
          disabled={saving || !hbs.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {template.inherited ? tr("创建工作空间模板") : tr("保存")}
        </Button>
      </div>
      <EmailTemplatePreview hbs={hbs} subject={subject} />
    </div>
  );
}
