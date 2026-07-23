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
  resolveWorkspaceLoginContext,
  selectLoginContext,
  type AuthenticatedLoginResponse,
  type WorkspaceLoginContext,
  type ContextSelectionOption,
  type ContextSelectionRequiredResponse,
} from "@/lib/admin-api";
import {
  normalizeWorkspace,
  rememberWorkspace,
  safeReturnUrl,
  withWorkspace,
} from "@/lib/login-workspace";
import {
  resolvePlatformNameFromSettings,
  resolvePlatformSloganFromSettings,
  resolveWorkspaceApplicationsEnabled,
} from "@/lib/platform-settings";
import { clearStoredSession } from "@/lib/session";
import { resolveOnboardingLoginRedirect } from "@/lib/onboarding";

export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const { setRuntimePreferences } = useI18n();
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [workspaceContext, setWorkspaceContext] =
    useState<WorkspaceLoginContext | null>(null);
  const [selection, setSelection] =
    useState<ContextSelectionRequiredResponse | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [platformName, setPlatformName] = useState<string | null>(null);
  const [platformSlogan, setPlatformSlogan] = useState<string | null>(null);
  const [workspaceApplicationsEnabled, setWorkspaceApplicationsEnabled] =
    useState(true);

  useEffect(() => {
    clearStoredSession();
    setInitializing(true);
    setInitializationError(false);
    setError("");
    let cancelled = false;
    void (async () => {
      try {
        const bootstrap = await getPublicBootstrap();
        if (cancelled) return;
        setPlatformName(resolvePlatformNameFromSettings(bootstrap.systemSettings));
        setPlatformSlogan(
          resolvePlatformSloganFromSettings(bootstrap.systemSettings),
        );
        setWorkspaceApplicationsEnabled(
          resolveWorkspaceApplicationsEnabled(bootstrap.systemSettings),
        );
        const onboardingRedirect = resolveOnboardingLoginRedirect(
          bootstrap.onboardingState,
          {
            context: searchParams.get("context"),
            next: searchParams.get("next"),
          },
        );
        if (onboardingRedirect) {
          router.replace(onboardingRedirect);
          return;
        }
        const workspace = normalizeWorkspace(searchParams.get("workspace"));
        if (workspace) {
          const context = await resolveWorkspaceLoginContext(workspace);
          if (!context.workspace) {
            setError(t("auth.workspaceNotFound"));
          } else {
            setWorkspaceContext(context);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setInitializationError(true);
          setError(getErrorMessage(loadError, t("auth.requestFailed")));
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadVersion, router, searchParams, t]);

  function retryInitialization() {
    setLoadVersion((current) => current + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setInitializationError(false);
    setError("");
    try {
      const response = await authLogin({
        contextType: searchParams.get("context") === "platform"
          ? "platform"
          : workspaceContext?.workspace
            ? "workspace"
            : undefined,
        email: email.trim(),
        password,
        workspaceSlug: workspaceContext?.workspace?.slug,
      });
      if (response.status === "context_selection_required") {
        setSelection(response);
        setPassword("");
        return;
      }
      completeLogin(response);
    } catch (loginError) {
      setPassword("");
      setError(getErrorMessage(loginError, t("auth.invalidCredentials")));
      window.requestAnimationFrame(() => passwordInputRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseContext(option: ContextSelectionOption) {
    if (!selection || submitting) return;
    setSubmitting(true);
    setInitializationError(false);
    setError("");
    try {
      completeLogin(
        await selectLoginContext({
          contextType: option.type,
          membershipId: option.membershipId,
          selectionToken: selection.selectionToken,
        }),
      );
    } catch (selectionError) {
      setSelection(null);
      setError(getErrorMessage(selectionError, t("auth.invalidCredentials")));
    } finally {
      setSubmitting(false);
    }
  }

  function completeLogin(response: AuthenticatedLoginResponse) {
    if (response.snapshot.permissions.length === 0) {
      setError(t("auth.noAdminAccess"));
      return;
    }
    if (response.snapshot.principalType === "workspace" && response.snapshot.workspace?.slug) {
      rememberWorkspace(window.localStorage, response.snapshot.workspace.slug);
    }
    setRuntimePreferences(response.snapshot.runtimePreferences);
    const requested = searchParams.get("next") ?? searchParams.get("returnUrl");
    router.replace(
      requested
        ? safeReturnUrl(requested)
        : response.snapshot.principalType === "platform"
          ? "/platform/workspaces"
          : "/home",
    );
  }

  const currentWorkspace = workspaceContext?.workspace;
  const title = currentWorkspace?.name || platformName || "Hermes Swarm";
  const platformContextLabel = platformSlogan?.trim() || t("auth.console");

  useEffect(() => {
    document.title = t("shell.documentTitle", { name: title });
  }, [t, title]);

  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-4">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
              <AppIcon className="size-4" name={currentWorkspace ? "building" : "sparkles"} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">
                {currentWorkspace?.slug || platformContextLabel}
              </p>
            </div>
          </div>
          <div className="grid gap-1">
            <CardTitle>
              {selection ? t("auth.workspaceTitle") : t("auth.signIn")}
            </CardTitle>
            <CardDescription>
              {selection
                ? t("auth.workspaceDescription")
                : currentWorkspace
                  ? t("auth.subtitle")
                  : t("auth.sharedLoginDescription")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {initializing ? (
            <div className="grid gap-3" aria-busy="true">
              <div className="h-9 animate-pulse rounded-md bg-muted" />
              <div className="h-9 animate-pulse rounded-md bg-muted" />
            </div>
          ) : selection ? (
            <div className="grid gap-2">
              {selection.contexts.map((option) => (
                <Button
                  className="h-auto justify-start gap-3 px-3 py-2.5"
                  disabled={submitting}
                  key={`${option.type}:${option.membershipId}`}
                  onClick={() => void chooseContext(option)}
                  type="button"
                  variant="outline"
                >
                  <AppIcon className="size-4" name={option.type === "platform" ? "shield" : "building"} />
                  <span className="grid min-w-0 flex-1 text-left">
                    <span className="truncate text-sm font-medium">
                      {option.type === "platform"
                        ? platformContextLabel
                        : option.workspace.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {option.role.displayName}
                    </span>
                  </span>
                </Button>
              ))}
              <Button
                onClick={() => {
                  setSelection(null);
                  setError("");
                }}
                type="button"
                variant="ghost"
              >
                {t("auth.backToSignIn")}
              </Button>
              {error && <InlineNotice tone="error">{error}</InlineNotice>}
            </div>
          ) : (
            <form className="grid gap-3" onSubmit={submit}>
              <div className="grid gap-1.5">
                <Label htmlFor="login-email">{t("auth.email")}</Label>
                <Input
                  autoComplete="email"
                  id="login-email"
                  onChange={(event) => setEmail(event.target.value)}
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
                    href={
                      currentWorkspace
                        ? withWorkspace("/forgot-password", currentWorkspace.slug)
                        : "/forgot-password"
                    }
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
              {error && (
                <div className="grid gap-1.5">
                  <InlineNotice tone="error">{error}</InlineNotice>
                  {initializationError && (
                    <Button
                      className="justify-self-start"
                      onClick={retryInitialization}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t("common.retry")}
                    </Button>
                  )}
                </div>
              )}
              <Button disabled={submitting || !email.trim() || !password} type="submit">
                {submitting ? t("auth.signingIn") : t("auth.signIn")}
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
