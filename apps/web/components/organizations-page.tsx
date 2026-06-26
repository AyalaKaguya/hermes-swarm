"use client";

import { useState, useEffect, useCallback } from "react";
import { getSnapshot, type Organization } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

type Tab = "general" | "members" | "settings";

export function OrganizationsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("general");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      const snapshot = await getSnapshot(session.token);
      setOrg(snapshot.organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <span className="text-sm text-text-secondary">加载中...</span>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center py-16">
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
    </div>
  );

  if (!org) return (
    <div className="flex items-center justify-center py-16">
      <span className="text-sm text-text-secondary">无法加载组织信息</span>
    </div>
  );

  const statusLabel = org.status === "active" ? "启用" : "已停用";

  return (
    <div className="flex min-h-full w-full flex-col">
      <div className="px-8 py-6">
        <h1 className="text-lg font-semibold text-text-primary">{org.name}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          组织标识：{org.slug}
        </p>
      </div>

      <nav className="flex border-b border-border px-8">
        {(["general", "members", "settings"] as Tab[]).map((t) => (
          <button
            className={
              tab === t
                ? "border-b-2 border-brand px-4 py-3 text-sm font-medium text-brand"
                : "border-b-2 border-transparent px-4 py-3 text-sm font-medium text-text-secondary hover:text-text-primary"
            }
            key={t}
            onClick={() => setTab(t)}
            type="button"
          >
            {t === "general" ? "通用" : t === "members" ? "成员" : "设置"}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="min-w-0 flex-1 p-8">
        {tab === "general" && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            {/* Main form */}
            <div className="grid gap-x-6 gap-y-7 md:grid-cols-2">
              {/* Organization ID (read-only) */}
              <div className="md:col-span-2">
                <span className="text-sm text-text-tertiary">组织 ID</span>
                <div className="break-all text-base text-text-primary">{org.id}</div>
              </div>

              {/* Name */}
              <label className="md:col-span-2 block">
                <span className="text-sm font-medium text-text-secondary">名称</span>
                <input
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  defaultValue={org.name}
                  readOnly
                  type="text"
                />
              </label>

              {/* Slug */}
              <label className="block">
                <span className="text-sm font-medium text-text-secondary">标识 (Slug)</span>
                <input
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  defaultValue={org.slug}
                  readOnly
                  type="text"
                />
              </label>

              {/* Subdomain */}
              <label className="block">
                <span className="text-sm font-medium text-text-secondary">子域名</span>
                <input
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  defaultValue={org.subdomain ?? ""}
                  readOnly
                  type="text"
                />
              </label>

              {/* Status */}
              <label className="block">
                <span className="text-sm font-medium text-text-secondary">状态</span>
                <input
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  defaultValue={statusLabel}
                  readOnly
                  type="text"
                />
              </label>
            </div>

            {/* Sidebar info */}
            <aside className="space-y-4">
              <div className="rounded-lg border border-border bg-surface-secondary/50 p-4">
                <h3 className="text-sm font-semibold text-text-primary">组织概览</h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">状态</dt>
                    <dd>
                      <span className={org.status === "active" ? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 border border-green-200" : "inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-200"}>
                        {statusLabel}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">创建时间</dt>
                    <dd className="text-text-primary">—</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        )}

        {tab === "members" && (
          <div className="rounded-lg border border-border bg-surface-secondary/30 p-8 text-center">
            <p className="text-sm text-text-secondary">
              成员管理功能由「用户」设置页面提供。
              <br />
              请前往设置 → 用户 管理组织成员。
            </p>
          </div>
        )}

        {tab === "settings" && (
          <div className="rounded-lg border border-border bg-surface-secondary/30 p-8 text-center">
            <p className="text-sm text-text-secondary">
              组织设置功能由「功能」设置页面提供。
              <br />
              请前往设置 → 功能 管理系统配置项。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
