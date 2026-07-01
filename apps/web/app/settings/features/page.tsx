"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  FEATURE_SETTING_DEFINITIONS,
} from "@hermes-swarm/core/settings/definitions";
import {
  listOrganizationSettings,
  saveOrganizationSettings,
  type OrganizationSetting,
} from "@/lib/admin-api";
import { usePermission } from "@/hooks/use-permission";
import { getStoredSession } from "@/lib/session";

export default function FeaturesPage() {
  const { resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const [settings, setSettings] = useState<OrganizationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [msg, setMsg] = useState("");
  const canManageFeatures =
    snapshot && resolvedSession
      ? access.hasPermission("setting.organization_config.save:organization")
      : false;
  const organizationFeatures = FEATURE_SETTING_DEFINITIONS.filter(
    (definition) => definition.scope === "organization",
  );
  const organizationId = snapshot?.organization?.id ?? null;

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !organizationId) {
      setLoading(false);
      return;
    }
    try {
      const settingItems = await listOrganizationSettings(
        session.token,
        organizationId,
      );
      setSettings(settingItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function getSettingValue(key: string): string {
    return settings.find((setting) => setting.name === key)?.value ?? "";
  }

  function getSettingId(key: string): string | undefined {
    return settings.find((setting) => setting.name === key)?.id;
  }

  async function toggleFeature(key: string, enabled: boolean) {
    const session = getStoredSession();
    if (!session?.token || !organizationId) return;
    const payload = {
      settings: [{ name: key, value: enabled, valueType: "boolean" }],
    };
    setError(null);
    setMsg("");
    try {
      await saveOrganizationSettings(session.token, organizationId, payload);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function refresh() {
    setUpgrading(true);
    setError(null);
    setMsg("");
    try {
      await load();
      setMsg("刷新成功");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setUpgrading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>功能管理</CardTitle>
          <CardDescription>管理当前组织的功能开关</CardDescription>
        </div>
        <Button
          disabled={upgrading}
          onClick={refresh}
          size="sm"
          variant="outline"
        >
          <AppIcon className="size-3.5" name="refresh" />
          {upgrading ? "刷新中..." : "刷新"}
        </Button>
      </CardHeader>
      <CardContent>
        {msg && !error && (
          <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {msg}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-2">
          {organizationFeatures.map((feature) => {
            const currentValue = getSettingValue(feature.key);
            const isEnabled = currentValue === "true";
            const id = getSettingId(feature.key);

            return (
              <div
                className="grid gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30 md:grid-cols-[1fr_auto]"
                key={feature.key}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {feature.label}
                    </span>
                    <Badge className="text-xs" variant="outline">
                      {feature.scope}
                    </Badge>
                    {id && (
                      <span className="font-mono text-xs text-muted-foreground">
                        #{id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
                <div className="flex items-center justify-end">
                  <Switch
                    checked={isEnabled}
                    disabled={!canManageFeatures}
                    onCheckedChange={(checked) =>
                      toggleFeature(feature.key, checked)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
