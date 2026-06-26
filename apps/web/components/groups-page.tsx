"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAdmin } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

type GroupDto = { id: string; name: string; description: string | null; organizationId: string; createdAt: string; updatedAt: string };

export function GroupsPage() {
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      const data = await fetchAdmin<GroupDto[]>("/groups", { token: session.token });
      setGroups(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!name.trim()) { setError("名称不能为空"); return; }
    const session = getStoredSession();
    if (!session?.token) return;
    setCreating(true);
    setError(null);
    try {
      await fetchAdmin<GroupDto>("/groups", { body: { name: name.trim(), description: description.trim() || null }, method: "POST", token: session.token });
      setName(""); setDescription(""); setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally { setCreating(false); }
  }

  async function remove(groupId: string) {
    const session = getStoredSession();
    if (!session?.token) return;
    try {
      await fetchAdmin<void>(`/groups/${groupId}`, { method: "DELETE", token: session.token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><span className="text-sm text-text-secondary">加载中...</span></div>;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">用户组</h1>
          <p className="mt-0.5 text-sm text-text-secondary">管理组织内的用户组</p>
        </div>
        <button className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90" onClick={() => setShowCreate(true)} type="button">创建用户组</button>
      </div>

      <div className="p-6">
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {showCreate && (
          <div className="mb-6 rounded-lg border border-border p-5">
            <h3 className="text-sm font-semibold text-text-primary">创建用户组</h3>
            <div className="mt-3 space-y-3">
              <label className="block"><span className="text-sm font-medium text-text-secondary">名称 <span className="text-red-500">*</span></span>
                <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setName(e.target.value)} placeholder="用户组名称" type="text" value={name} />
              </label>
              <label className="block"><span className="text-sm font-medium text-text-secondary">描述</span>
                <input className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" onChange={(e) => setDescription(e.target.value)} placeholder="可选描述" type="text" value={description} />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50" disabled={creating} onClick={create} type="button">{creating ? "创建中..." : "创建"}</button>
              <button className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text-secondary hover:bg-hover-bg" onClick={() => setShowCreate(false)} type="button">取消</button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-secondary text-left">
                <th className="px-4 py-3 font-medium text-text-secondary">名称</th>
                <th className="px-4 py-3 font-medium text-text-secondary">描述</th>
                <th className="px-4 py-3 font-medium text-text-secondary">创建时间</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr className="border-b border-border last:border-0" key={g.id}>
                  <td className="px-4 py-3 font-medium text-text-primary">{g.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{g.description ?? "—"}</td>
                  <td className="px-4 py-3 text-text-secondary">{new Date(g.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button className="text-xs font-medium text-red-600 hover:text-red-800" onClick={() => remove(g.id)} type="button">删除</button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td className="px-4 py-8 text-center text-text-secondary" colSpan={4}>暂无用户组</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
