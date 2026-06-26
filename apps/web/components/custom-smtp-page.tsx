"use client";

import { useState, useEffect, useCallback } from "react";
import { getSmtpConfig, saveSmtpConfig, type SmtpConfig } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export function CustomSmtpPage() {
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    fromAddress: "",
  });

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      const data = await getSmtpConfig(session.token);
      setConfig(data ?? null);
      if (data) {
        setForm({
          host: data.host ?? "",
          port: data.port ?? 587,
          secure: data.secure ?? false,
          username: data.username ?? "",
          password: "",
          fromAddress: data.fromAddress ?? "",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    const session = getStoredSession();
    if (!session?.token) return;
    if (!form.host.trim()) { setError("SMTP Host 不能为空"); return; }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await saveSmtpConfig(session.token, {
        host: form.host,
        port: form.port,
        secure: form.secure,
        username: form.username || null,
        password: form.password || null,
        fromAddress: form.fromAddress || null,
      });
      setConfig(result);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><span className="text-sm text-text-secondary">加载中...</span></div>;

  return (
    <div className="flex flex-col">
      <div className="border-b border-border px-6 py-6">
        <h1 className="text-lg font-semibold text-text-primary">自定义 SMTP</h1>
        <p className="mt-0.5 text-sm text-text-secondary">配置 SMTP 服务器用于发送系统邮件</p>
      </div>
      <div className="p-6 max-w-[600px]">
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">SMTP 配置已保存</div>}
        <div className="space-y-4">
          <label className="block"><span className="text-sm font-medium text-text-secondary">SMTP Host <span className="text-red-500">*</span></span>
            <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setForm(f => ({...f, host: e.target.value}))} placeholder="smtp.example.com" type="text" value={form.host} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block"><span className="text-sm font-medium text-text-secondary">端口</span>
              <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setForm(f => ({...f, port: Number(e.target.value)}))} type="number" value={form.port} />
            </label>
            <label className="flex items-center gap-2 pt-6">
              <input checked={form.secure} className="h-4 w-4 rounded border-border text-brand focus:ring-brand" onChange={(e) => setForm(f => ({...f, secure: e.target.checked}))} type="checkbox" />
              <span className="text-sm text-text-secondary">使用 SSL/TLS</span>
            </label>
          </div>
          <label className="block"><span className="text-sm font-medium text-text-secondary">发件地址</span>
            <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setForm(f => ({...f, fromAddress: e.target.value}))} placeholder="noreply@example.com" type="email" value={form.fromAddress} />
          </label>
          <label className="block"><span className="text-sm font-medium text-text-secondary">用户名</span>
            <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setForm(f => ({...f, username: e.target.value}))} placeholder="SMTP 用户名" type="text" value={form.username} />
          </label>
          <label className="block"><span className="text-sm font-medium text-text-secondary">密码</span>
            <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setForm(f => ({...f, password: e.target.value}))} placeholder={config ? "留空表示不修改" : "SMTP 密码"} type="password" value={form.password} />
          </label>
        </div>
        <div className="mt-6 flex gap-2">
          <button className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50" disabled={saving} onClick={save} type="button">{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
