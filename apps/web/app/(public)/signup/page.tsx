"use client";

import Link from "next/link";
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

export default function SignUpPage() {
  const t = useTranslations();

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
            <CardDescription>{t("auth.tenantApplicationDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Button asChild className="w-full">
              <Link href="/apply">{t("auth.applyForTenant")}</Link>
            </Button>
            <Button asChild className="w-full" variant="ghost">
              <Link href="/login">{t("auth.backToSignIn")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
