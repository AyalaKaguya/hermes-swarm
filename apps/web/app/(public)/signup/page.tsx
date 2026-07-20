"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getPublicBootstrap } from "@/lib/admin-api";
import { resolveWorkspaceApplicationsEnabled } from "@/lib/platform-settings";

export default function SignUpPage() {
  const t = useTranslations();
  const [workspaceApplicationsEnabled, setWorkspaceApplicationsEnabled] =
    useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPublicBootstrap()
      .then((bootstrap) => {
        if (!cancelled) {
          setWorkspaceApplicationsEnabled(
            resolveWorkspaceApplicationsEnabled(bootstrap.systemSettings),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setWorkspaceApplicationsEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-3">
          <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
            <AppIcon className="size-4" name="invite" />
          </div>
          <div className="grid gap-1">
            <CardTitle>{t("auth.signUp")}</CardTitle>
            <CardDescription>
              {workspaceApplicationsEnabled === false
                ? t("auth.signUpUnavailableDescription")
                : t("auth.tenantApplicationDescription")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {workspaceApplicationsEnabled && (
              <Button asChild className="w-full">
                <Link href="/apply">{t("auth.applyForTenant")}</Link>
              </Button>
            )}
            <Button asChild className="w-full" variant="ghost">
              <Link href="/login">{t("auth.backToSignIn")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
