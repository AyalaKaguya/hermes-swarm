"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOrganizations, type Organization } from "@/lib/admin-api";
import { getStoredSession } from "@/lib/session";

export default function OrganizationsPage() {
  const [items, setItems] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setLoading(false);
      return;
    }
    try {
      setItems(await listOrganizations(session.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) =>
      [item.name, item.slug, item.subdomain].some((field) =>
        field?.toLowerCase().includes(value),
      ),
    );
  }, [items, search]);

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">加载中...</div>;
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">组织列表</h1>
          <p className="text-sm text-muted-foreground">租户范围内的组织管理视图</p>
        </div>
        <Input
          className="w-full sm:w-72"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索组织..."
          value={search}
        />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">组织</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>标识</TableHead>
                <TableHead>子域名</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="font-mono text-xs">{item.slug}</TableCell>
                  <TableCell>{item.subdomain ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "active" ? "default" : "secondary"}>
                      {item.status === "active" ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell className="py-8 text-center text-sm text-muted-foreground" colSpan={4}>
                    暂无组织
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
