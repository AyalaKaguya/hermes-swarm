"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { enUS, zhCN, zhTW } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  listLoginAuditLogs,
  listOperationAuditLogs,
  type AuditLogPage,
  type AuditLogQuery,
  type LoginAuditLogItem,
  type OperationAuditLogItem,
} from "@/lib/admin-api";
import {
  auditDateBoundaryToIso,
  auditDateFromKey,
  auditDateKeyFromDate,
  formatAuditDateKey,
} from "@/lib/audit-date-range";
import { getAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { formatRuntimeDateTime } from "@/lib/runtime-format";
import type { RuntimePreferences } from "@hermes-swarm/core/settings";

type AuditTab = "login" | "operation";
type AuditRow = LoginAuditLogItem | OperationAuditLogItem;

const PAGE_SIZE = 20;

export function AuditLogsView({
  scope,
}: {
  scope: "platform" | "tenant";
}) {
  const tr = useTextTranslation();
  const { runtimePreferences } = useI18n();
  const [tab, setTab] = useState<AuditTab>("login");
  const [draft, setDraft] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditLogPage<AuditRow>>({
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
  });
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<AuditLogQuery>(
    () => ({
      from: auditDateBoundaryToIso(
        filters.from,
        runtimePreferences.timeZone,
        "start",
      ),
      httpMethod:
        tab === "operation" && filters.httpMethod !== "all"
          ? filters.httpMethod
          : undefined,
      keyword: filters.keyword || undefined,
      page,
      pageSize: PAGE_SIZE,
      permission:
        tab === "operation" ? filters.permission || undefined : undefined,
      result: filters.result === "all" ? undefined : filters.result,
      to: auditDateBoundaryToIso(
        filters.to,
        runtimePreferences.timeZone,
        "end",
      ),
    }),
    [filters, page, runtimePreferences.timeZone, tab],
  );

  const load = useCallback(async () => {
    const session = await getAuthenticatedAdminSessionMarker();
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result =
        tab === "login"
          ? await listLoginAuditLogs(session, scope, query)
          : await listOperationAuditLogs(session, scope, query);
      setData(result);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return;
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : tr("日志加载失败"),
      );
    } finally {
      setLoading(false);
    }
  }, [query, scope, tab, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  function applyFilters() {
    setPage(1);
    setFilters(draft);
  }

  function resetFilters() {
    setPage(1);
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-4">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">{tr("日志审计")}</h1>
        <p className="text-sm text-muted-foreground">
          {scope === "platform"
            ? tr("查看平台管理员的登录和操作记录")
            : tr("查看当前工作空间及其组织的登录和操作记录")}
        </p>
      </header>

      {error && (
        <InlineNotice tone="error">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <Button onClick={() => void load()} size="sm" variant="outline">
              {tr("重试")}
            </Button>
          </div>
        </InlineNotice>
      )}

      <Tabs
        onValueChange={(value) => {
          setTab(value as AuditTab);
          setPage(1);
          setSelected(null);
          setDraft(EMPTY_FILTERS);
          setFilters(EMPTY_FILTERS);
        }}
        value={tab}
      >
        <TabsList>
          <TabsTrigger value="login">{tr("登录日志")}</TabsTrigger>
          <TabsTrigger value="operation">{tr("操作日志")}</TabsTrigger>
        </TabsList>

        <AuditFilters
          draft={draft}
          onApply={applyFilters}
          onChange={setDraft}
          onReset={resetFilters}
          runtimePreferences={runtimePreferences}
          tab={tab}
        />

        <TabsContent value="login">
          <LoginLogTable
            items={
              tab === "login" ? (data.items as LoginAuditLogItem[]) : []
            }
            loading={loading}
            onSelect={setSelected}
            runtimePreferences={runtimePreferences}
          />
        </TabsContent>
        <TabsContent value="operation">
          <OperationLogTable
            items={
              tab === "operation"
                ? (data.items as OperationAuditLogItem[])
                : []
            }
            loading={loading}
            onSelect={setSelected}
            runtimePreferences={runtimePreferences}
          />
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {tr("共")} {data.total} {tr("条记录")}
        </span>
        <div className="flex items-center gap-2">
          <Button
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            size="sm"
            variant="outline"
          >
            {tr("上一页")}
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            disabled={loading || page >= totalPages}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            size="sm"
            variant="outline"
          >
            {tr("下一页")}
          </Button>
        </div>
      </div>

      <AuditDetailSheet
        item={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        runtimePreferences={runtimePreferences}
      />
    </section>
  );
}

function AuditFilters({
  draft,
  onApply,
  onChange,
  onReset,
  runtimePreferences,
  tab,
}: {
  draft: AuditFilterState;
  onApply: () => void;
  onChange: (value: AuditFilterState) => void;
  onReset: () => void;
  runtimePreferences: RuntimePreferences;
  tab: AuditTab;
}) {
  const tr = useTextTranslation();
  const results =
    tab === "login"
      ? [
          { label: tr("成功"), value: "success" },
          { label: tr("失败"), value: "failed" },
        ]
      : [
          { label: tr("允许"), value: "allowed" },
          { label: tr("拒绝"), value: "denied" },
          { label: tr("错误"), value: "error" },
        ];
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/15 p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <FilterField label={tr("人员或关键词")}>
          <Input
            onChange={(event) =>
              onChange({ ...draft, keyword: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") onApply();
            }}
            placeholder={tr("姓名、邮箱、IP 或路径")}
            value={draft.keyword}
          />
        </FilterField>
        <FilterField label={tr("开始时间")}>
          <AuditDatePicker
            label={tr("开始时间")}
            onChange={(from) => onChange({ ...draft, from })}
            runtimePreferences={runtimePreferences}
            value={draft.from}
          />
        </FilterField>
        <FilterField label={tr("结束时间")}>
          <AuditDatePicker
            label={tr("结束时间")}
            onChange={(to) => onChange({ ...draft, to })}
            runtimePreferences={runtimePreferences}
            value={draft.to}
          />
        </FilterField>
        <FilterField label={tr("结果")}>
          <Select
            onValueChange={(result) => onChange({ ...draft, result })}
            value={draft.result}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("全部")}</SelectItem>
              {results.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        {tab === "operation" ? (
          <FilterField label={tr("HTTP 方法")}>
            <Select
              onValueChange={(httpMethod) =>
                onChange({ ...draft, httpMethod })
              }
              value={draft.httpMethod}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "GET", "POST", "PUT", "PATCH", "DELETE"].map(
                  (method) => (
                    <SelectItem key={method} value={method}>
                      {method === "all" ? tr("全部") : method}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </FilterField>
        ) : (
          <div />
        )}
      </div>
      {tab === "operation" && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <FilterField label={tr("权限动作")}>
            <Input
              onChange={(event) =>
                onChange({ ...draft, permission: event.target.value })
              }
              placeholder={tr("输入完整权限标识")}
              value={draft.permission}
            />
          </FilterField>
          <div className="flex items-end justify-end gap-2">
            <FilterButtons onApply={onApply} onReset={onReset} />
          </div>
        </div>
      )}
      {tab === "login" && (
        <div className="flex justify-end gap-2">
          <FilterButtons onApply={onApply} onReset={onReset} />
        </div>
      )}
    </div>
  );
}

function AuditDatePicker({
  label,
  onChange,
  runtimePreferences,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  runtimePreferences: RuntimePreferences;
  value: string;
}) {
  const tr = useTextTranslation();
  const [open, setOpen] = useState(false);
  const selected = auditDateFromKey(value);
  const locale =
    runtimePreferences.language === "en"
      ? enUS
      : runtimePreferences.language === "zh-Hant"
        ? zhTW
        : zhCN;
  const displayValue = formatAuditDateKey(
    value,
    runtimePreferences.dateFormat,
  );
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={label}
          className={`w-full justify-start font-normal ${
            displayValue ? "" : "text-muted-foreground"
          }`}
          type="button"
          variant="outline"
        >
          <CalendarIcon />
          {displayValue || tr("选择日期")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          captionLayout="dropdown"
          locale={locale}
          mode="single"
          onSelect={(date) => {
            onChange(date ? auditDateKeyFromDate(date) : "");
            setOpen(false);
          }}
          selected={selected}
        />
      </PopoverContent>
    </Popover>
  );
}

function FilterButtons({
  onApply,
  onReset,
}: {
  onApply: () => void;
  onReset: () => void;
}) {
  const tr = useTextTranslation();
  return (
    <>
      <Button onClick={onReset} type="button" variant="outline">
        {tr("重置")}
      </Button>
      <Button onClick={onApply} type="button">
        {tr("筛选")}
      </Button>
    </>
  );
}

function FilterField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function LoginLogTable({
  items,
  loading,
  onSelect,
  runtimePreferences,
}: {
  items: LoginAuditLogItem[];
  loading: boolean;
  onSelect: (item: LoginAuditLogItem) => void;
  runtimePreferences: ReturnType<typeof useI18n>["runtimePreferences"];
}) {
  const tr = useTextTranslation();
  return (
    <AuditTableState
      emptyText={tr("暂无登录日志")}
      loading={loading}
      rowCount={items.length}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tr("时间")}</TableHead>
            <TableHead>{tr("用户")}</TableHead>
            <TableHead>{tr("结果")}</TableHead>
            <TableHead>{tr("IP")}</TableHead>
            <TableHead>{tr("设备")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <ClickableRow
              key={item.id}
              onOpen={() => onSelect(item)}
            >
              <TableCell>
                {formatRuntimeDateTime(item.createdAt, runtimePreferences)}
              </TableCell>
              <TableCell>
                <div className="grid max-w-64">
                  <span className="truncate font-medium">
                    {item.actor?.displayName ?? item.attemptedEmail}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.actor?.email ?? item.attemptedEmail}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <ResultBadge result={item.result} />
              </TableCell>
              <TableCell>{item.ipAddress ?? tr("未知")}</TableCell>
              <TableCell>{item.deviceLabel ?? tr("未知设备")}</TableCell>
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
    </AuditTableState>
  );
}

function OperationLogTable({
  items,
  loading,
  onSelect,
  runtimePreferences,
}: {
  items: OperationAuditLogItem[];
  loading: boolean;
  onSelect: (item: OperationAuditLogItem) => void;
  runtimePreferences: ReturnType<typeof useI18n>["runtimePreferences"];
}) {
  const tr = useTextTranslation();
  return (
    <AuditTableState
      emptyText={tr("暂无操作日志")}
      loading={loading}
      rowCount={items.length}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tr("时间")}</TableHead>
            <TableHead>{tr("操作人")}</TableHead>
            <TableHead>{tr("动作")}</TableHead>
            <TableHead>{tr("范围")}</TableHead>
            <TableHead>{tr("结果")}</TableHead>
            <TableHead>{tr("状态")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <ClickableRow key={item.id} onOpen={() => onSelect(item)}>
              <TableCell>
                {formatRuntimeDateTime(item.createdAt, runtimePreferences)}
              </TableCell>
              <TableCell>
                <div className="grid max-w-56">
                  <span className="truncate font-medium">
                    {item.actor?.displayName ?? item.actorId ?? tr("匿名")}
                  </span>
                  {item.actor?.email && (
                    <span className="truncate text-xs text-muted-foreground">
                      {item.actor.email}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="grid max-w-72">
                  <span className="truncate font-medium">
                    {item.operationLabel}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {item.permission}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                {item.organization?.name ??
                  item.targetTenant?.name ??
                  scopeLabel(item.scopeType, tr)}
              </TableCell>
              <TableCell>
                <ResultBadge result={item.result} />
              </TableCell>
              <TableCell>{item.statusCode ?? "—"}</TableCell>
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
    </AuditTableState>
  );
}

function AuditTableState({
  children,
  emptyText,
  loading,
  rowCount,
}: {
  children: React.ReactNode;
  emptyText: string;
  loading: boolean;
  rowCount: number;
}) {
  const tr = useTextTranslation();
  if (loading) {
    return (
      <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
        {tr("加载中...")}
      </div>
    );
  }
  if (!rowCount) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }
  return <div className="rounded-lg border">{children}</div>;
}

function ClickableRow({
  children,
  onOpen,
}: {
  children: React.ReactNode;
  onOpen: () => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }
  return (
    <TableRow
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {children}
    </TableRow>
  );
}

function ResultBadge({ result }: { result: string }) {
  const tr = useTextTranslation();
  const labels: Record<string, string> = {
    allowed: tr("允许"),
    denied: tr("拒绝"),
    error: tr("错误"),
    failed: tr("失败"),
    success: tr("成功"),
  };
  return (
    <Badge
      variant={
        result === "success" || result === "allowed"
          ? "secondary"
          : result === "error" || result === "failed"
            ? "destructive"
            : "outline"
      }
    >
      {labels[result] ?? result}
    </Badge>
  );
}

function AuditDetailSheet({
  item,
  onOpenChange,
  runtimePreferences,
}: {
  item: AuditRow | null;
  onOpenChange: (open: boolean) => void;
  runtimePreferences: ReturnType<typeof useI18n>["runtimePreferences"];
}) {
  const tr = useTextTranslation();
  const login = item && isLoginLog(item) ? item : null;
  const operation = item && !isLoginLog(item) ? item : null;
  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(item)}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {login ? tr("登录日志详情") : tr("操作日志详情")}
          </SheetTitle>
          <SheetDescription>
            {item
              ? formatRuntimeDateTime(item.createdAt, runtimePreferences)
              : ""}
          </SheetDescription>
        </SheetHeader>
        {item && (
          <div className="grid gap-1 px-4 pb-6">
            <DetailRow
              label={tr("用户")}
              value={
                item.actor?.displayName ??
                item.actor?.email ??
                item.actorId ??
                tr("未知")
              }
            />
            <DetailRow
              label={tr("邮箱")}
              value={item.actor?.email ?? login?.attemptedEmail ?? "—"}
            />
            <DetailRow
              label={tr("结果")}
              value={<ResultBadge result={item.result} />}
            />
            <DetailRow label={tr("Scope")} value={scopeLabel(item.scopeType, tr)} />
            <DetailRow label={tr("IP")} value={item.ipAddress ?? "—"} />
            <DetailRow label={tr("会话 ID")} value={item.sessionId ?? "—"} mono />
            {login && (
              <>
                <DetailRow
                  label={tr("设备")}
                  value={login.deviceLabel ?? "—"}
                />
                <DetailRow
                  label={tr("失败原因")}
                  value={failureLabel(login.failureCode, tr)}
                />
              </>
            )}
            {operation && (
              <>
                <DetailRow
                  label={tr("动作")}
                  value={operation.operationLabel}
                />
                <DetailRow
                  label={tr("权限")}
                  value={operation.permission}
                  mono
                />
                <DetailRow
                  label={tr("组织")}
                  value={operation.organization?.name ?? "—"}
                />
                <DetailRow
                  label={tr("目标租户")}
                  value={operation.targetTenant?.name ?? "—"}
                />
                <DetailRow
                  label={tr("请求")}
                  value={
                    [operation.httpMethod, operation.httpPath]
                      .filter(Boolean)
                      .join(" ") || "—"
                  }
                  mono
                />
                <DetailRow
                  label={tr("状态码")}
                  value={operation.statusCode?.toString() ?? "—"}
                />
                <DetailRow
                  label={tr("错误码")}
                  value={operation.errorCode ?? "—"}
                  mono
                />
              </>
            )}
            <DetailRow
              label="User-Agent"
              value={item.userAgent ?? "—"}
              mono
            />
            <DetailRow label={tr("日志 ID")} value={item.id} mono />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b py-3 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "break-all font-mono text-xs" : "break-words"}>
        {value}
      </span>
    </div>
  );
}

function isLoginLog(item: AuditRow): item is LoginAuditLogItem {
  return "attemptedEmail" in item;
}

function scopeLabel(
  scope: AuditRow["scopeType"],
  tr: (value: string) => string,
) {
  const labels: Record<AuditRow["scopeType"], string> = {
    organization: tr("组织"),
    own: tr("个人"),
    platform: tr("平台"),
    tenant: tr("工作空间"),
  };
  return labels[scope];
}

function failureLabel(
  code: string | null,
  tr: (value: string) => string,
) {
  if (!code) return "—";
  const labels: Record<string, string> = {
    internal_error: tr("系统错误"),
    invalid_credentials: tr("账号或密码不正确"),
    tenant_unresolved: tr("工作空间无法识别"),
  };
  return labels[code] ?? code;
}

type AuditFilterState = {
  from: string;
  httpMethod: string;
  keyword: string;
  permission: string;
  result: string;
  to: string;
};

const EMPTY_FILTERS: AuditFilterState = {
  from: "",
  httpMethod: "all",
  keyword: "",
  permission: "",
  result: "all",
  to: "",
};
