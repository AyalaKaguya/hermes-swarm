"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { useI18n } from "@/components/i18n-provider";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformAuthLogin } from "@/lib/admin-api";

export function PlatformLoginPage() {
  const router = useRouter();
  const t = useTranslations("platformAuth");
  const { setRuntimePreferences } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await platformAuthLogin({ email, password });
      if (response.snapshot.principalType !== "platform") {
        throw new Error(t("wrongPrincipal"));
      }
      setRuntimePreferences(response.snapshot.runtimePreferences);
      router.replace("/platform/tenants");
    } catch (loginError) {
      setError(getErrorMessage(loginError, t("failed")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-3">
          <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
            <AppIcon className="size-4" name="shield" />
          </div>
          <div className="grid gap-1">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="platform-login-email">{t("email")}</Label>
              <Input
                autoComplete="email"
                id="platform-login-email"
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="platform-login-password">{t("password")}</Label>
              <Input
                autoComplete="current-password"
                id="platform-login-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <Button disabled={submitting || !email || !password} type="submit">
              {submitting ? t("signingIn") : t("signIn")}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/login">{t("tenantSignIn")}</Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
