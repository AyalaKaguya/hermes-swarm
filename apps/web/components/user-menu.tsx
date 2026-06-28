"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import {
  LANGUAGE_OPTIONS,
  THEME_OPTIONS,
  applyLanguagePreference,
  getLanguageLabel,
  getStoredThemeMode,
  getThemeModeLabel,
  normalizeLanguagePreference,
  setThemeMode,
  type PreferredLanguage,
  type ThemeMode,
} from "@/lib/appearance";
import { updateUserPreferredLanguage, type User } from "@/lib/admin-api";
import { clearStoredSession, getStoredSession } from "@/lib/session";

export function UserMenu({
  onUserUpdated,
  organizationName,
  user,
}: {
  onUserUpdated?: () => Promise<void>;
  organizationName?: string | null;
  user?: User | null;
}) {
  const router = useRouter();
  const [language, setLanguage] = useState<PreferredLanguage>(
    normalizeLanguagePreference(user?.preferredLanguage),
  );
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [savingLanguage, setSavingLanguage] = useState(false);

  useEffect(() => {
    const normalized = normalizeLanguagePreference(user?.preferredLanguage);
    setLanguage(normalized);
    if (user?.preferredLanguage) {
      applyLanguagePreference(normalized);
    }
  }, [user?.preferredLanguage]);

  useEffect(() => {
    setThemeModeState(getStoredThemeMode());
  }, []);

  async function changeLanguage(nextLanguage: string) {
    const normalized = normalizeLanguagePreference(nextLanguage);
    setLanguage(normalized);
    applyLanguagePreference(normalized);

    const session = getStoredSession();
    if (!session?.token || !user || normalized === language) return;

    setSavingLanguage(true);
    try {
      await updateUserPreferredLanguage(session.token, user.id, normalized);
      await onUserUpdated?.();
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("hermes:notification", {
          detail: {
            message: err instanceof Error ? err.message : "语言偏好保存失败",
          },
        }),
      );
    } finally {
      setSavingLanguage(false);
    }
  }

  function changeTheme(nextThemeMode: string) {
    const normalized = nextThemeMode as ThemeMode;
    setThemeModeState(normalized);
    setThemeMode(normalized);
  }

  function openProfile() {
    router.push("/settings/account");
  }

  function logout() {
    clearStoredSession();
    router.replace("/login");
  }

  const displayName =
    user?.displayName || user?.username || user?.email || "未登录";
  const languageLabel = getLanguageLabel(language);
  const themeLabel = getThemeModeLabel(themeMode);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            className="h-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1!"
            tooltip={displayName}
            type="button"
          >
            <UserAvatar size="sm" user={user} />
            <span className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-xs font-medium">
                {displayName}
              </span>
              <span className="truncate text-xs">
                {user?.email ?? organizationName ?? "管理控制台"}
              </span>
            </span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 p-1"
          side="right"
          sideOffset={8}
        >
          <div className="flex min-w-0 items-center gap-3 px-2 py-2">
            <UserAvatar size="md" user={user} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="truncate text-xs">
                {user?.email ?? organizationName ?? "管理控制台"}
              </div>
            </div>
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-9 justify-between">
              <span className="flex min-w-0 items-center gap-2">
                <AppIcon className="size-4" name="language" />
                <span className="truncate">{languageLabel}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              <DropdownMenuRadioGroup
                onValueChange={changeLanguage}
                value={language}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    className="h-8"
                    disabled={savingLanguage}
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-9 justify-between">
              <span className="flex min-w-0 items-center gap-2">
                <AppIcon className="size-4" name="palette" />
                <span className="truncate">{themeLabel}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              <DropdownMenuRadioGroup
                onValueChange={changeTheme}
                value={themeMode}
              >
                {THEME_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    className="h-8"
                    key={option.value}
                    value={option.value}
                  >
                    <AppIcon className="size-4" name={option.icon} />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="h-9 justify-between"
            onClick={openProfile}
          >
            <span className="flex min-w-0 items-center gap-2">
              <AppIcon className="size-4" name="user" />
              <span>用户配置</span>
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="h-9 justify-between"
            onClick={logout}
            variant="destructive"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AppIcon className="size-4" name="logout" />
              <span>退出账号</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
