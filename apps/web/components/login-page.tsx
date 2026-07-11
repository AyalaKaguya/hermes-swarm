"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { useI18n } from "@/components/i18n-provider";
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
import { authLogin, getPublicBootstrap } from "@/lib/admin-api";
import { resolvePlatformNameFromSettings } from "@/lib/platform-settings";
import { clearStoredSession } from "@/lib/session";

export function LoginPage() {
  const router = useRouter();
  const t = useTranslations();
  const { setLanguage } = useI18n();
  const requestFailedMessageRef = useRef(t("auth.requestFailed"));
  const [email, setEmail] = useState("owner@hermes.local");
  const [password, setPassword] = useState("admin123456");
  const [tenantSlug, setTenantSlug] = useState("hermes-dev");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [platformName, setPlatformName] = useState<string | null>(null);

  useEffect(() => {
    requestFailedMessageRef.current = t("auth.requestFailed");
  }, [t]);

  useEffect(() => {
    clearStoredSession();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await getPublicBootstrap();
        setPlatformName(resolvePlatformNameFromSettings(data.systemSettings));
        if (data.onboardingRequired) {
          router.replace("/onboarding");
          return;
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError, requestFailedMessageRef.current));
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || submitting) return;
    setError("");
    setSubmitting(true);

    try {
      const response = await authLogin({ email, password, tenantSlug });
      if (response.snapshot.permissions.length === 0) {
        setError(t("auth.noAdminAccess"));
        return;
      }

      setLanguage(response.snapshot.user.preferredLanguage);
      router.replace("/home");
    } catch (loginError) {
      setError(getErrorMessage(loginError, t("auth.requestFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  const title = platformName || "Hermes Swarm";

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-3">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
              <AppIcon className="size-4" name="sparkles" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{title}</p>
              <p className="text-xs">{t("auth.console")}</p>
            </div>
          </div>
          <div className="grid gap-1">
            <CardTitle>{t("auth.signIn")}</CardTitle>
            <CardDescription>{t("auth.subtitle")}</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form className="grid gap-3" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="login-tenant">{t("auth.tenantSlug")}</Label>
              <Input
                autoComplete="organization"
                id="login-tenant"
                onChange={(event) => setTenantSlug(event.target.value.toLowerCase())}
                placeholder={t("auth.tenantSlugPlaceholder")}
                value={tenantSlug}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="login-email">{t("auth.email")}</Label>
              <Input
                autoComplete="email"
                id="login-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@hermes.local"
                type="email"
                value={email}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="login-password">{t("auth.password")}</Label>
              <Input
                autoComplete="current-password"
                id="login-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("auth.passwordPlaceholder")}
                type="password"
                value={password}
              />
            </div>

            {error && (
              <div
                className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm"
                role="alert"
              >
                {error}
              </div>
            )}

            <Button
              className="w-full"
              disabled={loading || submitting || !tenantSlug || !email || !password}
              type="submit"
            >
              {t("auth.signIn")}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="ghost">
                <Link href="/forgot-password">{t("auth.forgotPassword")}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/signup">{t("auth.signUp")}</Link>
              </Button>
            </div>
            <Button asChild variant="link">
              <Link href="/platform/login">{t("auth.platformSignIn")}</Link>
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
