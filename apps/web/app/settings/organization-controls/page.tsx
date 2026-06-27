"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  listOrganizationSettings,
  saveOrganizationSettings,
  type OrganizationSetting,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

const CONTROL_KEYS = [
  { key: "auth.passwordPolicy.minLength", label: "密码最小长度" },
  { key: "organization.defaultLanguage", label: "默认语言" },
  { key: "organization.defaultTimeZone", label: "默认时区" },
];

export default function OrganizationControlsPage() {
  const [settings, setSettings] = useState<OrganizationSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    try {
      const items = await listOrganizationSettings(session.token);
      setSettings(items);
      setValues(Object.fromEntries(CONTROL_KEYS.map((item) => [
        item.key,
        items.find((setting) => setting.name === item.key)?.value ?? "",
      ])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customSettings = useMemo(
    () => settings.filter((setting) => !CONTROL_KEYS.some((item) => item.key === setting.name)),
    [settings],
  );

  async function save() {
    const session = getStoredSession();
    if (!session?.token) return;
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      await saveOrganizationSettings(session.token, {
        settings: CONTROL_KEYS.map((item) => ({ name: item.key, value: values[item.key] ?? "" })),
      });
      setMessage("保存成功");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  }

  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">组织控制项</h1>
        <p className="text-sm text-muted-foreground">组织范围内的基础策略和值</p>
      </div>
      <Separator />
      {message && <div className="rounded-md border bg-muted/40 px-4 py-2 text-sm">{message}</div>}
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">基础控制项</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {CONTROL_KEYS.map((item) => (
            <div className="grid gap-2 sm:max-w-md" key={item.key}>
              <Label>{item.label}</Label>
              <Input
                onChange={(event) => setValues((current) => ({ ...current, [item.key]: event.target.value }))}
                value={values[item.key] ?? ""}
              />
            </div>
          ))}
          <Button className="w-fit" disabled={saving} onClick={save}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </CardContent>
      </Card>
      {customSettings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">其他设置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {customSettings.map((setting) => (
              <div className="flex justify-between gap-3 rounded-md border px-3 py-2" key={setting.id}>
                <span className="font-mono text-xs">{setting.name}</span>
                <span className="truncate text-muted-foreground">{setting.value ?? "-"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
