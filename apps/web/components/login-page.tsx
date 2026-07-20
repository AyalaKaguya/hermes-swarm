"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { useI18n } from "@/components/i18n-provider";
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
import {
  authLogin,
  getPublicBootstrap,
  resolveTenantLoginContext,
  type TenantLoginContext,
} from "@/lib/admin-api";
import {
  forgetRecentWorkspace,
  normalizeWorkspace,
  readRecentWorkspace,
  rememberWorkspace,
  safeReturnUrl,
  withWorkspace,
} from "@/lib/login-workspace";
import {
  resolvePlatformNameFromSettings,
  resolveWorkspaceApplicationsEnabled,
} from "@/lib/platform-settings";
import { clearStoredSession } from "@/lib/session";

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const { setRuntimePreferences } = useI18n();
  const workspaceInputRef = useRef<HTMLInputElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState("");
  const [tenantContext, setTenantContext] = useState<TenantLoginContext | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [platformName, setPlatformName] = useState<string | null>(null);
  const [workspaceApplicationsEnabled, setWorkspaceApplicationsEnabled] =
    useState(true);

  useEffect(() => {
    clearStoredSession();
    let cancelled = false;

    async function initialize() {
      try {
        const bootstrap = await getPublicBootstrap();
        if (cancelled) return;
        setPlatformName(resolvePlatformNameFromSettings(bootstrap.systemSettings));
        setWorkspaceApplicationsEnabled(
          resolveWorkspaceApplicationsEnabled(bootstrap.systemSettings),
        );
        if (bootstrap.onboardingRequired) {
          router.replace("/onboarding");
          return;
        }

        const queryWorkspace = normalizeWorkspace(searchParams.get("workspace"));
        const remembered = readRecentWorkspace(window.localStorage);
        const candidate = queryWorkspace || remembered;
        if (candidate) setWorkspace(candidate);
        const context = await resolveTenantLoginContext(candidate || undefined);
        if (cancelled) return;
        if (context.tenant) {
          setTenantContext(context);
          setWorkspace(context.tenant.slug);
        } else if (candidate) {
          forgetRecentWorkspace(window.localStorage);
          setError(t("auth.workspaceNotFound"));
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError, t("auth.requestFailed")));
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams, t]);

  useEffect(() => {
    if (initializing) return;
    if (tenantContext?.tenant) emailInputRef.current?.focus();
    else workspaceInputRef.current?.focus();
  }, [initializing, tenantContext]);

  async function resolveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeWorkspace(workspace);
    if (!normalized || resolving) return;
    setResolving(true);
    setError("");
    try {
      const context = await resolveTenantLoginContext(normalized);
      if (!context.tenant) {
        setError(t("auth.workspaceNotFound"));
        return;
      }
      setWorkspace(context.tenant.slug);
      setTenantContext(context);
      const url = new URL(window.location.href);
      url.searchParams.set("workspace", context.tenant.slug);
      window.history.replaceState(null, "", url);
    } catch (resolveError) {
      setError(getErrorMessage(resolveError, t("auth.workspaceNotFound")));
    } finally {
      setResolving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantContext?.tenant || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await authLogin({
        email: email.trim(),
        password,
        tenantSlug: tenantContext.tenant.slug,
      });
      if (response.snapshot.permissions.length === 0) {
        setError(t("auth.noAdminAccess"));
        return;
      }
      rememberWorkspace(window.localStorage, tenantContext.tenant.slug);
      setRuntimePreferences(response.snapshot.runtimePreferences);
      router.replace(
        safeReturnUrl(
          searchParams.get("next") ?? searchParams.get("returnUrl"),
        ),
      );
    } catch (loginError) {
      setPassword("");
      setError(getErrorMessage(loginError, t("auth.invalidCredentials")));
      window.requestAnimationFrame(() => passwordInputRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  function switchWorkspace() {
    forgetRecentWorkspace(window.localStorage);
    setTenantContext(null);
    setPassword("");
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.delete("workspace");
    window.history.replaceState(null, "", url);
  }

  const title = platformName || "Hermes Swarm";
  const tenant = tenantContext?.tenant;

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-4">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
              <AppIcon className="size-4" name={tenant ? "building" : "sparkles"} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{tenant?.name || title}</p>
              <p className="text-xs text-muted-foreground">
                {tenant ? tenant.slug : t("auth.console")}
              </p>
            </div>
          </div>
          <div className="grid gap-1">
            <CardTitle>
              {tenant ? t("auth.signIn") : t("auth.workspaceTitle")}
            </CardTitle>
            <CardDescription>
              {tenant ? t("auth.subtitle") : t("auth.workspaceDescription")}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {initializing ? (
            <div className="grid gap-3" aria-busy="true">
              <div className="h-9 animate-pulse rounded-md bg-muted" />
              <div className="h-9 animate-pulse rounded-md bg-muted" />
              <p className="text-center text-xs text-muted-foreground">
                {t("auth.preparingSignIn")}
              </p>
            </div>
          ) : tenant ? (
            <form className="grid gap-3" onSubmit={submit}>
              <div className="flex items-center justify-between rounded-md border bg-muted/35 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tenant.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{tenant.slug}</p>
                </div>
                {tenantContext.source !== "host" && (
                  <Button onClick={switchWorkspace} size="sm" type="button" variant="ghost">
                    {t("auth.switchWorkspace")}
                  </Button>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="login-email">{t("auth.email")}</Label>
                <Input
                  autoComplete="email"
                  id="login-email"
                  onChange={(event) => setEmail(event.target.value)}
                  ref={emailInputRef}
                  required
                  type="email"
                  value={email}
                />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="login-password">{t("auth.password")}</Label>
                  <Link
                    className="text-xs text-muted-foreground hover:text-foreground"
                    href={withWorkspace("/forgot-password", tenant.slug)}
                  >
                    {t("auth.forgotPassword")}
                  </Link>
                </div>
                <Input
                  autoComplete="current-password"
                  id="login-password"
                  onChange={(event) => setPassword(event.target.value)}
                  ref={passwordInputRef}
                  required
                  type="password"
                  value={password}
                />
              </div>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <Button disabled={submitting || !email.trim() || !password} type="submit">
                {submitting ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
              {workspaceApplicationsEnabled && (
                <Button asChild variant="ghost">
                  <Link href="/apply">{t("auth.applyForWorkspace")}</Link>
                </Button>
              )}
            </form>
          ) : (
            <form className="grid gap-3" onSubmit={resolveWorkspace}>
              <div className="grid gap-1.5">
                <Label htmlFor="login-workspace">{t("auth.workspace")}</Label>
                <Input
                  autoCapitalize="none"
                  autoComplete="organization"
                  id="login-workspace"
                  onChange={(event) => setWorkspace(event.target.value.toLowerCase())}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder={t("auth.workspacePlaceholder")}
                  ref={workspaceInputRef}
                  required
                  value={workspace}
                />
              </div>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <Button disabled={resolving || !normalizeWorkspace(workspace)} type="submit">
                {resolving ? t("auth.findingWorkspace") : t("auth.continue")}
              </Button>
              {workspaceApplicationsEnabled && (
                <Button asChild variant="ghost">
                  <Link href="/apply">{t("auth.applyForWorkspace")}</Link>
                </Button>
              )}
            </form>
          )}

        </CardContent>
      </Card>
    </main>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <InlineNotice tone="error">{children}</InlineNotice>;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
