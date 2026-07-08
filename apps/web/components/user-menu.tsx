"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { useNotifications } from "@/components/app-notifications";
import { useI18n } from "@/components/i18n-provider";
import { UserAvatar } from "@/components/user-avatar";
import { useTextTranslation } from "@/hooks/use-text-translation";
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
  getLanguageLabel,
  getStoredThemeMode,
  normalizeLanguagePreference,
  setThemeMode,
  type ThemeMode,
} from "@/lib/appearance";
import {
  logoutAuthSession,
  updateUserPreferredLanguage,
  type User,
} from "@/lib/admin-api";
import { getAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";

export type UserMenuTicketAccess = {
  visible: boolean;
};

export function UserMenu({
  ticketAccess,
  onUserUpdated,
  organizationName,
  user,
}: {
  ticketAccess?: UserMenuTicketAccess | null;
  onUserUpdated?: () => Promise<void>;
  organizationName?: string | null;
  user?: User | null;
}) {
  const router = useRouter();
  const notifications = useNotifications();
  const { language, setLanguage, t } = useI18n();
  const tr = useTextTranslation();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [savingLanguage, setSavingLanguage] = useState(false);

  useEffect(() => {
    const normalized = normalizeLanguagePreference(user?.preferredLanguage);
    if (user?.preferredLanguage) {
      setLanguage(normalized);
    }
  }, [setLanguage, user?.preferredLanguage]);

  useEffect(() => {
    setThemeModeState(getStoredThemeMode());
  }, []);

  async function changeLanguage(nextLanguage: string) {
    const normalized = normalizeLanguagePreference(nextLanguage);
    setLanguage(normalized);

    const token = await getAuthenticatedAdminSessionMarker();
    if (!token || !user || normalized === language) return;

    setSavingLanguage(true);
    try {
      await updateUserPreferredLanguage(token, user.id, normalized);
      await onUserUpdated?.();
    } catch (err) {
      notifications.error(
        t("language.saveFailed"),
        err instanceof Error ? err.message : undefined,
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

  function openTickets() {
    router.push("/tickets");
  }

  async function logout() {
    await logoutAuthSession();
    router.replace("/login");
  }

  const displayName =
    user?.displayName || user?.username || user?.email || t("user.notSignedIn");
  const languageLabel = getLanguageLabel(language);
  const themeLabel = t(getThemeTranslationKey(themeMode));
  const consoleLabel = t("shell.console");

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
                {user?.email ?? organizationName ?? consoleLabel}
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
                {user?.email ?? organizationName ?? consoleLabel}
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
                    {t(getThemeTranslationKey(option.value))}
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
              <span>{t("user.profile")}</span>
            </span>
          </DropdownMenuItem>

          {ticketAccess?.visible && (
            <DropdownMenuItem
              className="h-9 justify-between"
              onClick={openTickets}
            >
              <span className="flex min-w-0 items-center gap-2">
                <AppIcon className="size-4" name="file" />
                <span>{tr("工单")}</span>
              </span>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="h-9 justify-between"
            onClick={logout}
            variant="destructive"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AppIcon className="size-4" name="logout" />
              <span>{t("user.logout")}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function getThemeTranslationKey(mode: ThemeMode) {
  switch (mode) {
    case "dark":
      return "theme.dark";
    case "light":
      return "theme.light";
    default:
      return "theme.system";
  }
}
