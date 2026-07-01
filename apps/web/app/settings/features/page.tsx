"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  FEATURE_SETTING_DEFINITIONS,
  type FeatureSettingDefinition,
} from "@hermes-swarm/core/settings/definitions";
import {
  listOrganizationFeatureAccess,
  listOrganizationGroups,
  listOrganizationSettings,
  replaceOrganizationFeatureAccess,
  saveOrganizationSettings,
  type OrganizationFeatureAccess,
  type OrganizationGroup,
  type OrganizationSetting,
} from "@/lib/admin-api";
import { getStoredSession, hasMenuAccess } from "@/lib/session";
import { cn } from "@/lib/utils";

type AccessDialogState = {
  feature: FeatureSettingDefinition;
  groupIds: Set<string>;
};

export default function FeaturesPage() {
  const { resolvedSession, snapshot } = useAdminShell();
  const [settings, setSettings] = useState<OrganizationSetting[]>([]);
  const [groups, setGroups] = useState<OrganizationGroup[]>([]);
  const [featureAccess, setFeatureAccess] = useState<
    OrganizationFeatureAccess[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [msg, setMsg] = useState("");
  const [accessDialog, setAccessDialog] = useState<AccessDialogState | null>(
    null,
  );
  const canManageFeatures =
    snapshot && resolvedSession
      ? hasMenuAccess(snapshot, resolvedSession, "features", "manage")
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
      const [settingItems, groupItems, accessItems] = await Promise.all([
        listOrganizationSettings(session.token, organizationId),
        listOrganizationGroups(session.token, organizationId),
        listOrganizationFeatureAccess(session.token, organizationId),
      ]);
      setSettings(settingItems);
      setGroups(groupItems);
      setFeatureAccess(accessItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupsById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  function getSettingValue(key: string): string {
    return settings.find((setting) => setting.name === key)?.value ?? "";
  }

  function getSettingId(key: string): string | undefined {
    return settings.find((setting) => setting.name === key)?.id;
  }

  function getAccess(key: string) {
    return featureAccess.find((item) => item.featureKey === key);
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

  function openAccessDialog(feature: FeatureSettingDefinition) {
    const access = getAccess(feature.key);
    setAccessDialog({
      feature,
      groupIds: new Set(access?.groupIds ?? []),
    });
  }

  function toggleAccessGroup(groupId: string) {
    setAccessDialog((current) => {
      if (!current) return current;
      const groupIds = new Set(current.groupIds);
      if (groupIds.has(groupId)) {
        groupIds.delete(groupId);
      } else {
        groupIds.add(groupId);
      }
      return { ...current, groupIds };
    });
  }

  async function saveAccess() {
    const session = getStoredSession();
    if (!session?.token || !organizationId || !accessDialog) return;
    setSavingAccess(true);
    setError(null);
    setMsg("");
    try {
      await replaceOrganizationFeatureAccess(
        session.token,
        organizationId,
        {
          featureKey: accessDialog.feature.key,
          groupIds: [...accessDialog.groupIds],
        },
      );
      setAccessDialog(null);
      setMsg("访问人员已更新");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存访问人员失败");
    } finally {
      setSavingAccess(false);
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
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>功能管理</CardTitle>
            <CardDescription>管理当前组织的功能开关和访问人员</CardDescription>
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
              const access = getAccess(feature.key);
              const restrictedGroups = (access?.groupIds ?? [])
                .map((groupId) => groupsById.get(groupId))
                .filter((group): group is OrganizationGroup => Boolean(group));

              return (
                <div
                  className="grid gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30 md:grid-cols-[1fr_auto_auto]"
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
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        访问人员
                      </span>
                      {restrictedGroups.length === 0 ? (
                        <Badge variant="secondary">所有有权限人员</Badge>
                      ) : (
                        restrictedGroups.map((group) => (
                          <Badge key={group.id} variant="outline">
                            {group.displayName}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <Button
                    disabled={!canManageFeatures}
                    onClick={() => openAccessDialog(feature)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <AppIcon className="size-3.5" name="users" />
                    访问人员
                  </Button>
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

      <Dialog
        onOpenChange={(open) => {
          if (!open && !savingAccess) setAccessDialog(null);
        }}
        open={Boolean(accessDialog)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>访问人员</DialogTitle>
          </DialogHeader>
          {accessDialog && (
            <div className="grid gap-4">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-sm font-medium">
                  {accessDialog.feature.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  清空选择后，所有具备角色权限的人员都可使用。
                </div>
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                {groups.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    暂无用户组
                  </div>
                ) : (
                  <div className="divide-y">
                    {groups.map((group) => {
                      const checked = accessDialog.groupIds.has(group.id);
                      return (
                        <label
                          className={cn(
                            "grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
                            !canManageFeatures && "cursor-default opacity-80",
                          )}
                          key={group.id}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={!canManageFeatures}
                            onCheckedChange={() => toggleAccessGroup(group.id)}
                          />
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="size-2 shrink-0 rounded-full border"
                                style={{
                                  backgroundColor: group.color ?? undefined,
                                }}
                              />
                              <span className="truncate text-sm font-medium">
                                {group.displayName}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {group.name}
                            </span>
                          </span>
                          <Badge variant="outline">{group.memberCount}</Badge>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={savingAccess}
              onClick={() => setAccessDialog(null)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={!canManageFeatures || savingAccess || !accessDialog}
              onClick={() => void saveAccess()}
              type="button"
            >
              {savingAccess ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
