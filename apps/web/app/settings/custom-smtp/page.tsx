"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getSmtpConfig, saveSmtpConfig, validateSmtpConfig, type SmtpConfig } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function CustomSmtpPage() {
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [msg, setMsg] = useState("");

  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      const c = await getSmtpConfig(session.token);
      setConfig(c);
      if (c) {
        setHost(c.host ?? "");
        setPort(String(c.port));
        setSecure(c.secure);
        setUsername(c.username ?? "");
        setFromAddress(c.fromAddress ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setSaving(true); setError(null); setMsg("");
    const session = getStoredSession();
    if (!session?.token) {
      setSaving(false);
      return;
    }
    try {
      await saveSmtpConfig(session.token, {
        host: host.trim(),
        port: Number(port) || 587,
        secure,
        username: username.trim() || null,
        password: password || null,
        fromAddress: fromAddress.trim() || null,
      });
      setMsg("保存成功");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally { setSaving(false); }
  }

  async function validate() {
    setValidating(true); setError(null); setMsg("");
    const session = getStoredSession();
    if (!session?.token) {
      setValidating(false);
      return;
    }
    try {
      await validateSmtpConfig(session.token, {
        host: host.trim(),
        port: Number(port) || 587,
        secure,
        username: username.trim() || null,
        fromAddress: fromAddress.trim() || null,
      });
      setMsg("配置验证通过");
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    } finally { setValidating(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>自定义 SMTP</CardTitle>
          <CardDescription>配置组织级别的邮件发送服务器</CardDescription>
        </div>
        {config?.isValidated && (
          <span className="rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            已验证
          </span>
        )}
      </CardHeader>
      <CardContent>
        {error && <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
        {msg && !error && <div className="mb-4 rounded-md border bg-muted/40 px-4 py-2 text-sm text-foreground">{msg}</div>}
        <div className="grid max-w-xl gap-4">
          <div className="grid gap-2"><Label>SMTP 服务器</Label><Input onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" value={host} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label>端口</Label><Input onChange={(e) => setPort(e.target.value)} placeholder="587" value={port} /></div>
            <div className="flex items-end gap-2 pb-2">
              <div className="flex items-center gap-2"><Switch checked={secure} id="secure" onCheckedChange={setSecure} /><Label htmlFor="secure">SSL/TLS</Label></div>
            </div>
          </div>
          <div className="grid gap-2"><Label>用户名</Label><Input onChange={(e) => setUsername(e.target.value)} placeholder="user@example.com" value={username} /></div>
          <div className="grid gap-2"><Label>密码</Label><Input onChange={(e) => setPassword(e.target.value)} placeholder="留空不修改" type="password" value={password} /></div>
          <div className="grid gap-2"><Label>发件人地址</Label><Input onChange={(e) => setFromAddress(e.target.value)} placeholder="noreply@example.com" value={fromAddress} /></div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving || !host.trim()}>{saving ? "保存中..." : "保存配置"}</Button>
            <Button onClick={validate} disabled={validating || !host.trim()} variant="outline">{validating ? "验证中..." : "测试连接"}</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
