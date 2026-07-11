"use client";

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { Spinner } from "@/components/ui/spinner";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { previewEmailTemplate } from "@/lib/admin-api";
import { getAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";

export function EmailTemplatePreview({
  hbs,
  organizationId,
  subject,
}: {
  hbs: string;
  organizationId?: string | null;
  subject: string;
}) {
  const tr = useTextTranslation();
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hbs.trim()) {
      setPreview(null);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const session = await getAuthenticatedAdminSessionMarker();
        if (!session) return;
        const result = await previewEmailTemplate(
          session,
          { hbs, subject: subject || null },
          organizationId ?? undefined,
        );
        if (!cancelled) {
          setPreview(result);
          setError("");
        }
      } catch (previewError) {
        if (!cancelled) {
          setError(
            previewError instanceof Error
              ? previewError.message
              : tr("预览失败"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hbs, organizationId, subject, tr]);

  return (
    <section className="grid min-h-80 overflow-hidden rounded-lg border bg-background">
      <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AppIcon className="size-4" name="mail" />
          {tr("邮件预览")}
        </div>
        {loading && <Spinner className="size-3.5" />}
      </header>
      <div className="grid grid-rows-[auto_1fr]">
        <div className="border-b px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {tr("邮件主题")}
          </div>
          <div className="mt-1 min-h-5 text-sm">
            {preview?.subject || tr("暂无主题")}
          </div>
        </div>
        {error ? (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : preview ? (
          <iframe
            className="h-full min-h-64 w-full bg-white"
            sandbox=""
            srcDoc={preview.html}
            title={tr("邮件正文预览")}
          />
        ) : (
          <div className="flex min-h-64 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {tr("输入模板内容后将在这里显示预览。")}
          </div>
        )}
      </div>
      <footer className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {tr("预览使用示例收件人、组织名称和链接变量。")}
      </footer>
    </section>
  );
}
