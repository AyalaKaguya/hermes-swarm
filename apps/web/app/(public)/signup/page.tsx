"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { activateWorkspaceOwner, getPublicBootstrap } from "@/lib/admin-api";
import { resolveWorkspaceApplicationsEnabled } from "@/lib/platform-settings";

export default function SignUpPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const activationToken = searchParams.get("token") ?? "";
  const activationEmail = searchParams.get("email") ?? "";
  const [workspaceApplicationsEnabled, setWorkspaceApplicationsEnabled] =
    useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activatedWorkspace, setActivatedWorkspace] = useState<{
    existingAccount: boolean;
    name: string;
    slug: string;
  } | null>(null);

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

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await activateWorkspaceOwner({
        displayName: displayName.trim() || undefined,
        password: password || undefined,
        token: activationToken,
      });
      setActivatedWorkspace({
        existingAccount: result.existingAccount,
        name: result.workspace.name,
        slug: result.workspace.slug,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("auth.activationFailed"),
      );
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
            <AppIcon className="size-4" name="invite" />
          </div>
          <div className="grid gap-1">
            <CardTitle>
              {activationToken ? t("auth.activateWorkspace") : t("auth.signUp")}
            </CardTitle>
            <CardDescription>
              {activationToken
                ? t("auth.activateWorkspaceDescription")
                : workspaceApplicationsEnabled === false
                ? t("auth.signUpUnavailableDescription")
                : t("auth.workspaceApplicationDescription")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {activationToken ? (
            activatedWorkspace ? (
              <div className="grid gap-4">
                <InlineNotice tone="success">
                  {t("auth.workspaceActivated", {
                    workspace: activatedWorkspace.name,
                  })}
                </InlineNotice>
                <Button asChild className="w-full">
                  <Link
                    href={`/login?workspace=${encodeURIComponent(activatedWorkspace.slug)}`}
                  >
                    {t("auth.goToSignIn")}
                  </Link>
                </Button>
              </div>
            ) : (
              <form className="grid gap-4" onSubmit={activate}>
                {activationEmail && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="activation-email">{t("auth.email")}</Label>
                    <Input
                      disabled
                      id="activation-email"
                      type="email"
                      value={activationEmail}
                    />
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="activation-display-name">
                    {t("common.name")}
                  </Label>
                  <Input
                    id="activation-display-name"
                    onChange={(event) => setDisplayName(event.target.value)}
                    value={displayName}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="activation-password">
                    {t("auth.password")}
                  </Label>
                  <Input
                    id="activation-password"
                    minLength={8}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t("auth.activationPasswordPlaceholder")}
                    type="password"
                    value={password}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("auth.activationPasswordHint")}
                  </p>
                </div>
                {error && <InlineNotice tone="error">{error}</InlineNotice>}
                <Button disabled={submitting} type="submit">
                  {submitting
                    ? t("common.processing")
                    : t("auth.activateWorkspace")}
                </Button>
              </form>
            )
          ) : (
            <div className="grid gap-2">
              {workspaceApplicationsEnabled && (
              <Button asChild className="w-full">
                <Link href="/apply">{t("auth.applyForWorkspace")}</Link>
              </Button>
              )}
              <Button asChild className="w-full" variant="ghost">
                <Link href="/login">{t("auth.backToSignIn")}</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
