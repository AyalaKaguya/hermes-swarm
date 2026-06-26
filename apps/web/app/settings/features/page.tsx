"use client";

import { useState, useEffect, useCallback } from "react";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { listSystemSettings, saveSystemSettings, type SystemSettingDto } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

const FEATURE_DEFINITIONS = [
  { key: "feature:email:enabled", label: "邮件功能", description: "启用或禁用组织邮件发送能力", scope: "organization" },
  { key: "feature:invite:enabled", label: "邀请功能", description: "允许通过邮件邀请新用户加入组织", scope: "organization" },
  { key: "feature:password-reset:enabled", label: "密码重置", description: "允许用户通过邮件重置密码", scope: "organization" },
  { key: "feature:org-management:enabled", label: "组织管理", description: "启用组织级别的管理功能", scope: "system" },
  { key: "system:maintenance:enabled", label: "维护模式", description: "开启后仅管理员可访问系统", scope: "system" },
  { key: "system:registration:open", label: "开放注册", description: "允许新用户自行注册", scope: "system" },
];

export default function FeaturesPage() {
  const [settings, setSettings] = useState<SystemSettingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      setSettings(await listSystemSettings(session.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function getSettingValue(key: string): string {
    return settings.find(s => s.name === key)?.value ?? "";
  }

  function getSettingId(key: string): string | undefined {
    return settings.find(s => s.name === key)?.id;
  }

  async function toggleFeature(key: string, enabled: boolean) {
    const session = getStoredSession();
    if (!session?.token) return;
    const payload = {
      settings: [{ name: key, value: String(enabled) }],
    };
    try {
      await saveSystemSettings(session.token, payload);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function saveCustomSetting(key: string, value: string) {
    const session = getStoredSession();
    if (!session?.token) return;
    try {
      await saveSystemSettings(session.token, { settings: [{ name: key, value }] });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function upgrade() {
    setUpgrading(true); setError(null); setMsg("");
    try {
      await load();
      setMsg("刷新成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    } finally { setUpgrading(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>功能管理</CardTitle>
          <CardDescription>管理系统功能开关与全局配置</CardDescription>
        </div>
        <Button disabled={upgrading} onClick={upgrade} size="sm" variant="outline">
          <AppIcon className="size-3.5" name="refresh" />
          {upgrading ? "刷新中..." : "刷新"}
        </Button>
      </CardHeader>
      <CardContent>
        {msg && !error && <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">{msg}</div>}
        {error && <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        <div className="grid max-w-2xl gap-2">
          {FEATURE_DEFINITIONS.map(feat => {
            const currentValue = getSettingValue(feat.key);
            const isEnabled = currentValue === "true";
            const id = getSettingId(feat.key);

            return (
              <div key={feat.key} className="flex items-center justify-between gap-4 rounded-md border p-3 transition-colors hover:bg-muted/30">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{feat.label}</span>
                    <Badge className="text-xs" variant="outline">{feat.scope}</Badge>
                    {id && <span className="text-xs text-muted-foreground font-mono">#{id.slice(0, 8)}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{feat.description}</span>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => toggleFeature(feat.key, checked)}
                />
              </div>
            );
          })}
        </div>

        {settings.filter(s => !FEATURE_DEFINITIONS.some(f => f.key === s.name)).length > 0 && (
          <>
            <Separator className="my-6" />
            <div className="max-w-2xl space-y-3">
              <div className="text-sm font-medium">自定义设置</div>
              {settings
                .filter(s => !FEATURE_DEFINITIONS.some(f => f.key === s.name))
                .map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div>
                      <div className="text-sm font-medium font-mono">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.scope}</div>
                    </div>
                    <Input
                      className="h-8 w-48 text-xs font-mono"
                      defaultValue={s.value ?? ""}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val !== (s.value ?? "")) {
                          saveCustomSetting(s.name, val);
                        }
                      }}
                    />
                  </div>
                ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
