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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchMe,
  updateUser,
  updateUserPassword,
  uploadAdminFile,
  type User,
} from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

type ProfileForm = {
  displayName: string;
  email: string;
  firstName: string;
  lastName: string;
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
    const session = getStoredSession();
    if (shellUser) {
      setUser(shellUser);
      setProfile(toProfileForm(shellUser));
    }

    if (!session?.accessToken) {
      setLoading(false);
      return;
    }

    try {
      const me = await fetchMe(session.accessToken);
      setUser(me.user);
      setProfile(toProfileForm(me.user));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
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
    const session = getStoredSession();
    if (!session?.accessToken || !user) return;

    setSavingProfile(true);
    setError(null);

    try {
      const updated = await updateUser(session.accessToken, user.id, {
        displayName: profile.displayName,
        email: profile.email,
        firstName: profile.firstName || null,
        lastName: profile.lastName || null,
      });
      setUser(updated);
      setProfile(toProfileForm(updated));
      notifications.success("个人资料已保存");
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file: File) {
    const session = getStoredSession();
    if (!session?.accessToken || !user) return;

    setUploadingAvatar(true);
    setError(null);
    try {
      const uploaded = await uploadAdminFile(session.accessToken, file);
      const imageUrl =
        uploaded.url ??
        uploaded.destinations.find(
          (item) => item.status === "success" && item.url,
        )?.url;
      if (!imageUrl) {
        throw new Error("上传成功但未返回图片地址");
      }
      const updated = await updateUser(session.accessToken, user.id, {
        imageUrl,
      });
      setUser(updated);
      notifications.success("头像已上传");
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
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
    const session = getStoredSession();
    if (!session?.accessToken || !user) return;

    const validationError = validatePassword(password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSavingPassword(true);
    setError(null);

    try {
      await updateUserPassword(session.accessToken, user.id, {
        currentPassword: password.currentPassword,
        password: password.password,
      });
      setPassword(EMPTY_PASSWORD);
      notifications.success("密码已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        加载中...
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex items-center justify-center py-16 text-sm"
        role={error ? "alert" : undefined}
      >
        {error ?? "请先登录"}
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
              <div className="truncate text-xs">{user.email}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
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
              {uploadingAvatar ? "上传中..." : "上传头像"}
            </Button>
            <span
              aria-label={user.status === "active" ? "账号正常" : "账号已停用"}
              className={
                user.status === "active"
                  ? "size-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15"
                  : "size-2.5 rounded-full bg-rose-500 ring-4 ring-rose-500/15"
              }
              role="status"
              title={user.status === "active" ? "账号正常" : "账号已停用"}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}
      <Tabs defaultValue="profile">
        <TabsList className="w-fit">
          <TabsTrigger value="profile">个人资料</TabsTrigger>
          <TabsTrigger value="password">密码</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-2" value="profile">
          <Card>
            <CardHeader>
              <CardTitle>个人资料</CardTitle>
              <CardDescription>
                维护你的名称和邮箱，头像只能通过图片上传更新
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="显示名称" htmlFor="account-display-name">
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
                <Field label="邮箱" htmlFor="account-email">
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
                <Field label="名" htmlFor="account-first-name">
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
                <Field label="姓" htmlFor="account-last-name">
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
                  重置
                </Button>
                <Button
                  disabled={!profileDirty || savingProfile}
                  onClick={saveProfile}
                  type="button"
                >
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-2" value="password">
          <Card>
            <CardHeader>
              <CardTitle>修改密码</CardTitle>
              <CardDescription>更新当前账号的登录密码</CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-md gap-4">
              <Field label="当前密码" htmlFor="account-current-password">
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
              <Field label="新密码" htmlFor="account-new-password">
                <Input
                  autoComplete="new-password"
                  id="account-new-password"
                  onChange={(event) =>
                    setPassword((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="至少 8 位"
                  type="password"
                  value={password.password}
                />
              </Field>
              <Field label="确认密码" htmlFor="account-confirm-password">
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
                  重置
                </Button>
                <Button
                  disabled={savingPassword}
                  onClick={savePassword}
                  type="button"
                >
                  修改密码
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
  };
}

function toProfileForm(user: User): ProfileForm {
  return {
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  };
}

function validatePassword(form: PasswordForm) {
  if (!form.currentPassword) return "请输入当前密码";
  if (form.password.length < 8) return "新密码至少 8 位";
  if (form.password !== form.confirmPassword) return "两次输入的密码不一致";
  return null;
}
