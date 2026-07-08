"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CustomSettingDialog,
  SettingEditDialog,
  SettingValueInput,
  type CustomSettingSubmit,
} from "@/components/settings-value-input";
import { UserAvatar } from "@/components/user-avatar";
import {
  ORGANIZATION_CONTROL_SETTING_DEFINITIONS,
  ORGANIZATION_DEFAULT_FIELD_DEFINITIONS,
  resolveSettingValueOptions,
  resolveSettingValueType,
  type SettingOption,
} from "@hermes-swarm/core/settings/definitions";
import {
  AdminApiError,
  createOrganizationMember,
  createOrganizationInvites,
  deleteOrganizationInvite,
  getOrganization,
  getOrganizationInvites,
  listOrganizationMembers,
  listOrganizationRoles,
  listOrganizationSettingsForOrganization,
  resendOrganizationInvite,
  saveOrganizationSettingsForOrganization,
  searchUsers,
  updateOrganizationMember,
  updateOrganization,
  uploadAdminFile,
  type OrganizationMembership,
  type Organization,
  type Invite,
  type OrganizationPayload,
  type OrganizationSetting,
  type Role,
  type User,
  type UserStatus,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { usePermission } from "@/hooks/use-permission";

const CONTROL_KEYS = ORGANIZATION_CONTROL_SETTING_DEFINITIONS;
const ORGANIZATION_DEFAULT_FIELDS = ORGANIZATION_DEFAULT_FIELD_DEFINITIONS;
const HANDLED_SETTING_KEYS = new Set<string>([
  ...CONTROL_KEYS.map((item) => item.key),
  ...ORGANIZATION_DEFAULT_FIELDS.map((item) => item.key),
]);

type OrganizationForm = {
  banner: string;
  brandColor: string;
  clientFocus: string;
  currency: string;
  dateFormat: string;
  imageUrl: string;
  isDefault: boolean;
  name: string;
  officialName: string;
  overview: string;
  preferredLanguage: string;
  profileLink: string;
  regionCode: string;
  shortDescription: string;
  slug: string;
  status: "active" | "suspended";
  subdomain: string;
  timeZone: string;
  totalEmployees: string;
  website: string;
};

type OrganizationTab =
  | "controls"
  | "general"
  | "members"
  | "profile";

type SectionKey = "invites" | "members" | "roles" | "settings";

export function OrganizationDetailPage({
  organizationId,
}: {
  organizationId: string | null | undefined;
}) {
  const tr = useTextTranslation();
  const searchParams = useSearchParams();
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<OrganizationTab>("general");
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createInviteOpen, setCreateInviteOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const notifications = useNotifications();
  const [controlValues, setControlValues] = useState<Record<string, string>>(
    {},
  );
  const [editUser, setEditUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<OrganizationForm>(emptyOrganizationForm());
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationSettings, setOrganizationSettings] = useState<
    OrganizationSetting[]
  >([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteToClose, setInviteToClose] = useState<Invite | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [customSettingToDelete, setCustomSettingToDelete] =
    useState<CustomSettingSubmit | null>(null);
  const [sectionErrors, setSectionErrors] = useState<
    Partial<Record<SectionKey, string>>
  >({});
  const [saving, setSaving] = useState(false);
  const [savingControls, setSavingControls] = useState(false);
  const [savingCustomSetting, setSavingCustomSetting] = useState(false);
  const [closingInvite, setClosingInvite] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const canUpdateOrganizationProfile =
    snapshot && resolvedSession
      ? access.hasPermission("organization.profile.update_basic:organization")
      : false;
  const canManage = canUpdateOrganizationProfile;
  const canViewPlatformControls =
    snapshot && resolvedSession
      ? access.hasPageAccess("settings.organizations", { organizationId }) ||
        access.hasPermission([
          "organization.platform_organization.create:platform",
          "organization.platform_organization.delete:platform",
        ])
      : false;
  const canManagePlatformControls =
    canViewPlatformControls &&
    Boolean(
      snapshot && resolvedSession
        ? access.hasPermission([
            "organization.platform_organization.create:platform",
            "organization.platform_organization.delete:platform",
          ])
        : false,
    );
  const canSaveOrganization = canManage || canManagePlatformControls;
  const canViewOrganizationSettings =
    snapshot && resolvedSession
      ? access.hasPermission("setting.organization_config.list:organization")
      : false;
  const canSaveOrganizationSettings =
    snapshot && resolvedSession
      ? access.hasPermission("setting.organization_config.save:organization")
      : false;
  const canViewOrganizationMembers =
    snapshot && resolvedSession
      ? access.hasPermission("user.organization_member.list:organization")
      : false;
  const canViewOrganizationRoles =
    snapshot && resolvedSession
      ? access.hasPermission("role.organization_role.list:organization")
      : false;
  const canCreateOrganizationMember =
    snapshot && resolvedSession
      ? access.hasPermission("user.organization_member.create:organization")
      : false;
  const canViewInvites =
    snapshot && resolvedSession
      ? access.hasPermission("invite.organization_invite.list:organization")
      : false;
  const canCreateInvites =
    snapshot && resolvedSession
      ? access.hasPermission("invite.organization_invite.create_bulk:organization")
      : false;
  const canResendInvites =
    snapshot && resolvedSession
      ? access.hasPermission("invite.organization_invite.resend:organization")
      : false;
  const canCloseInvites =
    snapshot && resolvedSession
      ? access.hasPermission("invite.organization_invite.delete:organization")
      : false;
  const canUpdateOrganizationMember =
    snapshot && resolvedSession
      ? access.hasPermission("user.organization_member.update:organization")
      : false;
  const assignableRoles = useMemo(
    () => (canUpdateOrganizationMember ? roles : []),
    [canUpdateOrganizationMember, roles],
  );

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (!token || !organizationId) {
      setLoading(false);
      return;
    }

    setError(null);
    setSectionErrors({});
    setLoading(true);
    try {
      const data = await getOrganization(token, organizationId);
      setOrganization(data);
      setForm(toOrganizationForm(data));

      const sectionErrors: Partial<Record<SectionKey, string>> = {};
      const [settingsResult, membersResult, rolesResult, invitesResult] =
        await Promise.allSettled([
          canViewOrganizationSettings
            ? listOrganizationSettingsForOrganization(
                token,
                organizationId,
              )
            : Promise.resolve<OrganizationSetting[] | null>(null),
          canViewOrganizationMembers
            ? listOrganizationMembers(token, organizationId)
            : Promise.resolve<OrganizationMembership[] | null>(null),
          canViewOrganizationRoles
            ? listOrganizationRoles(token, organizationId)
            : Promise.resolve<Role[] | null>(null),
          canViewInvites
            ? getOrganizationInvites(token, organizationId)
            : Promise.resolve<Invite[] | null>(null),
        ]);

      if (settingsResult.status === "fulfilled") {
        const settings = settingsResult.value ?? [];
        setOrganizationSettings(settings);
        setControlValues(
          Object.fromEntries(
            CONTROL_KEYS.map((item) => [
              item.key,
              settings.find((setting) => setting.name === item.key)
                ?.overrideValue ?? "",
            ]),
          ),
        );
      } else {
        setOrganizationSettings([]);
        setControlValues({});
        sectionErrors.settings = formatSectionError(
          settingsResult.reason,
          tr("组织设置加载失败"),
        );
      }

      if (membersResult.status === "fulfilled") {
        const userItems = membersResult.value ?? [];
        setMemberships(userItems);
        setUsers(userItems.map((membership) => membership.user));
      } else {
        setMemberships([]);
        setUsers([]);
        sectionErrors.members = formatSectionError(
          membersResult.reason,
          tr("组织成员加载失败"),
        );
      }

      if (rolesResult.status === "fulfilled") {
        setRoles(rolesResult.value ?? []);
      } else {
        setRoles([]);
        sectionErrors.roles = formatSectionError(
          rolesResult.reason,
          tr("组织角色加载失败"),
        );
      }

      if (invitesResult.status === "fulfilled") {
        setInvites(invitesResult.value ?? []);
      } else {
        setInvites([]);
        sectionErrors.invites = formatSectionError(
          invitesResult.reason,
          tr("邀请加载失败"),
        );
      }

      setSectionErrors(sectionErrors);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [
    canViewOrganizationMembers,
    canViewOrganizationRoles,
    canViewOrganizationSettings,
    canViewInvites,
    organizationId,
    tr,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setActiveTab(isOrganizationTab(requestedTab) ? requestedTab : "general");
  }, [requestedTab]);

  const dirty = useMemo(() => {
    if (!organization) return false;
    return (
      JSON.stringify(form) !== JSON.stringify(toOrganizationForm(organization))
    );
  }, [form, organization]);
  const customSettings = useMemo(
    () =>
      organizationSettings.filter(
        (setting) => !HANDLED_SETTING_KEYS.has(setting.name),
      ),
    [organizationSettings],
  );

  function findSetting(name: string) {
    return (
      organizationSettings.find((setting) => setting.name === name) ?? null
    );
  }

  function settingDefaultLabel(
    name: string,
    options?: readonly SettingOption[],
  ) {
    const setting = findSetting(name);
    const value = setting?.defaultValue ?? setting?.value ?? "";
    if (!value) return tr("未设置");
    return options?.find((option) => option.value === value)?.label ?? value;
  }

  function updateField<K extends keyof OrganizationForm>(
    key: K,
    value: OrganizationForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!organization || !canSaveOrganization) return;
    setSaving(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const updated = await updateOrganization(
        token,
        organization.id,
        toOrganizationPayload(form, {
          includePlatformControls: canManagePlatformControls,
        }),
      );
      setOrganization(updated);
      setForm(toOrganizationForm(updated));
      notifications.success(tr("组织配置已保存"));
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!organization || !canManage) return;
    setUploadingLogo(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const uploaded = await uploadAdminFile(token, file);
      const imageUrl =
        uploaded.url ??
        uploaded.destinations.find(
          (item) => item.status === "success" && item.url,
        )?.url;
      if (!imageUrl) throw new Error(tr("上传成功但未返回图片地址"));
      const updated = await updateOrganization(token, organization.id, {
        imageUrl,
      });
      setOrganization(updated);
      setForm(toOrganizationForm(updated));
      notifications.success(tr("组织 Logo 已上传"));
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("上传失败"));
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function saveControls() {
    if (!organization || !canSaveOrganizationSettings) return;
    setSavingControls(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await saveOrganizationSettingsForOrganization(token, organization.id, {
        settings: CONTROL_KEYS.map((item) => ({
          name: item.key,
          valueOptions: item.options.map((option) => ({ ...option })),
          valueType: item.valueType,
          value: controlValues[item.key] || null,
        })),
      });
      const settings = await listOrganizationSettingsForOrganization(
        token,
        organization.id,
      );
      setOrganizationSettings(settings);
      notifications.success(tr("组织控制项已保存"));
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSavingControls(false);
    }
  }

  async function saveCustomSetting(setting: CustomSettingSubmit) {
    if (!organization || !canSaveOrganizationSettings) return;
    const { scope: _scope, ...payload } = setting;
    const settingName = payload.name.trim();
    if (!settingName) return;

    setSavingCustomSetting(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const settings = await saveOrganizationSettingsForOrganization(
        token,
        organization.id,
        { settings: [{ ...payload, name: settingName }] },
      );
      setOrganizationSettings(settings);
      notifications.success(
        payload.value === null ? tr("自定义设置已删除") : tr("自定义设置已保存"),
      );
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSavingCustomSetting(false);
    }
  }

  function onLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadLogo(file);
  }

  function roleLabel(roleId: string | null) {
    if (!roleId) return "-";
    return roles.find((role) => role.id === roleId)?.label ?? tr("受限角色");
  }

  function membershipForUser(userId: string) {
    return memberships.find((membership) => membership.userId === userId) ?? null;
  }

  function canEditUser(user: User) {
    return canUpdateOrganizationMember && Boolean(membershipForUser(user.id));
  }

  async function reloadInvites() {
    if (!organization || !canViewInvites) return;
    const token = await requireAuthenticatedAdminSessionMarker();
    setInvites(await getOrganizationInvites(token, organization.id));
  }

  async function resendInvite(invite: Invite) {
    if (!organization || !canResendInvites) return;
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await resendOrganizationInvite(token, organization.id, invite.id);
      notifications.success(tr("邀请已重发"));
      await reloadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("操作失败"));
    }
  }

  async function closeInvite() {
    if (!organization || !inviteToClose || !canCloseInvites) return;
    setClosingInvite(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await deleteOrganizationInvite(token, organization.id, inviteToClose.id);
      notifications.success(tr("邀请已关闭"));
      setInviteToClose(null);
      await reloadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("操作失败"));
    } finally {
      setClosingInvite(false);
    }
  }

  async function copyInviteLink(invite: Invite) {
    if (!invite.link) return;
    await navigator.clipboard.writeText(invite.link);
    notifications.success(tr("邀请地址已复制"));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {tr("加载中...")}
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="grid gap-3">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {organization.name}
          </h1>
        </div>
        <Badge
          variant={organization.status === "active" ? "default" : "secondary"}
        >
          {organization.status === "active" ? tr("启用") : tr("已停用")}
        </Badge>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <Tabs
        onValueChange={(value) => {
          if (isOrganizationTab(value)) setActiveTab(value);
        }}
        value={activeTab}
      >
        <TabsContent value="general">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <Card>
              <CardHeader>
                <CardTitle>{tr("组织信息")}</CardTitle>
                <CardDescription>
                  {tr("维护组织名称、标识和生命周期")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="名称" htmlFor="organization-name">
                  <Input
                    disabled={!canManage}
                    id="organization-name"
                    onChange={(event) =>
                      updateField("name", event.target.value)
                    }
                    value={form.name}
                  />
                </Field>
                <Field label="标识符" htmlFor="organization-slug">
                  <Input
                    disabled={!canManage}
                    id="organization-slug"
                    onChange={(event) =>
                      updateField("slug", event.target.value)
                    }
                    value={form.slug}
                  />
                </Field>
                <Field label="子域名" htmlFor="organization-subdomain">
                  <Input
                    disabled={!canManage}
                    id="organization-subdomain"
                    onChange={(event) =>
                      updateField("subdomain", event.target.value)
                    }
                    value={form.subdomain}
                  />
                </Field>
                <Field label="官方名称" htmlFor="organization-official-name">
                  <Input
                    disabled={!canManage}
                    id="organization-official-name"
                    onChange={(event) =>
                      updateField("officialName", event.target.value)
                    }
                    value={form.officialName}
                  />
                </Field>
                <Field label="Profile Link" htmlFor="organization-profile-link">
                  <Input
                    disabled={!canManage}
                    id="organization-profile-link"
                    onChange={(event) =>
                      updateField("profileLink", event.target.value)
                    }
                    value={form.profileLink}
                  />
                </Field>
                <Field label="网站" htmlFor="organization-website">
                  <Input
                    disabled={!canManage}
                    id="organization-website"
                    onChange={(event) =>
                      updateField("website", event.target.value)
                    }
                    value={form.website}
                  />
                </Field>
                {canViewPlatformControls && (
                  <>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="grid gap-0.5">
                        <Label htmlFor="organization-active">{tr("启用组织")}</Label>
                        <span className="text-xs">
                          {tr("停用后该组织用户不能继续登录")}
                        </span>
                      </div>
                      <Switch
                        checked={form.status === "active"}
                        disabled={!canManagePlatformControls}
                        id="organization-active"
                        onCheckedChange={(checked) =>
                          updateField(
                            "status",
                            checked ? "active" : "suspended",
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="grid gap-0.5">
                        <Label htmlFor="organization-default">{tr("默认组织")}</Label>
                        <span className="text-xs">
                          {tr("用于平台默认组织选择")}
                        </span>
                      </div>
                      <Switch
                        checked={form.isDefault}
                        disabled={!canManagePlatformControls}
                        id="organization-default"
                        onCheckedChange={(checked) =>
                          updateField("isDefault", checked)
                        }
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Logo</CardTitle>
                <CardDescription>
                  {tr("通过上传图片更新组织头像")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-16 place-items-center overflow-hidden rounded-lg border bg-muted">
                    {form.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        className="size-full object-cover"
                        src={form.imageUrl}
                      />
                    ) : (
                      <AppIcon className="size-6" name="building" />
                    )}
                  </div>
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">
                      {organization.name}
                    </div>
                    <div className="truncate text-xs">{organization.slug}</div>
                  </div>
                </div>
                <input
                  accept="image/*"
                  className="hidden"
                  onChange={onLogoChange}
                  ref={logoInputRef}
                  type="file"
                />
                <Button
                  disabled={!canManage || uploadingLogo}
                  onClick={() => logoInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <AppIcon className="size-3.5" name="image-upload" />
                  {uploadingLogo ? tr("上传中...") : tr("上传 Logo")}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="grid content-start gap-6" value="members">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{tr("组织成员")}</CardTitle>
                <CardDescription>
                  {tr("维护当前组织的成员账号和角色")}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Dialog onOpenChange={setCreateUserOpen} open={createUserOpen}>
                  <DialogTrigger asChild>
                    <Button
                      disabled={
                        !canCreateOrganizationMember ||
                        assignableRoles.length === 0
                      }
                      size="sm"
                      variant="outline"
                    >
                      <AppIcon className="size-3.5" name="users" />
                      {tr("添加成员")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{tr("添加成员")}</DialogTitle>
                    </DialogHeader>
                    <OrganizationUserForm
                      mode="create"
                      organizationId={organization.id}
                      roles={assignableRoles}
                      onDone={() => {
                        setCreateUserOpen(false);
                        void load();
                      }}
                    />
                  </DialogContent>
                </Dialog>
                <Dialog onOpenChange={setCreateInviteOpen} open={createInviteOpen}>
                  <DialogTrigger asChild>
                    <Button
                      disabled={!canCreateInvites || assignableRoles.length === 0}
                      size="sm"
                    >
                      <AppIcon className="size-3.5" name="invite" />
                      {tr("邀请成员")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{tr("邀请成员")}</DialogTitle>
                    </DialogHeader>
                    <OrganizationInviteForm
                      organizationId={organization.id}
                      roles={assignableRoles}
                      onDone={() => {
                        setCreateInviteOpen(false);
                        void reloadInvites();
                      }}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {!canViewOrganizationMembers ? (
                <SectionNotice
                  description={tr("当前账号没有查看组织成员的权限。")}
                  title={tr("无法查看成员")}
                />
              ) : sectionErrors.members ? (
                <SectionNotice
                  description={sectionErrors.members}
                  title={tr("成员加载失败")}
                />
              ) : (
                <>
                  {sectionErrors.roles && (
                    <SectionNotice
                      className="mb-3"
                      description={sectionErrors.roles}
                      title={tr("角色加载失败")}
                    />
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-56">{tr("成员")}</TableHead>
                        <TableHead>{tr("邮箱")}</TableHead>
                        <TableHead>{tr("角色")}</TableHead>
                        <TableHead>{tr("状态")}</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.length === 0 ? (
                      <TableRow>
                        <TableCell className="text-center" colSpan={5}>
                          {tr("暂无成员")}
                        </TableCell>
                      </TableRow>
                      ) : (
                        users.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <UserAvatar size="sm" user={user} />
                                <div className="min-w-0">
                                  <div className="truncate font-medium">
                                    {user.displayName}
                                  </div>
                                  {user.username && (
                                    <div className="truncate text-xs">
                                      @{user.username}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{user.email}</TableCell>
                            <TableCell>
                              <Badge className="text-xs" variant="outline">
                                {roleLabel(
                                  membershipForUser(user.id)?.roleId ?? null,
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                className="text-xs"
                                variant={
                                  user.status === "active" ? "default" : "secondary"
                                }
                              >
                                {user.status === "active" ? tr("启用") : tr("禁用")}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                disabled={!canEditUser(user)}
                                onClick={() => setEditUser(user)}
                                size="sm"
                                variant="ghost"
                              >
                                {tr("编辑")}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tr("成员邀请")}</CardTitle>
              <CardDescription>
                {tr("查看公开邀请链接、定向邀请和加入状态")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!canViewInvites ? (
                <SectionNotice
                  description={tr("当前账号没有查看组织邀请的权限。")}
                  title={tr("无法查看邀请")}
                />
              ) : sectionErrors.invites ? (
                <SectionNotice
                  description={sectionErrors.invites}
                  title={tr("邀请加载失败")}
                />
              ) : (
                <Table className="min-w-[1120px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("类型")}</TableHead>
                      <TableHead>{tr("邮箱")}</TableHead>
                      <TableHead>{tr("角色")}</TableHead>
                      <TableHead>{tr("邀请人")}</TableHead>
                      <TableHead>{tr("创建时间")}</TableHead>
                      <TableHead>{tr("状态")}</TableHead>
                      <TableHead>{tr("过期时间")}</TableHead>
                      <TableHead>{tr("加入人数")}</TableHead>
                      <TableHead className="sticky right-0 z-20 w-32 border-l bg-card text-right shadow-[-10px_0_16px_-16px_rgba(0,0,0,0.45)]">
                        {tr("操作")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.length === 0 ? (
                      <TableRow>
                        <TableCell className="text-center" colSpan={9}>
                          {tr("暂无邀请")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      invites.map((invite) => (
                        <TableRow key={invite.id}>
                          <TableCell>
                            <Badge variant={invite.email ? "outline" : "secondary"}>
                              {tr(invite.email ? "定向邀请" : "公开链接")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="grid gap-1">
                              <span>{invite.email ?? tr("不限邮箱")}</span>
                              {invite.existingUser && (
                                <span className="text-xs text-muted-foreground">
                                  {tr("平台内账号")}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {invite.role?.label ?? roleLabel(invite.roleId)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {invite.invitedBy ? (
                              <div className="flex min-w-0 items-center gap-2">
                                <UserAvatar
                                  className="size-6"
                                  size="sm"
                                  user={invite.invitedBy}
                                />
                                <div className="min-w-0">
                                  <div className="truncate">
                                    {invite.invitedBy.displayName ||
                                      invite.invitedBy.username ||
                                      invite.invitedBy.email}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {invite.invitedBy.email}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDateTime(invite.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={invite.status === "invited" ? "default" : "secondary"}>
                              {tr(inviteStatusLabel(invite.status))}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {invite.expireDate
                              ? formatDateTime(invite.expireDate)
                              : tr("永久有效")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {invite.acceptedCount}
                          </TableCell>
                          <TableCell className="sticky right-0 z-10 border-l bg-card text-right shadow-[-10px_0_16px_-16px_rgba(0,0,0,0.45)]">
                            <div className="flex items-center justify-end gap-1">
                              <InviteActionButton
                                disabled={!invite.link}
                                icon="copy"
                                label={tr("复制地址")}
                                onClick={() => void copyInviteLink(invite)}
                              />
                              <InviteActionButton
                                disabled={
                                  !canResendInvites ||
                                  invite.status === "accepted"
                                }
                                icon="refresh"
                                label={tr("重发")}
                                onClick={() => void resendInvite(invite)}
                              />
                              <InviteActionButton
                                disabled={
                                  !canCloseInvites ||
                                  invite.status !== "invited"
                                }
                                icon="x"
                                label={tr("关闭邀请")}
                                onClick={() => setInviteToClose(invite)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="controls">
          {!canViewOrganizationSettings ? (
            <SectionNotice
              description={tr("当前账号没有查看组织设置的权限。")}
              title={tr("无法查看组织设置")}
            />
          ) : sectionErrors.settings ? (
            <SectionNotice
              description={sectionErrors.settings}
              title={tr("组织设置加载失败")}
            />
          ) : (
            <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{tr("默认值")}</CardTitle>
                <CardDescription>
                  {tr("为空时继承平台设置，选择后保存为组织覆写")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {ORGANIZATION_DEFAULT_FIELDS.map((item) => (
                    <Field
                      label={item.label}
                      htmlFor={`organization-${item.field}`}
                      key={item.key}
                    >
                      <EnumSelect
                        disabled={!canSaveOrganizationSettings}
                        id={`organization-${item.field}`}
                        inheritedLabel={settingDefaultLabel(
                          item.key,
                          item.options,
                        )}
                        noneLabel={tr("继承平台默认")}
                        onChange={(value) => updateField(item.field, value)}
                        options={item.options}
                        placeholder={tr("继承平台默认")}
                        value={form[item.field]}
                      />
                    </Field>
                  ))}
                  <Field label="员工数" htmlFor="organization-total-employees">
                    <Input
                      disabled={!canManage}
                      id="organization-total-employees"
                      inputMode="numeric"
                      onChange={(event) =>
                        updateField("totalEmployees", event.target.value)
                      }
                      type="number"
                      value={form.totalEmployees}
                    />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button
                    disabled={!canManage || !dirty || saving}
                    onClick={save}
                    type="button"
                  >
                    {tr("保存")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{tr("基础控制项")}</CardTitle>
                <CardDescription>
                  {tr("为空时继承平台默认，选择后保存为组织覆写")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {CONTROL_KEYS.map((item) => (
                    <Field
                      htmlFor={`organization-setting-${item.key}`}
                      key={item.key}
                      label={item.label}
                    >
                      <EnumSelect
                        disabled={!canManage}
                        id={`organization-setting-${item.key}`}
                        inheritedLabel={settingDefaultLabel(
                          item.key,
                          item.options,
                        )}
                        noneLabel={tr("继承平台默认")}
                        onChange={(value) =>
                          setControlValues((current) => ({
                            ...current,
                            [item.key]: value,
                          }))
                        }
                        options={item.options}
                        placeholder={tr("继承平台默认")}
                        value={controlValues[item.key] ?? ""}
                      />
                    </Field>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    disabled={!canSaveOrganizationSettings || savingControls}
                    onClick={saveControls}
                    type="button"
                  >
                    {tr("保存")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{tr("自定义设置")}</CardTitle>
                  <CardDescription>
                    {tr("新增组织专属设置，或覆写平台自定义默认值")}
                  </CardDescription>
                </div>
                <CustomSettingDialog
                  disabled={!canSaveOrganizationSettings || savingCustomSetting}
                  idPrefix="organization-custom-setting"
                  onSubmit={saveCustomSetting}
                  saving={savingCustomSetting}
                  scopeOptions={[{ label: tr("组织"), value: "organization" }]}
                  showScope
                  title={tr("添加组织设置")}
                />
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2 text-sm">
                  {customSettings.length === 0 ? (
                    <div className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm">
                      {tr("暂无自定义设置")}
                    </div>
                  ) : (
                    customSettings.map((setting) => {
                      const settingValueType = resolveSettingValueType(
                        setting.name,
                        setting.valueType,
                      );
                      const settingValueOptions = resolveSettingValueOptions(
                        setting.name,
                        setting.valueOptions,
                      );
                      const settingValueOptionsPayload =
                        cloneSettingOptions(settingValueOptions);
                      const effectiveValue =
                        setting.overrideValue ??
                        (settingValueType === "boolean" ||
                        settingValueType === "enum" ||
                        settingValueType === "secret"
                          ? (setting.defaultValue ?? "")
                          : "");

                      return (
                        <div
                          className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(16rem,1fr)_minmax(8rem,24rem)_auto] sm:items-center"
                          key={setting.id}
                        >
                          <div className="min-w-0">
                            <div className="break-all font-mono text-xs">
                              {setting.name}
                            </div>
                            <div className="text-xs">
                              {setting.isOverridden
                                ? tr("组织覆写")
                                : tr("继承平台设置")}
                            </div>
                          </div>
                          <div className="min-w-0 sm:justify-self-end">
                            <SettingValueInput
                              className="justify-end"
                              disabled={
                                !canSaveOrganizationSettings ||
                                savingCustomSetting
                              }
                              id={`organization-custom-${setting.id}`}
                              inputClassName="h-8 w-full font-mono text-xs"
                              onCommit={(nextValue) => {
                                if (
                                  settingValueType === "secret" ||
                                  String(nextValue ?? "") !==
                                    (setting.overrideValue ?? "")
                                ) {
                                  void saveCustomSetting({
                                    name: setting.name,
                                    value:
                                      nextValue === "" || nextValue === null
                                        ? null
                                        : nextValue,
                                    valueOptions: settingValueOptionsPayload,
                                    valueType: settingValueType,
                                  });
                                }
                              }}
                              value={effectiveValue}
                              valueOptions={settingValueOptions}
                              valueType={settingValueType}
                              placeholder={setting.defaultValue ?? ""}
                            />
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <SettingEditDialog
                              disabled={
                                !canSaveOrganizationSettings ||
                                savingCustomSetting
                              }
                              idPrefix={`organization-custom-${setting.id}`}
                              name={setting.name}
                              onSubmit={(entry) =>
                                saveCustomSetting({
                                  ...entry,
                                  value:
                                    entry.value === "" || entry.value === null
                                      ? null
                                      : entry.value,
                                })
                              }
                              saving={savingCustomSetting}
                              value={effectiveValue}
                              valueOptions={settingValueOptions}
                              valueType={settingValueType}
                            />
                            <Button
                              aria-label={`${tr("删除组织设置")} ${setting.name}`}
                              disabled={
                                !canSaveOrganizationSettings ||
                                savingCustomSetting ||
                                !setting.isOverridden
                              }
                              onClick={() =>
                                setCustomSettingToDelete({
                                  name: setting.name,
                                  value: null,
                                  valueOptions: settingValueOptionsPayload,
                                  valueType: settingValueType,
                                })
                              }
                              size="icon"
                              title={
                                !canSaveOrganizationSettings
                                  ? tr("当前账号无权修改组织设置")
                                  : !setting.isOverridden
                                    ? tr("该设置继承平台默认值，无需删除组织覆写")
                                    : `${tr("删除组织设置")} ${setting.name}`
                              }
                              type="button"
                              variant="ghost"
                            >
                              <AppIcon className="size-4" name="trash" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>{tr("展示资料")}</CardTitle>
              <CardDescription>
                {tr("维护组织公开展示字段")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="品牌色" htmlFor="organization-brand-color">
                  <Input
                    disabled={!canManage}
                    id="organization-brand-color"
                    onChange={(event) =>
                      updateField("brandColor", event.target.value)
                    }
                    placeholder="#0f172a"
                    value={form.brandColor}
                  />
                </Field>
                <Field label="Banner" htmlFor="organization-banner">
                  <Input
                    disabled={!canManage}
                    id="organization-banner"
                    onChange={(event) =>
                      updateField("banner", event.target.value)
                    }
                    placeholder="https://..."
                    value={form.banner}
                  />
                </Field>
              </div>
              <Field label="短描述" htmlFor="organization-short-description">
                <Textarea
                  disabled={!canManage}
                  id="organization-short-description"
                  onChange={(event) =>
                    updateField("shortDescription", event.target.value)
                  }
                  rows={3}
                  value={form.shortDescription}
                />
              </Field>
              <Field label="客户/领域聚焦" htmlFor="organization-client-focus">
                <Textarea
                  disabled={!canManage}
                  id="organization-client-focus"
                  onChange={(event) =>
                    updateField("clientFocus", event.target.value)
                  }
                  rows={3}
                  value={form.clientFocus}
                />
              </Field>
              <Field label="组织概览" htmlFor="organization-overview">
                <Textarea
                  disabled={!canManage}
                  id="organization-overview"
                  onChange={(event) =>
                    updateField("overview", event.target.value)
                  }
                  rows={5}
                  value={form.overview}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editUser && (
        <Dialog
          onOpenChange={(open) => {
            if (!open) setEditUser(null);
          }}
          open={true}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("编辑成员")}</DialogTitle>
            </DialogHeader>
            <OrganizationUserForm
              initialRoleId={membershipForUser(editUser.id)?.roleId ?? null}
              membershipId={membershipForUser(editUser.id)?.id ?? null}
              mode="edit"
              organizationId={organization.id}
              roles={assignableRoles}
              user={editUser}
              onDone={() => {
                setEditUser(null);
                void load();
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <Separator />
      <div className="flex justify-end gap-2">
        <Button
          disabled={!dirty || saving}
          onClick={() => setForm(toOrganizationForm(organization))}
          variant="outline"
        >
          {tr("重置")}
        </Button>
        <Button disabled={!canSaveOrganization || !dirty || saving} onClick={save}>
          {tr("保存")}
        </Button>
      </div>
      <ConfirmActionDialog
        confirmLabel="删除"
        description={
          customSettingToDelete
            ? `${tr("将删除组织覆写设置")} ${customSettingToDelete.name}`
            : ""
        }
        onConfirm={() => {
          if (customSettingToDelete) void saveCustomSetting(customSettingToDelete);
          setCustomSettingToDelete(null);
        }}
        onOpenChange={(open) => {
          if (!open) setCustomSettingToDelete(null);
        }}
        open={Boolean(customSettingToDelete)}
        pending={savingCustomSetting}
        title="删除组织设置"
      />
      <ConfirmActionDialog
        confirmLabel="关闭"
        description={
          inviteToClose
            ? inviteToClose.email
              ? `${tr("关闭后该用户将无法通过此邀请加入组织")} ${inviteToClose.email}`
              : tr("关闭后该公开邀请链接将无法继续加入组织")
            : ""
        }
        onConfirm={() => void closeInvite()}
        onOpenChange={(open) => {
          if (!open) setInviteToClose(null);
        }}
        open={Boolean(inviteToClose)}
        pending={closingInvite}
        title="关闭邀请"
      />
    </section>
  );
}

function SectionNotice({
  className,
  description,
  title,
}: {
  className?: string;
  description: string;
  title: string;
}) {
  return (
    <div
      className={`rounded-md border bg-muted/30 px-3 py-3 text-sm${
        className ? ` ${className}` : ""
      }`}
    >
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-muted-foreground">{description}</div>
    </div>
  );
}

function InviteActionButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ComponentProps<typeof AppIcon>["name"];
  label: string;
  onClick: () => void;
}) {
  const button = (
    <Button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <AppIcon className="size-3.5" name={icon} />
    </Button>
  );

  if (disabled) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function OrganizationInviteForm({
  organizationId,
  roles,
  onDone,
}: {
  organizationId: string;
  roles: Role[];
  onDone: () => void;
}) {
  const tr = useTextTranslation();
  const notifications = useNotifications();
  const [inviteMode, setInviteMode] = useState<"directed" | "open">("open");
  const [emails, setEmails] = useState("");
  const [expiresIn, setExpiresIn] = useState<"3d" | "7d" | "never">("3d");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "none");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  const parsedEmails = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...selectedEmails,
            ...emails
              .split(/[\s,;，；]+/)
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean),
          ],
        ),
      ),
    [emails, selectedEmails],
  );

  useEffect(() => {
    if (inviteMode !== "directed" || userSearch.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearchingUsers(true);
      void requireAuthenticatedAdminSessionMarker()
        .then((token) => searchUsers(token, userSearch))
        .then(setUserSearchResults)
        .catch(() => setUserSearchResults([]))
        .finally(() => setSearchingUsers(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [inviteMode, userSearch]);

  function addEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setSelectedEmails((current) =>
      current.includes(normalized) ? current : [...current, normalized],
    );
    setUserSearch("");
    setUserSearchResults([]);
  }

  function removeEmail(email: string) {
    setSelectedEmails((current) => current.filter((item) => item !== email));
  }

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const emailIds = inviteMode === "directed" ? parsedEmails : [];
      const token = await requireAuthenticatedAdminSessionMarker();
      const result = await createOrganizationInvites(token, organizationId, {
        emailIds,
        expiresIn,
        roleId: roleId === "none" ? undefined : roleId,
      });
      notifications.success(
        emailIds.length
          ? `${tr("邀请已发送")} ${result.total}${result.ignored ? `, ${tr("已忽略")} ${result.ignored}` : ""}`
          : tr("公开邀请链接已创建"),
      );
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr("发送失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field htmlFor="organization-invite-mode" label="邀请类型">
        <Select
          onValueChange={(value) => setInviteMode(value as "directed" | "open")}
          value={inviteMode}
        >
          <SelectTrigger id="organization-invite-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{tr("公开链接")}</SelectItem>
            <SelectItem value="directed">{tr("定向邀请")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {inviteMode === "directed" && (
        <>
          <Field htmlFor="organization-invite-user-search" label="搜索用户">
            <Input
              id="organization-invite-user-search"
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder={tr("输入邮箱、名称或手机号")}
              value={userSearch}
            />
          </Field>
          {(searchingUsers || userSearchResults.length > 0) && (
            <div className="max-h-40 overflow-auto rounded-md border">
              {searchingUsers ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {tr("搜索中...")}
                </div>
              ) : (
                userSearchResults.map((user) => (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    key={user.id}
                    onClick={() => addEmail(user.email)}
                    type="button"
                  >
                    <UserAvatar className="size-6" size="sm" user={user} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {user.displayName || user.username || user.email}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          <Field htmlFor="organization-invite-emails" label="指定邮箱">
            <Textarea
              id="organization-invite-emails"
              onChange={(event) => setEmails(event.target.value)}
              placeholder="user@example.com, another@example.com"
              rows={3}
              value={emails}
            />
          </Field>
          {selectedEmails.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedEmails.map((email) => (
                <Badge key={email} variant="secondary">
                  {email}
                  <button
                    aria-label={`${tr("移除")} ${email}`}
                    className="ml-1"
                    onClick={() => removeEmail(email)}
                    type="button"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
      <Field htmlFor="organization-invite-role" label="角色">
        <Select onValueChange={setRoleId} value={roleId}>
          <SelectTrigger id="organization-invite-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{tr("未分配")}</SelectItem>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="organization-invite-expiry" label="有效期">
        <Select
          onValueChange={(value) =>
            setExpiresIn(value as "3d" | "7d" | "never")
          }
          value={expiresIn}
        >
          <SelectTrigger id="organization-invite-expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3d">{tr("3 天")}</SelectItem>
            <SelectItem value="7d">{tr("7 天")}</SelectItem>
            <SelectItem value="never">{tr("永久")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {msg && <div className="text-sm text-destructive">{msg}</div>}
      <Button disabled={saving} onClick={submit}>
        {saving
          ? tr("发送中...")
          : inviteMode === "open"
            ? tr("创建邀请链接")
            : tr("发送邀请")}
      </Button>
    </div>
  );
}

function OrganizationUserForm({
  initialRoleId,
  membershipId,
  mode,
  organizationId,
  roles,
  user,
  onDone,
}: {
  initialRoleId?: string | null;
  membershipId?: string | null;
  mode: "create" | "edit";
  organizationId: string;
  roles: Role[];
  user?: User;
  onDone: () => void;
}) {
  const tr = useTextTranslation();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(initialRoleId ?? roles[0]?.id ?? "none");
  const [status, setStatus] = useState<UserStatus>(user?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      if (mode === "create") {
        await createOrganizationMember(token, organizationId, {
          displayName,
          email,
          password,
          roleId: roleId === "none" ? null : roleId,
          status,
        });
      } else if (membershipId) {
        await updateOrganizationMember(token, organizationId, membershipId, {
          displayName,
          roleId: roleId === "none" ? null : roleId,
          status,
        });
      }
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field htmlFor="organization-user-name" label="名称">
        <Input
          id="organization-user-name"
          onChange={(event) => setDisplayName(event.target.value)}
          value={displayName}
        />
      </Field>
      <Field htmlFor="organization-user-email" label="邮箱">
        <Input
          disabled={mode === "edit"}
          id="organization-user-email"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
      </Field>
      {mode === "create" && (
        <Field htmlFor="organization-user-password" label="密码">
          <Input
            id="organization-user-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </Field>
      )}
      <Field htmlFor="organization-user-role" label="角色">
        <Select onValueChange={setRoleId} value={roleId}>
          <SelectTrigger id="organization-user-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{tr("未分配")}</SelectItem>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="organization-user-status" label="状态">
        <Select
          onValueChange={(value) => setStatus(value as UserStatus)}
          value={status}
        >
          <SelectTrigger id="organization-user-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{tr("启用")}</SelectItem>
            <SelectItem value="disabled">{tr("禁用")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {msg && <div className="text-sm">{msg}</div>}
      <Button
        disabled={
          saving ||
          !displayName.trim() ||
          !email.trim() ||
          (mode === "create" && !password.trim())
        }
        onClick={submit}
      >
        {mode === "create" ? tr("创建成员") : tr("保存")}
      </Button>
    </div>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  const tr = useTextTranslation();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{tr(label)}</Label>
      {children}
    </div>
  );
}

function EnumSelect({
  disabled,
  id,
  inheritedLabel,
  noneLabel = "未设置",
  onChange,
  options,
  placeholder,
  value,
}: {
  disabled?: boolean;
  id: string;
  inheritedLabel?: string;
  noneLabel?: string;
  onChange: (value: string) => void;
  options: readonly SettingOption[];
  placeholder: string;
  value: string;
}) {
  const tr = useTextTranslation();
  const displayLabel =
    options.find((option) => option.value === value)?.label ??
    inheritedLabel ??
    noneLabel;

  return (
    <Select
      disabled={disabled}
      onValueChange={(nextValue) =>
        onChange(nextValue === "__none__" ? "" : nextValue)
      }
      value={value || "__none__"}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={tr(placeholder)}>{tr(displayLabel)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{tr(noneLabel)}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {tr(option.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function inviteStatusLabel(status: Invite["status"]) {
  switch (status) {
    case "accepted":
      return "已接受";
    case "declined":
      return "已拒绝";
    case "expired":
      return "已过期";
    case "revoked":
      return "已关闭";
    case "invited":
    default:
      return "待接受";
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function emptyOrganizationForm(): OrganizationForm {
  return {
    banner: "",
    brandColor: "",
    clientFocus: "",
    currency: "",
    dateFormat: "",
    imageUrl: "",
    isDefault: false,
    name: "",
    officialName: "",
    overview: "",
    preferredLanguage: "",
    profileLink: "",
    regionCode: "",
    shortDescription: "",
    slug: "",
    status: "active",
    subdomain: "",
    timeZone: "",
    totalEmployees: "",
    website: "",
  };
}

function toOrganizationForm(organization: Organization): OrganizationForm {
  return {
    banner: organization.banner ?? "",
    brandColor: organization.brandColor ?? "",
    clientFocus: organization.clientFocus ?? "",
    currency: organization.currency ?? "",
    dateFormat: organization.dateFormat ?? "",
    imageUrl: organization.imageUrl ?? "",
    isDefault: organization.isDefault,
    name: organization.name ?? "",
    officialName: organization.officialName ?? "",
    overview: organization.overview ?? "",
    preferredLanguage: organization.preferredLanguage ?? "",
    profileLink: organization.profileLink ?? "",
    regionCode: organization.regionCode ?? "",
    shortDescription: organization.shortDescription ?? "",
    slug: organization.slug ?? "",
    status: organization.status,
    subdomain: organization.subdomain ?? "",
    timeZone: organization.timeZone ?? "",
    totalEmployees:
      organization.totalEmployees == null
        ? ""
        : String(organization.totalEmployees),
    website: organization.website ?? "",
  };
}

function toOrganizationPayload(
  form: OrganizationForm,
  options: { includePlatformControls: boolean },
): OrganizationPayload {
  const payload: OrganizationPayload = {
    banner: nullableText(form.banner),
    brandColor: nullableText(form.brandColor),
    clientFocus: nullableText(form.clientFocus),
    currency: nullableText(form.currency),
    dateFormat: nullableText(form.dateFormat),
    imageUrl: nullableText(form.imageUrl),
    name: form.name,
    officialName: nullableText(form.officialName),
    overview: nullableText(form.overview),
    preferredLanguage: nullableText(form.preferredLanguage),
    profileLink: nullableText(form.profileLink),
    regionCode: nullableText(form.regionCode),
    shortDescription: nullableText(form.shortDescription),
    slug: form.slug,
    subdomain: nullableText(form.subdomain),
    timeZone: nullableText(form.timeZone),
    totalEmployees: parseOptionalNumber(form.totalEmployees),
    website: nullableText(form.website),
  };

  if (options.includePlatformControls) {
    payload.isDefault = form.isDefault;
    payload.status = form.status;
  }

  return payload;
}

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function formatSectionError(error: unknown, fallback: string) {
  if (error instanceof AdminApiError && error.status === 403) {
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function cloneSettingOptions(
  options?: readonly { label: string; value: string }[] | null,
) {
  return options?.map((option) => ({ ...option })) ?? null;
}

function parseOptionalNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOrganizationTab(value: string | null): value is OrganizationTab {
  return (
    value === "general" ||
    value === "members" ||
    value === "controls" ||
    value === "profile"
  );
}
