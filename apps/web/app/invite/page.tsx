"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { useNotifications } from "@/components/app-notifications";
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
import {
  acceptInvite,
  validateInvite,
  type Invite,
} from "@/lib/admin-api";
import { useTextTranslation } from "@/hooks/use-text-translation";

export default function InvitePage() {
  const tr = useTextTranslation();
  const searchParams = useSearchParams();
  const notifications = useNotifications();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";
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

  const organization = invite?.organization;
  const isDirectedInvite = Boolean(invite?.email);
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
      if (!token) throw new Error(tr("邀请链接缺少必要参数"));
      const data = await validateInvite(email, token);
      setInvite(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("邀请链接无效或已过期"));
      setInvite(null);
    } finally {
      setLoading(false);
    }
  }, [email, token, tr]);

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
        action === "accept" ? tr("已加入组织") : tr("已拒绝邀请"),
      );
      setCompletedAction(action);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("操作失败"));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AppIcon className="size-5" name="invite" />
          </div>
          <CardTitle>{tr("组织邀请")}</CardTitle>
          <CardDescription>
            {organization
              ? `${organization.name} ${tr("邀请你加入组织")}`
              : tr("确认邀请链接后加入组织")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {tr("加载中...")}
            </div>
          ) : completedAction ? (
            <div className="grid gap-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {completedAction === "accept"
                  ? tr("已加入组织，请使用该账号登录。")
                  : tr("已拒绝邀请。")}
              </div>
              {completedAction === "accept" && (
                <Button asChild>
                  <Link href="/login">{tr("前往登录")}</Link>
                </Button>
              )}
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </div>
          ) : invite ? (
            <>
              {organization && (
                <div className="rounded-md border bg-background px-3 py-3">
                  <div className="font-medium">{organization.name}</div>
                  {organization.shortDescription && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {organization.shortDescription}
                    </p>
                  )}
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>{tr(isDirectedInvite ? "受邀邮箱" : "邮箱")}</Label>
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
                    <Label htmlFor="invite-display-name">{tr("名称")}</Label>
                    <Input
                      id="invite-display-name"
                      onChange={(event) => setDisplayName(event.target.value)}
                      value={displayName}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="invite-password">{tr("密码")}</Label>
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
                  {submitting === "decline" ? tr("处理中...") : tr("拒绝")}
                </Button>
                <Button
                  disabled={!canAccept || Boolean(submitting)}
                  onClick={() => void submit("accept")}
                  type="button"
                >
                  {submitting === "accept" ? tr("处理中...") : tr("加入组织")}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
