"use client";

import { usePathname } from "next/navigation";
import type { AppIconName } from "@/components/app-icon";
import { SettingsWorkspaceShell } from "@/components/settings/settings-workspace-shell";
import { useTextTranslation } from "@/hooks/use-text-translation";

const PLATFORM_SETTINGS_NAV: Array<{
  href: string;
  icon: AppIconName;
  key: string;
  label: string;
}> = [
  { href: "/platform/settings/general", icon: "settings", key: "general", label: "平台信息" },
  { href: "/platform/settings/localization", icon: "language", key: "localization", label: "区域与默认值" },
  { href: "/platform/settings/governance", icon: "shield", key: "governance", label: "工作空间治理" },
  { href: "/platform/settings/services", icon: "plug", key: "services", label: "公共服务" },
  { href: "/platform/settings/email", icon: "mail", key: "email", label: "公共 SMTP" },
  { href: "/platform/settings/administrators", icon: "users", key: "administrators", label: "平台管理员" },
  { href: "/platform/settings/roles", icon: "shield", key: "roles", label: "角色与权限" },
  { href: "/platform/settings/parameters", icon: "system", key: "parameters", label: "参数设置" },
];

export default function PlatformSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const tr = useTextTranslation();
  const items = PLATFORM_SETTINGS_NAV.map((item) => ({
    ...item,
    label: tr(item.label),
  }));
  const activeKey = items.find((item) => item.href === pathname)?.key;

  return (
    <SettingsWorkspaceShell
      activeKey={activeKey}
      ariaLabel={tr("平台设置导航")}
      headerDescription={tr("平台默认值、工作空间治理与公共服务")}
      headerTitle={tr("平台设置")}
      idPrefix="platform-settings"
      navSections={[
        {
          items,
          key: "platform-settings",
          label: tr("平台控制面"),
        },
      ]}
    >
      {children}
    </SettingsWorkspaceShell>
  );
}
