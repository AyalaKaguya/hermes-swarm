"use client";

import Link from "next/link";
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
import { requestPasswordReset } from "@/lib/admin-api";
import { useTextTranslation } from "@/hooks/use-text-translation";

export default function ForgotPasswordPage() {
  const tr = useTextTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await requestPasswordReset(email);
      setMessage(tr("如果邮箱存在，重置链接将发送到该邮箱。"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("发送失败"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <AppIcon className="size-5" name="mail" />
          </div>
          <CardTitle>{tr("忘记密码")}</CardTitle>
          <CardDescription>{tr("输入邮箱以接收密码重置链接")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="forgot-email">{tr("邮箱")}</Label>
            <Input
              id="forgot-email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          {message && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </div>
          )}
          <Button disabled={loading || !email.trim()} onClick={submit}>
            {loading ? tr("发送中...") : tr("发送重置链接")}
          </Button>
          <Button asChild variant="ghost">
            <Link href="/login">{tr("返回登录")}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
