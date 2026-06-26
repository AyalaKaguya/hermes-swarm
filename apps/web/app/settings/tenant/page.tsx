"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getSnapshot, type Organization } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function TenantPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subdomain, setSubdomain] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    setToken(session.token);
    try {
      const snap = await getSnapshot(session.token);
      setOrg(snap.organization);
      setName(snap.organization.name);
      setSlug(snap.organization.slug);
      setSubdomain(snap.organization.subdomain ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true); setError(null); setMsg("");
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, subdomain: subdomain || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || "保存失败"); }
      setMsg("保存成功");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  if (!org) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">无法加载组织信息</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>租户信息</CardTitle>
        <CardDescription>管理组织基本信息和标识</CardDescription>
      </CardHeader>
      <CardContent>
        {msg && !error && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{msg}</div>}
        {error && <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
        <div className="grid gap-4 max-w-lg">
          <div className="grid gap-2"><Label>组织名称</Label><Input onChange={(e) => setName(e.target.value)} value={name} /></div>
          <div className="grid gap-2"><Label>标识符 (slug)</Label><Input onChange={(e) => setSlug(e.target.value)} value={slug} /></div>
          <div className="grid gap-2"><Label>子域名</Label><Input onChange={(e) => setSubdomain(e.target.value)} placeholder="可选" value={subdomain} /></div>
          <Separator />
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>状态: <Badge variant={org.status === "active" ? "default" : "secondary"}>{org.status === "active" ? "活跃" : "已暂停"}</Badge></span>
            <span>ID: <code className="text-xs">{org.id}</code></span>
          </div>
          <Button onClick={save} disabled={saving} className="w-fit">{saving ? "保存中..." : "保存"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
