"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import {
  createOrganizationGroup,
  createOrganizationUser,
  deleteOrganizationGroup,
  getOrganization,
  listOrganizationGroups,
  listOrganizationRoles,
  listOrganizationSettingsForOrganization,
  listOrganizationUsers,
  saveOrganizationSettingsForOrganization,
  updateOrganizationGroup,
  updateOrganizationGroupMembers,
  updateOrganizationUser,
  updateOrganization,
  uploadAdminFile,
  type GroupDto,
  type Organization,
  type OrganizationPayload,
  type OrganizationSetting,
  type Role,
  type User,
  type UserStatus,
} from "@/lib/admin-api";
import { getStoredSession, hasMenuAccess } from "@/lib/session";
import { cn } from "@/lib/utils";

type SelectOption = {
  label: string;
  value: string;
};

const CURRENCY_OPTIONS: SelectOption[] = [
  { label: "人民币 (CNY)", value: "CNY" },
  { label: "美元 (USD)", value: "USD" },
  { label: "欧元 (EUR)", value: "EUR" },
  { label: "英镑 (GBP)", value: "GBP" },
  { label: "日元 (JPY)", value: "JPY" },
  { label: "港币 (HKD)", value: "HKD" },
  { label: "新加坡元 (SGD)", value: "SGD" },
];
const TIME_ZONE_OPTIONS: SelectOption[] = [
  { label: "中国标准时间 (Asia/Shanghai)", value: "Asia/Shanghai" },
  { label: "协调世界时 (UTC)", value: "UTC" },
  { label: "美国东部时间 (America/New_York)", value: "America/New_York" },
  { label: "伦敦时间 (Europe/London)", value: "Europe/London" },
  { label: "东京时间 (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "新加坡时间 (Asia/Singapore)", value: "Asia/Singapore" },
];
const REGION_OPTIONS: SelectOption[] = [
  { label: "中国 (CN)", value: "CN" },
  { label: "美国 (US)", value: "US" },
  { label: "英国 (GB)", value: "GB" },
  { label: "欧盟 (EU)", value: "EU" },
  { label: "日本 (JP)", value: "JP" },
  { label: "新加坡 (SG)", value: "SG" },
  { label: "中国香港 (HK)", value: "HK" },
];
const DATE_FORMAT_OPTIONS: SelectOption[] = [
  { label: "YYYY-MM-DD", value: "YYYY-MM-DD" },
  { label: "YYYY/MM/DD", value: "YYYY/MM/DD" },
  { label: "MM/DD/YYYY", value: "MM/DD/YYYY" },
  { label: "DD/MM/YYYY", value: "DD/MM/YYYY" },
];
const LANGUAGE_OPTIONS: SelectOption[] = [
  { label: "中文", value: "zh-CN" },
  { label: "English", value: "en" },
  { label: "繁体中文", value: "zh-Hant" },
];
const PASSWORD_LENGTH_OPTIONS: SelectOption[] = [6, 8, 10, 12, 16].map((value) => ({
  label: `${value} 位`,
  value: String(value),
}));

const CONTROL_KEYS = [
  {
    key: "auth.passwordPolicy.minLength",
    label: "密码最小长度",
    options: PASSWORD_LENGTH_OPTIONS,
  },
  {
    key: "organization.defaultLanguage",
    label: "默认语言",
    options: LANGUAGE_OPTIONS,
  },
  {
    key: "organization.defaultTimeZone",
    label: "默认时区",
    options: TIME_ZONE_OPTIONS,
  },
];

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

type OrganizationTab = "controls" | "general" | "groups" | "members" | "profile";

export default function OrganizationDetailPage() {
  const params = useParams<{ orgId?: string | string[] }>();
  const searchParams = useSearchParams();
  const organizationId = Array.isArray(params.orgId) ? params.orgId[0] : params.orgId;
  const { refreshSnapshot, resolvedSession, snapshot } = useAdminShell();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<OrganizationTab>("general");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [controlValues, setControlValues] = useState<Record<string, string>>({});
  const [editUser, setEditUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<OrganizationForm>(emptyOrganizationForm());
  const [groupDescription, setGroupDescription] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSetting[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [savingGroup, setSavingGroup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingControls, setSavingControls] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const canManage =
    snapshot && resolvedSession
      ? hasMenuAccess(snapshot, resolvedSession, "organizations", "manage") ||
        hasMenuAccess(snapshot, resolvedSession, "organization", "manage")
      : false;
  const isPlatformScope = snapshot?.scope.level === "platform";

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token || !organizationId) {
      setLoading(false);
      return;
    }

    setToken(session.token);
    setError(null);
    try {
      const [data, settings, userItems, roleItems, groupItems] = await Promise.all([
        getOrganization(session.token, organizationId),
        listOrganizationSettingsForOrganization(session.token, organizationId),
        listOrganizationUsers(session.token, organizationId),
        listOrganizationRoles(session.token, organizationId),
        listOrganizationGroups(session.token, organizationId),
      ]);
      setOrganization(data);
      setForm(toOrganizationForm(data));
      setOrganizationSettings(settings);
      setUsers(userItems);
      setRoles(roleItems);
      setGroups(groupItems);
      setSelectedGroupId((current) =>
        current && groupItems.some((group) => group.id === current)
          ? current
          : groupItems[0]?.id ?? null,
      );
      setControlValues(
        Object.fromEntries(
          CONTROL_KEYS.map((item) => [
            item.key,
            settings.find((setting) => setting.name === item.key)?.value ?? "",
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isOrganizationTab(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const dirty = useMemo(() => {
    if (!organization) return false;
    return JSON.stringify(form) !== JSON.stringify(toOrganizationForm(organization));
  }, [form, organization]);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const customSettings = useMemo(
    () =>
      organizationSettings.filter(
        (setting) => !CONTROL_KEYS.some((item) => item.key === setting.name),
      ),
    [organizationSettings],
  );

  useEffect(() => {
    if (!selectedGroup) {
      setGroupName("");
      setGroupDescription("");
      setGroupMemberIds([]);
      return;
    }
    setGroupName(selectedGroup.name);
    setGroupDescription(selectedGroup.description ?? "");
    setGroupMemberIds(selectedGroup.memberIds);
  }, [selectedGroup]);

  function updateField<K extends keyof OrganizationForm>(key: K, value: OrganizationForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!organization || !token || !canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateOrganization(token, organization.id, toOrganizationPayload(form));
      setOrganization(updated);
      setForm(toOrganizationForm(updated));
      setMessage("组织配置已保存");
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!organization || !token || !canManage) return;
    setUploadingLogo(true);
    setError(null);
    setMessage(null);
    try {
      const uploaded = await uploadAdminFile(token, file);
      const imageUrl =
        uploaded.url ??
        uploaded.destinations.find((item) => item.status === "success" && item.url)?.url;
      if (!imageUrl) throw new Error("上传成功但未返回图片地址");
      const updated = await updateOrganization(token, organization.id, { imageUrl });
      setOrganization(updated);
      setForm(toOrganizationForm(updated));
      setMessage("组织 Logo 已上传");
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function saveControls() {
    if (!organization || !token || !canManage) return;
    setSavingControls(true);
    setError(null);
    setMessage(null);
    try {
      await saveOrganizationSettingsForOrganization(
        token,
        organization.id,
        {
          settings: CONTROL_KEYS.map((item) => ({
            name: item.key,
            value: controlValues[item.key] ?? "",
          })),
        },
      );
      const settings = await listOrganizationSettingsForOrganization(
        token,
        organization.id,
      );
      setOrganizationSettings(settings);
      setMessage("组织控制项已保存");
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingControls(false);
    }
  }

  async function saveGroupDetails() {
    if (!organization || !selectedGroup || !token || !canManage) return;
    setSavingGroup(true);
    setError(null);
    setMessage(null);
    try {
      await updateOrganizationGroup(token, organization.id, selectedGroup.id, {
        name: groupName.trim(),
        description: groupDescription.trim() || null,
      });
      await updateOrganizationGroupMembers(
        token,
        organization.id,
        selectedGroup.id,
        groupMemberIds,
      );
      setMessage("用户组已保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingGroup(false);
    }
  }

  async function deleteSelectedGroup() {
    if (!organization || !selectedGroup || !token || !canManage) return;
    setSavingGroup(true);
    setError(null);
    setMessage(null);
    try {
      await deleteOrganizationGroup(token, organization.id, selectedGroup.id);
      setSelectedGroupId(null);
      setMessage("用户组已删除");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSavingGroup(false);
    }
  }

  function onLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadLogo(file);
  }

  function roleLabel(roleId: string | null) {
    return roles.find((role) => role.id === roleId)?.label ?? "-";
  }

  function toggleGroupMember(userId: string) {
    setGroupMemberIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  }

  if (!organization) {
    return (
      <div className="grid gap-3">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {isPlatformScope && (
          <Button asChild className="w-fit" size="sm" variant="outline">
            <Link href="/settings/organizations">返回组织列表</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {isPlatformScope && (
            <Button asChild className="-ml-2 mb-2" size="sm" variant="ghost">
              <Link href="/settings/organizations">
                <AppIcon className="size-3.5" name="arrow-left" />
                返回组织列表
              </Link>
            </Button>
          )}
          <h1 className="truncate text-lg font-semibold">{organization.name}</h1>
          <p className="break-all text-sm text-muted-foreground">
            org_id: <span className="font-mono">{organization.id}</span>
          </p>
        </div>
        <Badge variant={organization.status === "active" ? "default" : "secondary"}>
          {organization.status === "active" ? "启用" : "已停用"}
        </Badge>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      )}

      <Tabs
        onValueChange={(value) => {
          if (isOrganizationTab(value)) setActiveTab(value);
        }}
        value={activeTab}
      >
        <TabsList>
          <TabsTrigger value="general">常规</TabsTrigger>
          <TabsTrigger value="members">成员</TabsTrigger>
          <TabsTrigger value="groups">用户组</TabsTrigger>
          <TabsTrigger value="controls">控制项</TabsTrigger>
          <TabsTrigger value="profile">展示</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-3" value="general">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <Card>
              <CardHeader>
                <CardTitle>组织信息</CardTitle>
                <CardDescription>维护组织名称、标识和生命周期</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ReadOnly label="组织 ID">{organization.id}</ReadOnly>
                <Field label="名称" htmlFor="organization-name">
                  <Input
                    disabled={!canManage}
                    id="organization-name"
                    onChange={(event) => updateField("name", event.target.value)}
                    value={form.name}
                  />
                </Field>
                <Field label="标识符" htmlFor="organization-slug">
                  <Input
                    disabled={!canManage}
                    id="organization-slug"
                    onChange={(event) => updateField("slug", event.target.value)}
                    value={form.slug}
                  />
                </Field>
                <Field label="子域名" htmlFor="organization-subdomain">
                  <Input
                    disabled={!canManage}
                    id="organization-subdomain"
                    onChange={(event) => updateField("subdomain", event.target.value)}
                    value={form.subdomain}
                  />
                </Field>
                <Field label="官方名称" htmlFor="organization-official-name">
                  <Input
                    disabled={!canManage}
                    id="organization-official-name"
                    onChange={(event) => updateField("officialName", event.target.value)}
                    value={form.officialName}
                  />
                </Field>
                <Field label="Profile Link" htmlFor="organization-profile-link">
                  <Input
                    disabled={!canManage}
                    id="organization-profile-link"
                    onChange={(event) => updateField("profileLink", event.target.value)}
                    value={form.profileLink}
                  />
                </Field>
                <Field label="网站" htmlFor="organization-website">
                  <Input
                    disabled={!canManage}
                    id="organization-website"
                    onChange={(event) => updateField("website", event.target.value)}
                    value={form.website}
                  />
                </Field>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="grid gap-0.5">
                    <Label htmlFor="organization-active">启用组织</Label>
                    <span className="text-xs text-muted-foreground">
                      停用后该组织用户不能继续登录
                    </span>
                  </div>
                  <Switch
                    checked={form.status === "active"}
                    disabled={!canManage}
                    id="organization-active"
                    onCheckedChange={(checked) =>
                      updateField("status", checked ? "active" : "suspended")
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="grid gap-0.5">
                    <Label htmlFor="organization-default">默认组织</Label>
                    <span className="text-xs text-muted-foreground">
                      用于租户初始组织选择
                    </span>
                  </div>
                  <Switch
                    checked={form.isDefault}
                    disabled={!canManage}
                    id="organization-default"
                    onCheckedChange={(checked) => updateField("isDefault", checked)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Logo</CardTitle>
                <CardDescription>通过上传图片更新组织头像</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-16 place-items-center overflow-hidden rounded-lg border bg-muted">
                    {form.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="size-full object-cover" src={form.imageUrl} />
                    ) : (
                      <AppIcon className="size-6 text-muted-foreground" name="building" />
                    )}
                  </div>
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{organization.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {organization.slug}
                    </div>
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
                  {uploadingLogo ? "上传中..." : "上传 Logo"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="mt-3" value="members">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>组织成员</CardTitle>
                <CardDescription>维护 URL 中 org_id 指定组织的成员账号和角色</CardDescription>
              </div>
              <Dialog onOpenChange={setCreateUserOpen} open={createUserOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!canManage} size="sm">
                    <AppIcon className="size-3.5" name="users" />
                    添加成员
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>添加成员</DialogTitle>
                  </DialogHeader>
                  <OrganizationUserForm
                    mode="create"
                    organizationId={organization.id}
                    roles={roles}
                    token={token}
                    onDone={() => {
                      setCreateUserOpen(false);
                      void load();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">成员</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-center text-muted-foreground" colSpan={5}>
                        暂无成员
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
                                <div className="truncate text-xs text-muted-foreground">
                                  @{user.username}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{user.email}</TableCell>
                        <TableCell>
                          <Badge className="text-xs" variant="outline">
                            {roleLabel(user.roleId)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className="text-xs"
                            variant={user.status === "active" ? "default" : "secondary"}
                          >
                            {user.status === "active" ? "启用" : "禁用"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            disabled={!canManage}
                            onClick={() => setEditUser(user)}
                            size="sm"
                            variant="ghost"
                          >
                            编辑
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-3" value="groups">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>用户组</CardTitle>
                <CardDescription>维护该组织内的访问分组和成员关系</CardDescription>
              </div>
              <Dialog onOpenChange={setCreateGroupOpen} open={createGroupOpen}>
                <DialogTrigger asChild>
                  <Button disabled={!canManage} size="sm">
                    <AppIcon className="size-3.5" name="layers" />
                    添加用户组
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>添加用户组</DialogTitle>
                  </DialogHeader>
                  <OrganizationGroupForm
                    organizationId={organization.id}
                    token={token}
                    onDone={(group) => {
                      setCreateGroupOpen(false);
                      setSelectedGroupId(group.id);
                      void load();
                    }}
                  />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="rounded-md border">
                  {groups.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      暂无用户组
                    </div>
                  ) : (
                    groups.map((group) => (
                      <Button
                        className={cn(
                          "h-auto w-full justify-between rounded-none border-b px-4 py-3 text-left last:border-b-0",
                          group.id === selectedGroupId && "bg-muted text-foreground",
                        )}
                        key={group.id}
                        onClick={() => setSelectedGroupId(group.id)}
                        variant="ghost"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {group.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {group.description || "无描述"}
                          </span>
                        </span>
                        <Badge variant="secondary">{group.memberCount}</Badge>
                      </Button>
                    ))
                  )}
                </div>

                {selectedGroup ? (
                  <div className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field htmlFor="organization-group-name" label="名称">
                        <Input
                          disabled={!canManage}
                          id="organization-group-name"
                          onChange={(event) => setGroupName(event.target.value)}
                          value={groupName}
                        />
                      </Field>
                      <Field htmlFor="organization-group-created-at" label="创建时间">
                        <Input
                          disabled
                          id="organization-group-created-at"
                          value={new Date(selectedGroup.createdAt).toLocaleString("zh-CN")}
                        />
                      </Field>
                    </div>
                    <Field htmlFor="organization-group-description" label="描述">
                      <Textarea
                        disabled={!canManage}
                        id="organization-group-description"
                        onChange={(event) => setGroupDescription(event.target.value)}
                        value={groupDescription}
                      />
                    </Field>
                    <div className="rounded-md border">
                      <div className="flex items-center justify-between border-b px-4 py-3">
                        <div>
                          <div className="text-sm font-medium">成员</div>
                          <div className="text-xs text-muted-foreground">
                            仅显示该组织内用户
                          </div>
                        </div>
                        <Badge variant="outline">{groupMemberIds.length} 人</Badge>
                      </div>
                      <div className="max-h-[360px] divide-y overflow-auto">
                        {users.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            暂无可选成员
                          </div>
                        ) : (
                          users.map((user) => (
                            <label
                              className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50"
                              key={user.id}
                            >
                              <Checkbox
                                checked={groupMemberIds.includes(user.id)}
                                disabled={!canManage}
                                onCheckedChange={() => toggleGroupMember(user.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {user.displayName}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {user.email}
                                </span>
                              </span>
                              <Badge
                                variant={user.status === "active" ? "default" : "secondary"}
                              >
                                {user.status === "active" ? "启用" : "禁用"}
                              </Badge>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        disabled={!canManage || savingGroup}
                        onClick={() => void deleteSelectedGroup()}
                        variant="outline"
                      >
                        删除用户组
                      </Button>
                      <Button
                        disabled={!canManage || savingGroup || !groupName.trim()}
                        onClick={() => void saveGroupDetails()}
                      >
                        {savingGroup ? "保存中..." : "保存用户组"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-80 items-center justify-center rounded-md border text-sm text-muted-foreground">
                    选择或创建一个用户组
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-3" value="controls">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>默认值</CardTitle>
                <CardDescription>维护组织级默认语言、区域、货币和格式</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="货币" htmlFor="organization-currency">
                  <EnumSelect
                    disabled={!canManage}
                    id="organization-currency"
                    onChange={(value) => updateField("currency", value)}
                    options={CURRENCY_OPTIONS}
                    placeholder="选择货币"
                    value={form.currency}
                  />
                </Field>
                <Field label="时区" htmlFor="organization-time-zone">
                  <EnumSelect
                    disabled={!canManage}
                    id="organization-time-zone"
                    onChange={(value) => updateField("timeZone", value)}
                    options={TIME_ZONE_OPTIONS}
                    placeholder="选择时区"
                    value={form.timeZone}
                  />
                </Field>
                <Field label="地区代码" htmlFor="organization-region-code">
                  <EnumSelect
                    disabled={!canManage}
                    id="organization-region-code"
                    onChange={(value) => updateField("regionCode", value)}
                    options={REGION_OPTIONS}
                    placeholder="选择地区"
                    value={form.regionCode}
                  />
                </Field>
                <Field label="日期格式" htmlFor="organization-date-format">
                  <EnumSelect
                    disabled={!canManage}
                    id="organization-date-format"
                    onChange={(value) => updateField("dateFormat", value)}
                    options={DATE_FORMAT_OPTIONS}
                    placeholder="选择格式"
                    value={form.dateFormat}
                  />
                </Field>
                <Field label="默认语言" htmlFor="organization-language">
                  <EnumSelect
                    disabled={!canManage}
                    id="organization-language"
                    onChange={(value) => updateField("preferredLanguage", value)}
                    options={LANGUAGE_OPTIONS}
                    placeholder="选择语言"
                    value={form.preferredLanguage}
                  />
                </Field>
                <Field label="员工数" htmlFor="organization-total-employees">
                  <Input
                    disabled={!canManage}
                    id="organization-total-employees"
                    inputMode="numeric"
                    onChange={(event) => updateField("totalEmployees", event.target.value)}
                    type="number"
                    value={form.totalEmployees}
                  />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>基础控制项</CardTitle>
                <CardDescription>保存到当前 URL 指定的组织</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {CONTROL_KEYS.map((item) => (
                    <Field htmlFor={`organization-setting-${item.key}`} key={item.key} label={item.label}>
                      <EnumSelect
                        disabled={!canManage}
                        id={`organization-setting-${item.key}`}
                        onChange={(value) =>
                          setControlValues((current) => ({
                            ...current,
                            [item.key]: value,
                          }))
                        }
                        options={item.options}
                        placeholder="请选择"
                        value={controlValues[item.key] ?? ""}
                      />
                    </Field>
                  ))}
                </div>
                <Button
                  className="w-fit"
                  disabled={!canManage || savingControls}
                  onClick={saveControls}
                  type="button"
                  variant="outline"
                >
                  {savingControls ? "保存中..." : "保存控制项"}
                </Button>
              </CardContent>
            </Card>

            {customSettings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>其他设置</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  {customSettings.map((setting) => (
                    <div
                      className="flex justify-between gap-3 rounded-md border px-3 py-2"
                      key={setting.id}
                    >
                      <span className="font-mono text-xs">{setting.name}</span>
                      <span className="truncate text-muted-foreground">
                        {setting.value ?? "-"}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent className="mt-3" value="profile">
          <Card>
            <CardHeader>
              <CardTitle>展示资料</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="品牌色" htmlFor="organization-brand-color">
                  <Input
                    disabled={!canManage}
                    id="organization-brand-color"
                    onChange={(event) => updateField("brandColor", event.target.value)}
                    placeholder="#0f172a"
                    value={form.brandColor}
                  />
                </Field>
                <Field label="Banner" htmlFor="organization-banner">
                  <Input
                    disabled={!canManage}
                    id="organization-banner"
                    onChange={(event) => updateField("banner", event.target.value)}
                    placeholder="https://..."
                    value={form.banner}
                  />
                </Field>
              </div>
              <Field label="短描述" htmlFor="organization-short-description">
                <Textarea
                  disabled={!canManage}
                  id="organization-short-description"
                  onChange={(event) => updateField("shortDescription", event.target.value)}
                  rows={3}
                  value={form.shortDescription}
                />
              </Field>
              <Field label="客户/领域聚焦" htmlFor="organization-client-focus">
                <Textarea
                  disabled={!canManage}
                  id="organization-client-focus"
                  onChange={(event) => updateField("clientFocus", event.target.value)}
                  rows={3}
                  value={form.clientFocus}
                />
              </Field>
              <Field label="组织概览" htmlFor="organization-overview">
                <Textarea
                  disabled={!canManage}
                  id="organization-overview"
                  onChange={(event) => updateField("overview", event.target.value)}
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
              <DialogTitle>编辑成员</DialogTitle>
            </DialogHeader>
            <OrganizationUserForm
              mode="edit"
              organizationId={organization.id}
              roles={roles}
              token={token}
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
        <Button disabled={!dirty || saving} onClick={() => setForm(toOrganizationForm(organization))} variant="outline">
          重置
        </Button>
        <Button disabled={!canManage || !dirty || saving} onClick={save}>
          {saving ? "保存中..." : "保存配置"}
        </Button>
      </div>
    </section>
  );
}

function OrganizationUserForm({
  mode,
  organizationId,
  roles,
  token,
  user,
  onDone,
}: {
  mode: "create" | "edit";
  organizationId: string;
  roles: Role[];
  token: string;
  user?: User;
  onDone: () => void;
}) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(user?.roleId ?? roles[0]?.id ?? "none");
  const [status, setStatus] = useState<UserStatus>(user?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      if (mode === "create") {
        await createOrganizationUser(token, organizationId, {
          displayName,
          email,
          password,
          roleId: roleId === "none" ? null : roleId,
          status,
        });
      } else if (user) {
        await updateOrganizationUser(token, organizationId, user.id, {
          displayName,
          email,
          roleId: roleId === "none" ? null : roleId,
          status,
        });
      }
      onDone();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "保存失败");
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
            <SelectItem value="none">未分配</SelectItem>
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
            <SelectItem value="active">启用</SelectItem>
            <SelectItem value="disabled">禁用</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {msg && <div className="text-sm text-destructive">{msg}</div>}
      <Button
        disabled={
          saving ||
          !displayName.trim() ||
          !email.trim() ||
          (mode === "create" && !password.trim())
        }
        onClick={submit}
      >
        {saving ? "保存中..." : mode === "create" ? "创建成员" : "保存成员"}
      </Button>
    </div>
  );
}

function OrganizationGroupForm({
  organizationId,
  token,
  onDone,
}: {
  organizationId: string;
  token: string;
  onDone: (group: GroupDto) => void;
}) {
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    setSaving(true);
    setMsg("");
    try {
      const group = await createOrganizationGroup(token, organizationId, {
        name: name.trim(),
        description: description.trim() || null,
      });
      onDone(group);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field htmlFor="organization-new-group-name" label="名称">
        <Input
          id="organization-new-group-name"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </Field>
      <Field htmlFor="organization-new-group-description" label="描述">
        <Textarea
          id="organization-new-group-description"
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </Field>
      {msg && <div className="text-sm text-destructive">{msg}</div>}
      <Button disabled={saving || !name.trim()} onClick={submit}>
        {saving ? "创建中..." : "创建用户组"}
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
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function EnumSelect({
  disabled,
  id,
  onChange,
  options,
  placeholder,
  value,
}: {
  disabled?: boolean;
  id: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  value: string;
}) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(nextValue) =>
        onChange(nextValue === "__none__" ? "" : nextValue)
      }
      value={value || "__none__"}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">未设置</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReadOnly({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-1.5 sm:col-span-2">
      <Label>{label}</Label>
      <div className="break-all rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
        {children}
      </div>
    </div>
  );
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
    totalEmployees: organization.totalEmployees == null ? "" : String(organization.totalEmployees),
    website: organization.website ?? "",
  };
}

function toOrganizationPayload(form: OrganizationForm): OrganizationPayload {
  return {
    banner: nullableText(form.banner),
    brandColor: nullableText(form.brandColor),
    clientFocus: nullableText(form.clientFocus),
    currency: nullableText(form.currency),
    dateFormat: nullableText(form.dateFormat),
    imageUrl: nullableText(form.imageUrl),
    isDefault: form.isDefault,
    name: form.name,
    officialName: nullableText(form.officialName),
    overview: nullableText(form.overview),
    preferredLanguage: nullableText(form.preferredLanguage),
    profileLink: nullableText(form.profileLink),
    regionCode: nullableText(form.regionCode),
    shortDescription: nullableText(form.shortDescription),
    slug: form.slug,
    status: form.status,
    subdomain: nullableText(form.subdomain),
    timeZone: nullableText(form.timeZone),
    totalEmployees: parseOptionalNumber(form.totalEmployees),
    website: nullableText(form.website),
  };
}

function nullableText(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
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
    value === "groups" ||
    value === "controls" ||
    value === "profile"
  );
}
