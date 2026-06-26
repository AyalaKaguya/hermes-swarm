"use client";

import { useState, useEffect, useCallback } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchMe, updateUser, updateUserPassword, type User } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [profile, setProfile] = useState({ displayName: "", email: "", firstName: "", lastName: "", imageUrl: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: "", password: "", confirmPassword: "" });
  const [savingPw, setSavingPw] = useState(false);

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) { setLoading(false); return; }
    try {
      const me = await fetchMe(session.token);
      setUser(me.user);
      setProfile({ displayName: me.user.displayName ?? "", email: me.user.email ?? "", firstName: me.user.firstName ?? "", lastName: me.user.lastName ?? "", imageUrl: me.user.imageUrl ?? "" });
    } catch (err) { setError(err instanceof Error ? err.message : "加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile() {
    const session = getStoredSession(); if (!session?.token || !user) return;
    setSavingProfile(true); setError(null); setSaveMsg(null);
    try {
      const updated = await updateUser(session.token, user.id, { displayName: profile.displayName, email: profile.email, firstName: profile.firstName || null, lastName: profile.lastName || null, imageUrl: profile.imageUrl || null });
      setUser(updated); setSaveMsg("已保存");
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); }
    finally { setSavingProfile(false); }
  }

  async function savePassword() {
    const session = getStoredSession(); if (!session?.token || !user) return;
    if (!pw.currentPassword) { setError("请输入当前密码"); return; }
    if (pw.password.length < 8) { setError("新密码至少 8 位"); return; }
    if (pw.password !== pw.confirmPassword) { setError("两次密码不一致"); return; }
    setSavingPw(true); setError(null); setSaveMsg(null);
    try {
      await updateUserPassword(session.token, user.id, { currentPassword: pw.currentPassword, password: pw.password });
      setPw({ currentPassword: "", password: "", confirmPassword: "" }); setSaveMsg("密码已更新");
    } catch (err) { setError(err instanceof Error ? err.message : "修改失败"); }
    finally { setSavingPw(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  if (!user) return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">请先登录</div>;

  const initials = (user.displayName ?? user.email ?? "U").charAt(0).toUpperCase();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col items-center gap-3 py-4">
        <Avatar className="h-16 w-16"><AvatarFallback className="text-lg">{initials}</AvatarFallback></Avatar>
        <span className="text-sm text-muted-foreground">{user.email}</span>
      </div>

      <Separator />

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      {saveMsg && <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{saveMsg}</div>}

      <Tabs defaultValue="profile">
        <TabsList className="w-full justify-center">
          <TabsTrigger value="profile">个人资料</TabsTrigger>
          <TabsTrigger value="password">密码</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-4 space-y-4" value="profile">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">个人资料</CardTitle><CardDescription>编辑您的个人信息</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="dn">显示名称</Label><Input id="dn" onChange={(e) => setProfile(p => ({...p, displayName: e.target.value}))} value={profile.displayName} /></div>
                <div className="space-y-2"><Label htmlFor="em">邮箱</Label><Input id="em" onChange={(e) => setProfile(p => ({...p, email: e.target.value}))} type="email" value={profile.email} /></div>
                <div className="space-y-2"><Label htmlFor="fn">名</Label><Input id="fn" onChange={(e) => setProfile(p => ({...p, firstName: e.target.value}))} value={profile.firstName} /></div>
                <div className="space-y-2"><Label htmlFor="ln">姓</Label><Input id="ln" onChange={(e) => setProfile(p => ({...p, lastName: e.target.value}))} value={profile.lastName} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="iu">头像 URL</Label><Input id="iu" onChange={(e) => setProfile(p => ({...p, imageUrl: e.target.value}))} placeholder="https://..." type="url" value={profile.imageUrl} /></div>
              <div className="flex gap-2 justify-end"><Button disabled={savingProfile} onClick={saveProfile} size="sm">{savingProfile ? "保存中..." : "保存"}</Button></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="mt-4" value="password">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">修改密码</CardTitle><CardDescription>更新您的登录密码</CardDescription></CardHeader>
            <CardContent className="grid gap-4 max-w-md">
              <div className="space-y-2"><Label htmlFor="cp">当前密码</Label><Input autoComplete="current-password" id="cp" onChange={(e) => setPw(p => ({...p, currentPassword: e.target.value}))} type="password" value={pw.currentPassword} /></div>
              <div className="space-y-2"><Label htmlFor="np">新密码</Label><Input autoComplete="new-password" id="np" onChange={(e) => setPw(p => ({...p, password: e.target.value}))} placeholder="至少 8 位" type="password" value={pw.password} /></div>
              <div className="space-y-2"><Label htmlFor="cpw">确认密码</Label><Input autoComplete="new-password" id="cpw" onChange={(e) => setPw(p => ({...p, confirmPassword: e.target.value}))} type="password" value={pw.confirmPassword} /></div>
              <div className="flex gap-2 justify-end"><Button disabled={savingPw} onClick={savePassword} size="sm">{savingPw ? "保存中..." : "修改密码"}</Button></div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
