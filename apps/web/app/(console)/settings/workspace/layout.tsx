"use client";

import type { AppIconName } from "@/components/app-icon";
import { usePathname } from "next/navigation";
import { SettingsSubnav } from "@/components/settings/settings-page";
import { useTextTranslation } from "@/hooks/use-text-translation";

const WORKSPACE_SETTINGS_NAV: Array<{
  href: string;
  icon: AppIconName;
  label: string;
}> = [
  { href: "/settings/workspace/general", icon: "layers", label: "基本信息" },
  { href: "/settings/workspace/localization", icon: "language", label: "区域与语言" },
  { href: "/settings/workspace/governance", icon: "shield", label: "工作空间治理" },
  { href: "/settings/workspace/parameters", icon: "system", label: "参数设置" },
];

export default function WorkspaceSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tr = useTextTranslation();
  const pathname = usePathname();
  const showSettingsSubnav = WORKSPACE_SETTINGS_NAV.some(
    (item) => item.href === pathname,
  );

  if (!showSettingsSubnav) return children;

  return (
    <div className="grid gap-4">
      <SettingsSubnav
        ariaLabel={tr("工作空间设置导航")}
        items={WORKSPACE_SETTINGS_NAV.map((item) => ({
          ...item,
          label: tr(item.label),
        }))}
      />
      {children}
    </div>
  );
}
