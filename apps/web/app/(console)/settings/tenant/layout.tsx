"use client";

import type { AppIconName } from "@/components/app-icon";
import { SettingsSubnav } from "@/components/settings/settings-page";
import { useTextTranslation } from "@/hooks/use-text-translation";

const TENANT_SETTINGS_NAV: Array<{
  href: string;
  icon: AppIconName;
  label: string;
}> = [
  { href: "/settings/tenant/general", icon: "layers", label: "基本信息" },
  { href: "/settings/tenant/localization", icon: "language", label: "区域与语言" },
  { href: "/settings/tenant/governance", icon: "shield", label: "工作空间治理" },
  { href: "/settings/tenant/parameters", icon: "system", label: "参数设置" },
];

export default function TenantSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tr = useTextTranslation();
  return (
    <div className="grid gap-4">
      <SettingsSubnav
        ariaLabel={tr("工作空间设置导航")}
        items={TENANT_SETTINGS_NAV.map((item) => ({
          ...item,
          label: tr(item.label),
        }))}
      />
      {children}
    </div>
  );
}
