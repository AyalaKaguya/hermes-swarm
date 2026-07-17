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
import { useAdminShell } from "@/components/admin-shell";
import { useNotifications } from "@/components/app-notifications";
import { AppIcon } from "@/components/app-icon";
import { InlineNotice } from "@/components/inline-notice";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchMe,
  updateUser,
  updateUserPassword,
  updateUserRuntimePreferences,
  uploadAdminFile,
  type User,
} from "@/lib/admin-api";
import {
  getAuthenticatedAdminSessionMarker,
  requireAuthenticatedAdminSessionMarker,
} from "@/lib/authenticated-admin";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  LANGUAGE_OPTIONS,
  TIME_ZONE_OPTIONS,
} from "@hermes-swarm/core/settings/definitions";

type ProfileForm = {
  displayName: string;
  email: string;
  firstName: string;
  lastName: string;
  preferredLanguage: string;
  timeZone: string;
};

type PasswordForm = {
  confirmPassword: string;
  currentPassword: string;
  password: string;
};

const EMPTY_PASSWORD: PasswordForm = {
  confirmPassword: "",
  currentPassword: "",
  password: "",
};

export default function AccountPage() {
  const { refreshSnapshot, snapshot } = useAdminShell();
  const notifications = useNotifications();
  const tr = useTextTranslation();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState<PasswordForm>(EMPTY_PASSWORD);
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile());
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const shellUser = snapshot?.user ?? null;

  const load = useCallback(async () => {
    const token = await getAuthenticatedAdminSessionMarker();
    if (shellUser) {
      setUser(shellUser);
      setProfile(toProfileForm(shellUser));
    }

    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const me = await fetchMe(token);
      if (me.principalType !== "tenant") {
        throw new Error(tr("当前页面仅适用于租户账号"));
      }
      setUser(me.user);
      setProfile(toProfileForm(me.user));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("加载失败"));
    } finally {
      setLoading(false);
    }
  }, [shellUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const profileDirty = useMemo(() => {
    if (!user) return false;
    const saved = toProfileForm(user);
    return (
      profile.displayName !== saved.displayName ||
      profile.email !== saved.email ||
      profile.firstName !== saved.firstName ||
      profile.lastName !== saved.lastName
      || profile.preferredLanguage !== saved.preferredLanguage
      || profile.timeZone !== saved.timeZone
    );
  }, [profile, user]);

  function resetProfile() {
    if (!user) return;
    setProfile(toProfileForm(user));
    setError(null);
  }

  function resetPassword() {
    setPassword(EMPTY_PASSWORD);
    setError(null);
  }

  async function saveProfile() {
    if (!user) return;

    setSavingProfile(true);
    setError(null);

    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      let updated = await updateUser(token, {
        displayName: profile.displayName,
        email: profile.email,
        firstName: profile.firstName || null,
        lastName: profile.lastName || null,
      });
      const savedPreferences = toProfileForm(user);
      if (
        profile.preferredLanguage !== savedPreferences.preferredLanguage ||
        profile.timeZone !== savedPreferences.timeZone
      ) {
        updated = await updateUserRuntimePreferences(token, {
          preferredLanguage:
            profile.preferredLanguage === "inherit"
              ? null
              : profile.preferredLanguage,
          timeZone: profile.timeZone === "inherit" ? null : profile.timeZone,
        });
      }
      setUser(updated);
      setProfile(toProfileForm(updated));
      notifications.success(tr("个人资料已保存"));
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("保存失败"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!user) return;

    setUploadingAvatar(true);
    setError(null);
    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      const uploaded = await uploadAdminFile(token, file);
      const imageUrl =
        uploaded.url ??
        uploaded.destinations.find(
          (item) => item.status === "success" && item.url,
        )?.url;
      if (!imageUrl) {
        throw new Error(tr("上传成功但未返回图片地址"));
      }
      const updated = await updateUser(token, {
        imageUrl,
      });
      setUser(updated);
      notifications.success(tr("头像已上传"));
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("上传失败"));
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadAvatar(file);
  }

  async function savePassword() {
    if (!user) return;

    const validationError = validatePassword(password, tr);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSavingPassword(true);
    setError(null);

    try {
      const token = await requireAuthenticatedAdminSessionMarker();
      await updateUserPassword(token, {
        currentPassword: password.currentPassword,
        password: password.password,
      });
      setPassword(EMPTY_PASSWORD);
      notifications.success(tr("密码已更新"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("修改失败"));
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {tr("加载中...")}
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex items-center justify-center py-16 text-sm"
        role={error ? "alert" : undefined}
      >
        {error ?? tr("请先登录")}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <Card size="sm">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar size="lg" user={user} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {user.displayName || user.email}
              </div>

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("界面语言")} htmlFor="account-language">
                  <Select
                    onValueChange={(value) =>
                      setProfile((current) => ({
                        ...current,
                        preferredLanguage: value,
                      }))
                    }
                    value={profile.preferredLanguage}
                  >
                    <SelectTrigger id="account-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        {tr("跟随工作空间")}
                      </SelectItem>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={tr("个人时区")} htmlFor="account-time-zone">
                  <Select
                    onValueChange={(value) =>
                      setProfile((current) => ({
                        ...current,
                        timeZone: value,
                      }))
                    }
                    value={profile.timeZone}
                  >
                    <SelectTrigger id="account-time-zone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        {tr("跟随工作空间")}
                      </SelectItem>
                      {TIME_ZONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {tr(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="truncate text-xs">{user.email}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Input
              accept="image/*"
              className="hidden"
              onChange={onAvatarChange}
              ref={avatarInputRef}
              type="file"
            />
            <Button
              disabled={uploadingAvatar}
              onClick={() => avatarInputRef.current?.click()}
              size="sm"
              type="button"
              variant="outline"
            >
              <AppIcon className="size-3.5" name="image-upload" />
              {uploadingAvatar ? tr("上传中...") : tr("上传头像")}
            </Button>
            <span
              aria-label={
                user.status === "active" ? tr("账号正常") : tr("账号已停用")
              }
              className={
                user.status === "active"
                  ? "size-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15"
                  : "size-2.5 rounded-full bg-rose-500 ring-4 ring-rose-500/15"
              }
              role="status"
              title={user.status === "active" ? tr("账号正常") : tr("账号已停用")}
            />
          </div>
        </CardContent>
      </Card>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <Tabs defaultValue="profile">
        <TabsList className="w-fit">
          <TabsTrigger value="profile">{tr("个人资料")}</TabsTrigger>
          <TabsTrigger value="password">{tr("密码")}</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-2" value="profile">
          <Card>
            <CardHeader>
              <CardTitle>{tr("个人资料")}</CardTitle>
              <CardDescription>
                {tr("维护你的名称和邮箱，头像只能通过图片上传更新")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("显示名称")} htmlFor="account-display-name">
                  <Input
                    id="account-display-name"
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    value={profile.displayName}
                  />
                </Field>
                <Field label={tr("邮箱")} htmlFor="account-email">
                  <Input
                    id="account-email"
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    type="email"
                    value={profile.email}
                  />
                </Field>
                <Field label={tr("名")} htmlFor="account-first-name">
                  <Input
                    id="account-first-name"
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        firstName: event.target.value,
                      }))
                    }
                    value={profile.firstName}
                  />
                </Field>
                <Field label={tr("姓")} htmlFor="account-last-name">
                  <Input
                    id="account-last-name"
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        lastName: event.target.value,
                      }))
                    }
                    value={profile.lastName}
                  />
                </Field>
              </div>

              <Separator />

              <div className="flex justify-end gap-2">
                <Button
                  disabled={!profileDirty || savingProfile}
                  onClick={resetProfile}
                  type="button"
                  variant="outline"
                >
                  {tr("重置")}
                </Button>
                <Button
                  disabled={!profileDirty || savingProfile}
                  onClick={saveProfile}
                  type="button"
                >
                  {tr("保存")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-2" value="password">
          <Card>
            <CardHeader>
              <CardTitle>{tr("修改密码")}</CardTitle>
              <CardDescription>{tr("更新当前账号的登录密码")}</CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-md gap-4">
              <Field label={tr("当前密码")} htmlFor="account-current-password">
                <Input
                  autoComplete="current-password"
                  id="account-current-password"
                  onChange={(event) =>
                    setPassword((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                  type="password"
                  value={password.currentPassword}
                />
              </Field>
              <Field label={tr("新密码")} htmlFor="account-new-password">
                <Input
                  autoComplete="new-password"
                  id="account-new-password"
                  onChange={(event) =>
                    setPassword((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder={tr("至少 8 位")}
                  type="password"
                  value={password.password}
                />
              </Field>
              <Field label={tr("确认密码")} htmlFor="account-confirm-password">
                <Input
                  autoComplete="new-password"
                  id="account-confirm-password"
                  onChange={(event) =>
                    setPassword((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  type="password"
                  value={password.confirmPassword}
                />
              </Field>

              <Separator />

              <div className="flex justify-end gap-2">
                <Button
                  disabled={savingPassword}
                  onClick={resetPassword}
                  type="button"
                  variant="outline"
                >
                  {tr("重置")}
                </Button>
                <Button
                  disabled={savingPassword}
                  onClick={savePassword}
                  type="button"
                >
                  {tr("修改密码")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
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

function emptyProfile(): ProfileForm {
  return {
    displayName: "",
    email: "",
    firstName: "",
    lastName: "",
    preferredLanguage: "inherit",
    timeZone: "inherit",
  };
}

function toProfileForm(user: User): ProfileForm {
  return {
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    preferredLanguage: user.preferredLanguage ?? "inherit",
    timeZone: user.timeZone ?? "inherit",
  };
}

function validatePassword(
  form: PasswordForm,
  tr: (value: string) => string,
) {
  if (!form.currentPassword) return tr("请输入当前密码");
  if (form.password.length < 8) return tr("新密码至少 8 位");
  if (form.password !== form.confirmPassword) return tr("两次输入的密码不一致");
  return null;
}
