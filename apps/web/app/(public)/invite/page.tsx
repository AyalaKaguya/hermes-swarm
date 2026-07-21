"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { PublicLanguageSwitcher } from "@/components/public-language-switcher";
import { useNotifications } from "@/components/app-notifications";
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
  acceptInvite,
  validateInvite,
  type Invite,
} from "@/lib/admin-api";

export default function InvitePage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const notifications = useNotifications();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";
  const workspaceSlug = searchParams.get("workspace") ?? "";
  const [acceptEmail, setAcceptEmail] = useState(email);
  const [displayName, setDisplayName] = useState("");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(
    null,
  );
  const [completedAction, setCompletedAction] = useState<
    "accept" | "decline" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const isDirectedInvite = Boolean(invite?.email);
  const isPlatformInvite = invite?.contextType === "platform";
  const signInHref = isPlatformInvite
    ? "/login?context=platform"
    : workspaceSlug
      ? `/login?workspace=${encodeURIComponent(workspaceSlug)}`
      : "/login";
  const targetEmail = isDirectedInvite ? (invite?.email ?? "") : acceptEmail;
  const requiresRegistration = invite
    ? isDirectedInvite
      ? !invite.existingUser
      : true
    : false;
  const canAccept = useMemo(
    () =>
      Boolean(invite) &&
      targetEmail.trim() &&
      (!requiresRegistration || (displayName.trim() && password.length >= 8)),
    [displayName, invite, password, requiresRegistration, targetEmail],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!token) throw new Error(t("invite.missingParams"));
      const data = await validateInvite(email, token);
      setInvite(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("invite.invalidOrExpired"));
      setInvite(null);
    } finally {
      setLoading(false);
    }
  }, [email, token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setAcceptEmail(email);
  }, [email]);

  async function submit(action: "accept" | "decline") {
    if (!invite) return;
    setSubmitting(action);
    setError(null);
    try {
      await acceptInvite({
        action,
        displayName: displayName.trim() || undefined,
        email: targetEmail.trim() || undefined,
        password: password || undefined,
        token,
      });
      notifications.success(
        action === "accept"
          ? t(isPlatformInvite ? "invite.platformJoined" : "invite.joined")
          : t("invite.declined"),
      );
      setCompletedAction(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.operationFailed"));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AppIcon className="size-5" name="invite" />
          </div>
          <CardTitle>
            {t(isPlatformInvite ? "invite.platformTitle" : "invite.title")}
          </CardTitle>
          <CardDescription>
            {t(
              isPlatformInvite
                ? "invite.platformDescription"
                : "invite.description",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : completedAction ? (
            <div className="grid gap-4">
              <InlineNotice tone="success">
                {completedAction === "accept"
                  ? t(
                      isPlatformInvite
                        ? "invite.platformJoinedDescription"
                        : "invite.joinedDescription",
                    )
                  : t("invite.declinedDescription")}
              </InlineNotice>
              {completedAction === "accept" && (
                <Button asChild>
                  <Link href={signInHref}>{t("auth.goToSignIn")}</Link>
                </Button>
              )}
            </div>
          ) : error ? (
            <InlineNotice tone="error">{error}</InlineNotice>
          ) : invite ? (
            <>
              <div className="grid gap-1.5">
                <Label>
                  {isDirectedInvite
                    ? t("invite.invitedEmail")
                    : t("auth.email")}
                </Label>
                <Input
                  disabled={isDirectedInvite}
                  onChange={(event) => setAcceptEmail(event.target.value)}
                  type="email"
                  value={targetEmail}
                />
              </div>
              {requiresRegistration && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="invite-display-name">
                      {t("common.name")}
                    </Label>
                    <Input
                      id="invite-display-name"
                      onChange={(event) => setDisplayName(event.target.value)}
                      value={displayName}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="invite-password">
                      {t("auth.password")}
                    </Label>
                    <Input
                      id="invite-password"
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      value={password}
                    />
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  disabled={Boolean(submitting)}
                  onClick={() => void submit("decline")}
                  type="button"
                  variant="outline"
                >
                  {submitting === "decline"
                    ? t("common.processing")
                    : t("invite.decline")}
                </Button>
                <Button
                  disabled={!canAccept || Boolean(submitting)}
                  onClick={() => void submit("accept")}
                  type="button"
                >
                  {submitting === "accept"
                    ? t("common.processing")
                    : t(isPlatformInvite ? "invite.joinPlatform" : "invite.join")}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
