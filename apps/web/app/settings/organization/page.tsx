"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getSnapshot, type Organization } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function OrganizationPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    try {
      const snap = await getSnapshot(session.token);
      setOrg(snap.organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  }
  if (error) {
    return <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>;
  }
  if (!org) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">无法加载组织信息</div>;
  }

  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">组织常规</h1>
        <p className="text-sm text-muted-foreground">当前组织的基本信息和运行状态</p>
      </div>
      <Separator />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">组织信息</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>组织 ID</Label>
              <p className="break-all font-mono text-xs text-muted-foreground">{org.id}</p>
            </div>
            <div className="space-y-2">
              <Label>名称</Label>
              <Input defaultValue={org.name} readOnly />
            </div>
            <div className="space-y-2">
              <Label>标识</Label>
              <Input defaultValue={org.slug} readOnly />
            </div>
            <div className="space-y-2">
              <Label>子域名</Label>
              <Input defaultValue={org.subdomain ?? ""} readOnly />
            </div>
            <div className="space-y-2">
              <Label>状态</Label>
              <div>
                <Badge variant={org.status === "active" ? "default" : "destructive"}>
                  {org.status === "active" ? "启用" : "已停用"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">当前范围</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">组织</span>
              <span className="truncate font-medium">{org.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">标识</span>
              <span className="truncate font-mono text-xs">{org.slug}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">状态</span>
              <Badge variant={org.status === "active" ? "default" : "secondary"}>
                {org.status === "active" ? "启用" : "已停用"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
