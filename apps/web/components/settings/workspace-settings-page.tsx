"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { InlineNotice } from "@/components/inline-notice";
import {
  SettingsCard,
  SettingsFieldRow,
  SettingsPageHeader,
} from "@/components/settings/settings-page";
import {
  CustomSettingDialog,
  SettingEditDialog,
  SettingValueInput,
  type CustomSettingSubmit,
} from "@/components/settings/settings-value-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  listWorkspaceSettings,
  saveWorkspaceSettings,
  updateWorkspace,
  type SettingPayloadEntry,
  type SettingPayloadValue,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import {
  KNOWN_PLATFORM_SETTING_KEYS,
  WORKSPACE_CONTROL_SETTING_DEFINITIONS,
  WORKSPACE_DEFAULT_FIELD_DEFINITIONS,
} from "@hermes-swarm/core/settings/definitions";
import type { EffectiveWorkspaceSetting } from "@hermes-swarm/core/settings/effective-settings";

type WorkspaceSection = "general" | "governance" | "localization" | "parameters";
type SettingDraft = { overridden: boolean; value: SettingPayloadValue };

export function WorkspaceSettingsPage({
  section,
}: {
  section: WorkspaceSection;
}) {
  const t = useTranslations("workspaceScope");
  const common = useTranslations("common");
  const tr = useTextTranslation();
  const access = usePermission();
  const { refreshSnapshot, snapshot } = useAdminShell();
  const workspace = snapshot?.workspace ?? null;
  const canManageSettings = access.hasPermission(
    "setting.workspace_config.save:workspace",
  );
  const canUpdateWorkspace = access.hasPermission(
    "workspace.workspace_profile.update:workspace",
  );
  const [name, setName] = useState(workspace?.name ?? "");
  const [slug, setSlug] = useState(workspace?.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [restoreAllOpen, setRestoreAllOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settings, setSettings] = useState<EffectiveWorkspaceSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});

  useEffect(() => {
    setName(workspace?.name ?? "");
    setSlug(workspace?.slug ?? "");
  }, [workspace?.id, workspace?.name, workspace?.slug]);

  const loadSettings = useCallback(async () => {
    if (section === "general") return;
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) return;
    setLoadingSettings(true);
    try {
      const result = await listWorkspaceSettings(session);
      setSettings(result);
      setDrafts(toSettingDrafts(result));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("加载失败"));
    } finally {
      setLoadingSettings(false);
    }
  }, [section, tr]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const localizationSettings = useMemo(
    () =>
      WORKSPACE_DEFAULT_FIELD_DEFINITIONS.map((definition) => ({
        definition,
        setting: settings.find((item) => item.name === definition.key) ?? null,
      })),
    [settings],
  );
  const governanceSettings = useMemo(
    () =>
      WORKSPACE_CONTROL_SETTING_DEFINITIONS.map((definition) => ({
        definition,
        setting: settings.find((item) => item.name === definition.key) ?? null,
      })),
    [settings],
  );
  const customSettings = useMemo(() => {
    const known = new Set<string>(KNOWN_PLATFORM_SETTING_KEYS);
    return settings.filter((setting) => !known.has(setting.name));
  }, [settings]);

  const runtimePreferences = snapshot?.runtimePreferences;
  if (!workspace || !runtimePreferences) return null;

  async function submitGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpdateWorkspace) return;
    setSaving(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await updateWorkspace(session, { name: name.trim() });
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(name: string, patch: Partial<SettingDraft>) {
    setDrafts((current) => ({
      ...current,
      [name]: {
        overridden: current[name]?.overridden ?? false,
        value: current[name]?.value ?? "",
        ...patch,
      },
    }));
  }

  async function persistSettings(entries: SettingPayloadEntry[]) {
    if (!canManageSettings || entries.length === 0) return;
    setSavingSettings(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const result = await saveWorkspaceSettings(session, { settings: entries });
      setSettings(result);
      setDrafts(toSettingDrafts(result));
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("保存失败"));
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveDefinitions(
    definitions: ReadonlyArray<{
      key: string;
      options: readonly { label: string; value: string }[];
      valueType: "enum";
    }>,
  ) {
    await persistSettings(
      definitions.map((definition) => {
        const draft = drafts[definition.key];
        return {
          name: definition.key,
          value: draft?.overridden ? draft.value : null,
          valueOptions: definition.options.map((option) => ({ ...option })),
          valueType: definition.valueType,
        };
      }),
    );
  }

  async function restoreSetting(setting: EffectiveWorkspaceSetting) {
    await persistSettings([
      {
        name: setting.name,
        value: null,
        valueOptions: setting.valueOptions?.map((option) => ({ ...option })),
        valueType: setting.valueType,
      },
    ]);
  }

  async function saveCustomSetting(setting: CustomSettingSubmit) {
    if (!canManageSettings) return;
    const settingName = setting.name.trim();
    if (!settingName) return;

    setSavingSettings(true);
    setError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const result = await saveWorkspaceSettings(session, {
        settings: [{
          ...setting,
          name: settingName,
          scope: "workspace",
        }],
      });
      setSettings(result);
      setDrafts(toSettingDrafts(result));
      await refreshSnapshot();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("保存失败"));
      throw reason;
    } finally {
      setSavingSettings(false);
    }
  }

  async function restoreAllLocalization() {
    setRestoreAllOpen(false);
    await persistSettings(
      WORKSPACE_DEFAULT_FIELD_DEFINITIONS.map((definition) => ({
        name: definition.key,
        value: null,
        valueOptions: definition.options.map((option) => ({ ...option })),
        valueType: definition.valueType,
      })),
    );
  }

  return (
    <section className="grid gap-4">
      <SettingsPageHeader
        description={tr(workspaceSectionDescription(section))}
        title={tr(workspaceSectionTitle(section))}
      />

      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {section === "general" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("workspaceProfile")}</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={submitGeneral}>
                <div className="grid gap-2">
                  <Label htmlFor="workspace-name">{t("workspaceName")}</Label>
                  <Input
                    disabled={!canUpdateWorkspace || saving}
                    id="workspace-name"
                    onChange={(event) => setName(event.target.value)}
                    required
                    value={name}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="workspace-slug">{t("workspaceSlug")}</Label>
                  <Input disabled id="workspace-slug" value={slug} />
                </div>
                <div className="flex justify-end">
                  <Button disabled={!canUpdateWorkspace || saving} type="submit">
                    {saving ? common("saving") : common("save")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("workspaceStatus")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={workspace.status === "active" ? "default" : "secondary"}>
                  {workspace.status}
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="grid gap-2 pt-6">
                <Button asChild variant="outline">
                  <Link href="/settings/workspace/members">{tr("管理成员")}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {section === "localization" && (
        <SettingsCard
          actions={
            <>
              <Button
                disabled={!canManageSettings || savingSettings}
                onClick={() => setRestoreAllOpen(true)}
                type="button"
                variant="outline"
              >
                {tr("全部恢复平台默认")}
              </Button>
              <Button
                disabled={!canManageSettings || savingSettings}
                onClick={() => void saveDefinitions(WORKSPACE_DEFAULT_FIELD_DEFINITIONS)}
                type="button"
              >
                {savingSettings ? tr("保存中...") : tr("保存")}
              </Button>
            </>
          }
          description={tr("工作空间可以覆盖平台默认值，也可以随时恢复继承")}
          loading={loadingSettings}
          loadingLabel={tr("加载中...")}
          title={tr("区域与语言")}
        >
          <div className="grid gap-3">
            {localizationSettings.map(({ definition, setting }) => {
              if (!setting) return null;
              const runtimeField = runtimePreferenceField(definition.field);
              return (
                <WorkspaceSettingRow
                  canManage={canManageSettings}
                  draft={drafts[definition.key]}
                  effectiveSource={runtimePreferences.sources[runtimeField]}
                  key={definition.key}
                  label={tr(definition.label)}
                  onDraftChange={(patch) => updateDraft(definition.key, patch)}
                  onRestore={() => void restoreSetting(setting)}
                  setting={setting}
                  tr={tr}
                />
              );
            })}
          </div>
        </SettingsCard>
      )}

      {section === "governance" && (
        <SettingsCard
          actions={
            <Button
              disabled={!canManageSettings || savingSettings}
              onClick={() => void saveDefinitions(WORKSPACE_CONTROL_SETTING_DEFINITIONS)}
              type="button"
            >
              {savingSettings ? tr("保存中...") : tr("保存")}
            </Button>
          }
          description={tr("覆盖平台允许工作空间调整的治理参数")}
          loading={loadingSettings}
          loadingLabel={tr("加载中...")}
          title={tr("工作空间治理")}
        >
          <div className="grid gap-3">
            {governanceSettings.map(({ definition, setting }) =>
              setting ? (
                <WorkspaceSettingRow
                  canManage={canManageSettings}
                  draft={drafts[definition.key]}
                  key={definition.key}
                  label={tr(definition.label)}
                  onDraftChange={(patch) => updateDraft(definition.key, patch)}
                  onRestore={() => void restoreSetting(setting)}
                  setting={setting}
                  tr={tr}
                />
              ) : null,
            )}
          </div>
        </SettingsCard>
      )}

      {section === "parameters" && (
        <SettingsCard
          actions={
            <Button
              disabled={!canManageSettings || savingSettings || customSettings.length === 0}
              onClick={() =>
                void persistSettings(
                  customSettings
                    .filter((setting) => setting.isEditable)
                    .map((setting) => {
                      const draft = drafts[setting.name];
                      return {
                        name: setting.name,
                        value: draft?.overridden ? draft.value : null,
                        valueOptions: setting.valueOptions?.map((option) => ({ ...option })),
                        valueType: setting.valueType,
                      };
                    }),
                )
              }
              type="button"
            >
              {savingSettings ? tr("保存中...") : tr("保存")}
            </Button>
          }
          description={tr("保存工作空间专属环境参数和密钥，或覆盖平台开放的参数")}
          headerActions={
            <CustomSettingDialog
              description={tr("创建当前工作空间专属参数；密钥类型只显示遮罩并加密保存。")}
              disabled={!canManageSettings || savingSettings}
              idPrefix="workspace-custom-setting"
              namePlaceholder="MY_ENV_NAME"
              onSubmit={saveCustomSetting}
              saving={savingSettings}
              scopeOptions={[{ label: "工作空间", value: "workspace" }]}
              title={tr("新增工作空间参数")}
              triggerLabel={tr("新增参数")}
            />
          }
          loading={loadingSettings}
          loadingLabel={tr("加载中...")}
          title={tr("参数设置")}
        >
          {customSettings.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {tr("暂无可配置参数")}
            </div>
          ) : (
            <div className="grid gap-3">
              {customSettings.map((setting) => (
                <WorkspaceSettingRow
                  canManage={canManageSettings}
                  draft={drafts[setting.name]}
                  key={setting.name}
                  label={setting.name}
                  onDraftChange={(patch) => updateDraft(setting.name, patch)}
                  onEdit={saveCustomSetting}
                  onRestore={() => void restoreSetting(setting)}
                  setting={setting}
                  tr={tr}
                />
              ))}
            </div>
          )}
        </SettingsCard>
      )}

      <ConfirmActionDialog
        confirmLabel={tr("恢复")}
        description={tr("将清除全部工作空间本地化覆盖，并重新继承平台默认值。")}
        onConfirm={() => void restoreAllLocalization()}
        onOpenChange={setRestoreAllOpen}
        open={restoreAllOpen}
        pending={savingSettings}
        title={tr("恢复平台默认")}
      />
    </section>
  );
}

function WorkspaceSettingRow({
  canManage,
  draft,
  effectiveSource,
  label,
  onDraftChange,
  onEdit,
  onRestore,
  setting,
  tr,
}: {
  canManage: boolean;
  draft?: SettingDraft;
  effectiveSource?: "code" | "platform" | "workspace" | "user";
  label: string;
  onDraftChange: (patch: Partial<SettingDraft>) => void;
  onEdit?: (setting: CustomSettingSubmit) => Promise<void> | void;
  onRestore: () => void;
  setting: EffectiveWorkspaceSetting;
  tr: (value: string) => string;
}) {
  const value = draft?.value ?? setting.overrideValue ?? setting.value ?? "";
  const canEdit = canManage && setting.isEditable;
  const source = effectiveSource ?? setting.scope;
  const valueInputId = `value-${setting.id}`;
  return (
    <SettingsFieldRow
      actions={
        setting.isCustom || setting.isOverridden ? (
          <>
            {setting.isCustom && onEdit && (
              <SettingEditDialog
                disabled={!canManage}
                idPrefix={`workspace-custom-${setting.id}`}
                name={setting.name}
                onSubmit={onEdit}
                value={setting.overrideValue ?? setting.value ?? ""}
                valueOptions={setting.valueOptions}
                valueType={setting.valueType}
              />
            )}
            {setting.isOverridden && (
              <Button
                disabled={!canManage}
                onClick={onRestore}
                size="sm"
                type="button"
                variant="ghost"
              >
                {tr(setting.isCustom ? "删除" : "恢复平台默认")}
              </Button>
            )}
          </>
        ) : undefined
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={source === "workspace" ? "default" : "secondary"}>
            {tr(
              setting.isCustom
                ? "工作空间专属"
                : runtimePreferenceSourceLabel(source),
            )}
          </Badge>
          {!setting.isCustom && (
            <span className="truncate text-xs text-muted-foreground">
              {tr("平台值")}: {displaySettingValue(setting.defaultValue)}
            </span>
          )}
        </span>
      }
      htmlFor={valueInputId}
      label={label}
    >
      <SettingValueInput
        className="ml-auto w-full max-w-sm justify-end"
        disabled={!canEdit}
        id={valueInputId}
        onValueChange={(nextValue) =>
          onDraftChange({ overridden: true, value: nextValue })
        }
        value={value}
        valueOptions={setting.valueOptions}
        valueType={setting.valueType}
      />
    </SettingsFieldRow>
  );
}

function toSettingDrafts(settings: readonly EffectiveWorkspaceSetting[]) {
  return Object.fromEntries(
    settings.map((setting) => [
      setting.name,
      {
        overridden: setting.isOverridden,
        value: setting.overrideValue ?? setting.value ?? "",
      },
    ]),
  ) as Record<string, SettingDraft>;
}

function displaySettingValue(value: string | null) {
  return value === null || value === "" ? "—" : value;
}

function runtimePreferenceField(
  field: (typeof WORKSPACE_DEFAULT_FIELD_DEFINITIONS)[number]["field"],
): "currency" | "dateFormat" | "language" | "regionCode" | "timeZone" {
  return field === "preferredLanguage" ? "language" : field;
}

function runtimePreferenceSourceLabel(
  source: "code" | "platform" | "workspace" | "user",
) {
  switch (source) {
    case "user":
      return "个人偏好";
    case "workspace":
      return "工作空间覆盖";
    case "platform":
      return "平台默认";
    default:
      return "代码默认";
  }
}

function workspaceSectionTitle(section: WorkspaceSection) {
  switch (section) {
    case "localization":
      return "区域与语言";
    case "governance":
      return "工作空间治理";
    case "parameters":
      return "参数设置";
    default:
      return "工作空间";
  }
}

function workspaceSectionDescription(section: WorkspaceSection) {
  switch (section) {
    case "localization":
      return "设置工作空间默认使用的语言、时区、货币、地区和日期格式";
    case "governance":
      return "管理允许由工作空间覆盖的安全和治理策略";
    case "parameters":
      return "管理平台开放给当前工作空间的自定义参数";
    default:
      return "维护工作空间资料和状态";
  }
}
