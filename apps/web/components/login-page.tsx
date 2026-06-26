"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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
import { getPublicBootstrap, login } from "@/lib/admin-api";
import {
  clearStoredSession,
  hasAnyManagementAccess,
  resolveSession,
  storeSession,
} from "@/lib/session";

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@hermes.local");
  const [password, setPassword] = useState("admin123456");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    clearStoredSession();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await getPublicBootstrap();
        if (data.onboardingRequired) {
          router.replace("/onboarding");
          return;
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    try {
      const response = await login({ email, password });
      const resolvedSession = resolveSession(response.snapshot);

      if (!hasAnyManagementAccess(response.snapshot, resolvedSession)) {
        setError("当前用户没有管理端访问权限");
        return;
      }

      storeSession({ token: response.token });
      router.replace("/home");
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm" size="sm">
        <CardHeader className="gap-3">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <AppIcon className="size-4" name="sparkles" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Hermes Swarm</p>
              <p className="text-xs text-muted-foreground">管理控制台</p>
            </div>
          </div>
          <div className="grid gap-1">
            <CardTitle>登录</CardTitle>
            <CardDescription>使用管理员账号进入工作台</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form className="grid gap-3" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="login-email">邮箱</Label>
              <Input
                autoComplete="email"
                id="login-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@hermes.local"
                type="email"
                value={email}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="login-password">密码</Label>
              <Input
                autoComplete="current-password"
                id="login-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                type="password"
                value={password}
              />
            </div>

            {error && (
              <div
                className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            )}

            <Button
              className="w-full"
              disabled={loading || !email || !password}
              type="submit"
            >
              登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
