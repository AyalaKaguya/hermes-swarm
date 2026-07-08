"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppIcon } from "@/components/app-icon";
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
import { resetPassword } from "@/lib/admin-api";
import { useTextTranslation } from "@/hooks/use-text-translation";

export default function ResetPasswordPage() {
  const tr = useTextTranslation();
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
      setError(err instanceof Error ? err.message : tr("重置失败"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AppIcon className="size-5" name="shield" />
          </div>
          <CardTitle>{tr("重置密码")}</CardTitle>
          <CardDescription>{tr("设置新的登录密码")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {done ? (
            <>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {tr("密码已重置，请使用新密码登录。")}
              </div>
              <Button asChild>
                <Link href="/login">{tr("返回登录")}</Link>
              </Button>
            </>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label>{tr("邮箱")}</Label>
                <Input disabled value={email} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reset-password">{tr("新密码")}</Label>
                <Input
                  id="reset-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reset-confirm-password">{tr("确认密码")}</Label>
                <Input
                  id="reset-confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  value={confirmPassword}
                />
              </div>
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
                  {error}
                </div>
              )}
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
                {loading ? tr("处理中...") : tr("重置密码")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
