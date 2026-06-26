"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchMe, updateUser, type User } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

function useToken() {
  const session = getStoredSession();
  return session?.token ?? null;
}

export function AccountProfileForm() {
  const token = useToken();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    firstName: "",
    lastName: "",
    imageUrl: "",
  });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const me = await fetchMe(token);
      setUser(me.user);
      setForm({
        displayName: me.user.displayName ?? "",
        email: me.user.email ?? "",
        firstName: me.user.firstName ?? "",
        lastName: me.user.lastName ?? "",
        imageUrl: me.user.imageUrl ?? "",
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    if (!user) return;
    setForm({
      displayName: user.displayName ?? "",
      email: user.email ?? "",
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      imageUrl: user.imageUrl ?? "",
    });
    setSuccess(false);
  }

  async function save() {
    if (!token || !user) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await updateUser(token, user.id, {
        displayName: form.displayName,
        email: form.email,
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        imageUrl: form.imageUrl || null,
      });
      setUser(updated);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-sm text-text-secondary">加载中...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-sm text-text-secondary">无法加载用户信息</span>
      </div>
    );
  }

  const dirty =
    form.displayName !== (user.displayName ?? "") ||
    form.email !== (user.email ?? "") ||
    form.firstName !== (user.firstName ?? "") ||
    form.lastName !== (user.lastName ?? "") ||
    form.imageUrl !== (user.imageUrl ?? "");

  return (
    <div className="flex flex-col items-center p-4 max-w-[600px] mx-auto">
      {error && (
        <div className="w-full mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="w-full mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          用户信息已更新
        </div>
      )}

      <div className="w-full space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-text-secondary">显示名称</span>
          <input
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder="显示名称"
            type="text"
            value={form.displayName}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-text-secondary">邮箱</span>
          <input
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="email@example.com"
            type="email"
            value={form.email}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-text-secondary">名</span>
            <input
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              placeholder="名"
              type="text"
              value={form.firstName}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text-secondary">姓</span>
            <input
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              placeholder="姓"
              type="text"
              value={form.lastName}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-text-secondary">头像 URL</span>
          <input
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://..."
            type="url"
            value={form.imageUrl}
          />
        </label>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text-secondary hover:bg-hover-bg disabled:opacity-50"
          disabled={!dirty || saving}
          onClick={reset}
          type="button"
        >
          重置
        </button>
        <button
          className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          disabled={!dirty || saving}
          onClick={save}
          type="button"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
