"use client";

import { useState } from "react";
import { updateUserPassword } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export function AccountPasswordForm({ userId }: { userId: string }) {
  const [form, setForm] = useState({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setForm({ currentPassword: "", password: "", confirmPassword: "" });
    setError(null);
    setSuccess(false);
  }

  function validate() {
    if (!form.currentPassword) return "请输入当前密码";
    if (form.password.length < 8) return "新密码至少需要 8 位";
    if (form.password !== form.confirmPassword) return "两次输入的密码不一致";
    return null;
  }

  async function save() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const session = getStoredSession();
    if (!session?.token) {
      setError("登录已失效");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await updateUserPassword(session.token, userId, {
        currentPassword: form.currentPassword,
        password: form.password,
      });
      setSuccess(true);
      setForm({ currentPassword: "", password: "", confirmPassword: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center p-4 max-w-[400px] mx-auto">
      {error && (
        <div className="w-full mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="w-full mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          密码已更新
        </div>
      )}

      <div className="w-full space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-text-secondary">当前密码</span>
          <input
            autoComplete="current-password"
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            placeholder="输入当前密码"
            type="password"
            value={form.currentPassword}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-text-secondary">新密码</span>
          <input
            autoComplete="new-password"
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="至少 8 位"
            type="password"
            value={form.password}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-text-secondary">确认新密码</span>
          <input
            autoComplete="new-password"
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            placeholder="再次输入新密码"
            type="password"
            value={form.confirmPassword}
          />
        </label>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text-secondary hover:bg-hover-bg disabled:opacity-50"
          disabled={saving}
          onClick={reset}
          type="button"
        >
          重置
        </button>
        <button
          className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          disabled={saving}
          onClick={save}
          type="button"
        >
          {saving ? "保存中..." : "修改密码"}
        </button>
      </div>
    </div>
  );
}
