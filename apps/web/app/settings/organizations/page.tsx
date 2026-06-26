"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSnapshot, type Organization } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function Page() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try { const snap = await getSnapshot(session.token); setOrg(snap.organization); }
    catch (err) { setError(err instanceof Error ? err.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="flex items-center justify-center py-16"><div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div></div>;
  if (!org) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">无法加载组织信息</div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div><h1 className="text-lg font-semibold">{org.name}</h1><p className="text-sm text-muted-foreground">标识：{org.slug}</p></div>
      <Separator />

      <Tabs defaultValue="general">
        <TabsList><TabsTrigger value="general">通用</TabsTrigger><TabsTrigger value="members">成员</TabsTrigger><TabsTrigger value="settings">设置</TabsTrigger></TabsList>

        <TabsContent className="mt-4" value="general">
          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">组织信息</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1"><Label>组织 ID</Label><p className="text-sm font-mono break-all">{org.id}</p></div>
                <div className="space-y-2"><Label>名称</Label><Input defaultValue={org.name} readOnly /></div>
                <div className="space-y-2"><Label>标识 (Slug)</Label><Input defaultValue={org.slug} readOnly /></div>
                <div className="space-y-2"><Label>子域名</Label><Input defaultValue={org.subdomain ?? ""} readOnly /></div>
                <div className="space-y-2"><Label>状态</Label><Input defaultValue={org.status === "active" ? "启用" : "已停用"} readOnly /></div>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-3"><CardTitle className="text-base">概览</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">状态</span><Badge variant={org.status === "active" ? "default" : "destructive"}>{org.status === "active" ? "启用" : "已停用"}</Badge></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="mt-4" value="members"><Card><CardContent className="py-8 text-center text-sm text-muted-foreground">成员管理由「用户」设置页面提供。<br />请前往 设置 → 用户 管理组织成员。</CardContent></Card></TabsContent>

        <TabsContent className="mt-4" value="settings"><Card><CardContent className="py-8 text-center text-sm text-muted-foreground">组织设置由「功能」页面提供。<br />请前往 设置 → 功能 管理系统配置项。</CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}
