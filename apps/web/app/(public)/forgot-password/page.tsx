"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
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
import {
  requestPasswordReset,
  resolveWorkspaceLoginContext,
  type WorkspaceLoginContext,
} from "@/lib/admin-api";
import {
  normalizeWorkspace,
  readRecentWorkspace,
  withWorkspace,
} from "@/lib/login-workspace";

export default function ForgotPasswordPage() {
  return <Suspense><ForgotPasswordContent /></Suspense>;
}

function ForgotPasswordContent() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const workspaceRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceLoginContext | null>(null);
  const [email, setEmail] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const candidate =
          normalizeWorkspace(searchParams.get("workspace")) ||
          readRecentWorkspace(window.localStorage);
        if (candidate) setWorkspaceSlug(candidate);
        const context = await resolveWorkspaceLoginContext(candidate || undefined);
        if (!cancelled && context.workspace) {
          setWorkspaceContext(context);
          setWorkspaceSlug(context.workspace.slug);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError, t("workspaceNotFound")));
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [searchParams, t]);

  useEffect(() => {
    if (initializing) return;
    if (workspaceContext?.workspace) emailRef.current?.focus();
    else workspaceRef.current?.focus();
  }, [initializing, workspaceContext]);

  async function selectWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeWorkspace(workspaceSlug);
    if (!normalized || loading) return;
    setLoading(true);
    setError("");
    try {
      const context = await resolveWorkspaceLoginContext(normalized);
      if (!context.workspace) {
        setError(t("workspaceNotFound"));
        return;
      }
      setWorkspaceContext(context);
      setWorkspaceSlug(context.workspace.slug);
    } catch (selectError) {
      setError(getErrorMessage(selectError, t("workspaceNotFound")));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceContext?.workspace || loading || !email.trim()) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await requestPasswordReset(email.trim(), workspaceContext.workspace.slug);
      setMessage(t("forgotPasswordSuccess"));
    } catch (submitError) {
      setError(getErrorMessage(submitError, t("sendFailed")));
    } finally {
      setLoading(false);
    }
  }

  const currentWorkspace = workspaceContext?.workspace;
  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-3">
          <div className="grid size-9 place-items-center rounded-lg border bg-muted text-muted-foreground">
            <AppIcon className="size-4" name="mail" />
          </div>
          <div className="grid gap-1">
            <CardTitle>{t("forgotPassword")}</CardTitle>
            <CardDescription>
              {currentWorkspace ? t("forgotPasswordFor", { workspace: currentWorkspace.name }) : t("workspaceFirst")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {initializing ? (
            <div className="h-9 animate-pulse rounded-md bg-muted" aria-busy="true" />
          ) : currentWorkspace ? (
            <form className="grid gap-3" onSubmit={submit}>
              <div className="rounded-md border bg-muted/35 px-3 py-2">
                <p className="text-sm font-medium">{currentWorkspace.name}</p>
                <p className="text-xs text-muted-foreground">{currentWorkspace.slug}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="forgot-email">{t("email")}</Label>
                <Input
                  autoComplete="email"
                  id="forgot-email"
                  onChange={(event) => setEmail(event.target.value)}
                  ref={emailRef}
                  required
                  type="email"
                  value={email}
                />
              </div>
              {message && <StatusMessage>{message}</StatusMessage>}
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <Button disabled={loading || !email.trim()} type="submit">
                {loading ? t("sending") : t("sendResetLink")}
              </Button>
              <Button asChild variant="ghost">
                <Link href={withWorkspace("/login", currentWorkspace.slug)}>{t("backToSignIn")}</Link>
              </Button>
            </form>
          ) : (
            <form className="grid gap-3" onSubmit={selectWorkspace}>
              <div className="grid gap-1.5">
                <Label htmlFor="forgot-workspace">{t("workspace")}</Label>
                <Input
                  id="forgot-workspace"
                  onChange={(event) => setWorkspaceSlug(event.target.value.toLowerCase())}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  ref={workspaceRef}
                  required
                  value={workspaceSlug}
                />
              </div>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <Button disabled={loading || !normalizeWorkspace(workspaceSlug)} type="submit">
                {loading ? t("findingWorkspace") : t("continue")}
              </Button>
              <Button asChild variant="ghost"><Link href="/login">{t("backToSignIn")}</Link></Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return <InlineNotice tone="success">{children}</InlineNotice>;
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <InlineNotice tone="error">{children}</InlineNotice>;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
