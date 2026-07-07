"use client";

import { useTranslations } from "next-intl";

export function HomePage() {
  const t = useTranslations();

  return <section aria-label={t("shell.home")} className="min-h-svh" />;
}
