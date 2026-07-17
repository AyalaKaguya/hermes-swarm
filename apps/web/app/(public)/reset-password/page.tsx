"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { resetPassword } from "@/lib/admin-api";
import { useTranslations } from "next-intl";

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");
    try {
      await resetPassword({ confirmPassword, email, password, token });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("resetFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <PublicLanguageSwitcher />
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AppIcon className="size-5" name="shield" />
          </div>
          <CardTitle>{t("resetPassword")}</CardTitle>
          <CardDescription>{t("resetPasswordDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {done ? (
            <>
              <InlineNotice tone="success">{t("resetPasswordSuccess")}</InlineNotice>
              <Button asChild>
                <Link href="/login">{t("backToSignIn")}</Link>
              </Button>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label>{t("email")}</Label>
                <Input disabled value={email} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reset-password">{t("newPassword")}</Label>
                <Input
                  id="reset-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reset-confirm-password">
                  {t("confirmPassword")}
                </Label>
                <Input
                  id="reset-confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  value={confirmPassword}
                />
              </div>
              {error && <InlineNotice tone="error">{error}</InlineNotice>}
              <Button
                disabled={
                  loading ||
                  !email ||
                  !token ||
                  !password ||
                  password !== confirmPassword
                }
                onClick={submit}
              >
                {loading ? t("processing") : t("resetPassword")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
