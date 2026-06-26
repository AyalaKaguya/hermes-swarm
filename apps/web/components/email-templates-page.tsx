"use client";

import { useState, useEffect, useCallback } from "react";
import { listEmailTemplates, type EmailTemplateDto } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      const data = await listEmailTemplates(session.token);
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center py-16"><span className="text-sm text-text-secondary">加载中...</span></div>;

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-6 py-6">
        <h1 className="text-lg font-semibold text-text-primary">邮件模板</h1>
        <p className="mt-0.5 text-sm text-text-secondary">管理邮件通知模板</p>
      </div>
      <div className="p-6">
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary text-left">
                <th className="px-4 py-3 font-medium text-text-secondary">名称</th>
                <th className="px-4 py-3 font-medium text-text-secondary">语言</th>
                <th className="px-4 py-3 font-medium text-text-secondary">主题</th>
                <th className="px-4 py-3 font-medium text-text-secondary">组织</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr className="border-b border-border last:border-0" key={t.id}>
                  <td className="px-4 py-3 font-medium text-text-primary">{t.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{t.languageCode}</td>
                  <td className="px-4 py-3 text-text-secondary">{t.subject ?? "—"}</td>
                  <td className="px-4 py-3 text-text-secondary">{t.organizationId ? "组织" : "全局"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {templates.length === 0 && <div className="py-8 text-center text-sm text-text-secondary">暂无模板数据</div>}
      </div>
    </div>
  );
}
