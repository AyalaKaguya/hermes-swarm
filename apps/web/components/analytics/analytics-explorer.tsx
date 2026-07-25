"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppIcon } from "@/components/app-icon";
import { AnalyticsVisualization } from "@/components/analytics/analytics-visualization";
import { useI18n } from "@/components/i18n-provider";
import { InlineNotice } from "@/components/inline-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  createAnalysisView,
  deleteAnalysisView,
  getSupportTicketsAnalyticsSchema,
  listAnalysisViews,
  runAnalyticsQuery,
  updateAnalysisView,
  type AnalysisFilter,
  type AnalysisFilterOperator,
  type AnalysisMeasure,
  type AnalysisQuery,
  type AnalysisSort,
  type AnalysisView,
  type DatasetFieldDescriptor,
  type DatasetResult,
  type DatasetResultField,
  type DatasetSchema,
  type VisualizationSpec,
} from "@/lib/admin-api/analytics";
import { requireAuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import {
  formatRuntimeDate,
  formatRuntimeDateTime,
  runtimeFormattingLocale,
} from "@/lib/runtime-format";
import {
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_VISUALIZATION_VERSION,
} from "@hermes-swarm/api-contracts/analytics";

type FilterDraft = {
  field: string;
  id: string;
  operator: AnalysisFilterOperator;
  value: string;
};

type MeasureDraft = {
  aggregation: "count" | "max" | "min";
  field: string;
  id: string;
};

type SortDraft = {
  direction: "asc" | "desc";
  field: string;
  id: string;
};

type QueryDraft = {
  filters: FilterDraft[];
  groupBy: string[];
  measures: MeasureDraft[];
  pageSize: number;
  selectedFields: string[];
  sorts: SortDraft[];
};

type ResolvedMeasure = {
  as: string;
  draft: MeasureDraft;
  label: string;
};

export function AnalyticsExplorer() {
  const tr = useTextTranslation();
  const { runtimePreferences } = useI18n();
  const idSequence = useRef(10);
  const [schema, setSchema] = useState<DatasetSchema | null>(null);
  const [draft, setDraft] = useState<QueryDraft | null>(null);
  const [result, setResult] = useState<DatasetResult | null>(null);
  const [executedQuery, setExecutedQuery] = useState<AnalysisQuery | null>(null);
  const [visualization, setVisualization] = useState<VisualizationSpec>({
    schemaVersion: ANALYTICS_VISUALIZATION_VERSION,
    type: "table",
  });
  const [views, setViews] = useState<AnalysisView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("new");
  const [viewName, setViewName] = useState("");
  const [viewsLoading, setViewsLoading] = useState(true);
  const [viewSaving, setViewSaving] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [queryRunning, setQueryRunning] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const nextId = useCallback((prefix: string) => {
    idSequence.current += 1;
    return `${prefix}-${idSequence.current}`;
  }, []);

  const runQuery = useCallback(
    async (query: AnalysisQuery, cursor?: string) => {
      setQueryRunning(true);
      setQueryError(null);
      try {
        const session = await requireAuthenticatedAdminSessionMarker();
        const page = cursor
          ? { cursor, size: query.page.size }
          : { size: query.page.size };
        const next = await runAnalyticsQuery(session, { ...query, page });
        setResult(next);
        return true;
      } catch (error) {
        setQueryError(
          error instanceof Error ? tr(error.message) : tr("分析查询失败"),
        );
        return false;
      } finally {
        setQueryRunning(false);
      }
    },
    [tr],
  );

  const loadSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const nextSchema = await getSupportTicketsAnalyticsSchema(session);
      const initialDraft = defaultDraft(nextSchema);
      const initialQuery = buildQuery(nextSchema, initialDraft, tr);
      setSchema(nextSchema);
      setDraft(initialDraft);
      setExecutedQuery(initialQuery);
      setVisualization(defaultVisualization(initialQuery, null, "table"));
      setCursorHistory([undefined]);
      setPageIndex(0);
      setValidationError(null);
      await runQuery(initialQuery);
    } catch (error) {
      setSchemaError(
        error instanceof Error ? tr(error.message) : tr("数据集加载失败"),
      );
    } finally {
      setSchemaLoading(false);
    }
  }, [runQuery, tr]);

  const loadViews = useCallback(async () => {
    setViewsLoading(true);
    setViewError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      setViews(await listAnalysisViews(session));
    } catch (error) {
      setViewError(
        error instanceof Error ? tr(error.message) : tr("分析视图加载失败"),
      );
    } finally {
      setViewsLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    void loadSchema();
    void loadViews();
  }, [loadSchema, loadViews]);

  const resolvedMeasures = useMemo(
    () => resolveMeasures(draft?.measures ?? [], schema, tr),
    [draft?.measures, schema, tr],
  );
  const aggregateMode = Boolean(
    draft && (draft.groupBy.length > 0 || draft.measures.length > 0),
  );
  const sortOptions = useMemo(
    () => schema && draft
      ? buildSortOptions(schema, draft, resolvedMeasures, tr)
      : [],
    [draft, resolvedMeasures, schema, tr],
  );
  const resultLabels = useMemo(
    () => new Map([
      ...(schema?.fields ?? []).map((field) => [field.key, tr(field.label)] as const),
      ...resolvedMeasures.map((measure) => [measure.as, measure.label] as const),
    ]),
    [resolvedMeasures, schema?.fields, tr],
  );

  async function executeDraft() {
    if (!schema || !draft) return;
    try {
      const query = buildQuery(schema, draft, tr);
      setValidationError(null);
      setExecutedQuery(query);
      setVisualization((current) =>
        defaultVisualization(query, null, current.type)
      );
      setCursorHistory([undefined]);
      setPageIndex(0);
      await runQuery(query);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : tr("查询条件无效"),
      );
    }
  }

  async function selectSavedView(value: string) {
    setViewError(null);
    if (value === "new") {
      setSelectedViewId("new");
      setViewName("");
      return;
    }
    const view = views.find((item) => item.id === value);
    if (!view) return;
    setSelectedViewId(view.id);
    setViewName(view.name);
    setDraft(queryToDraft(view.query, nextId));
    setExecutedQuery(view.query);
    setVisualization(view.visualization);
    setCursorHistory([undefined]);
    setPageIndex(0);
    await runQuery(view.query);
  }

  async function saveCurrentView() {
    if (!schema || !executedQuery || !result) return;
    const name = viewName.trim();
    if (!name) {
      setViewError(tr("请输入分析视图名称"));
      return;
    }
    setViewSaving(true);
    setViewError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      const resolvedVisualization = defaultVisualization(
        executedQuery,
        result,
        visualization.type,
      );
      const selected = views.find((item) => item.id === selectedViewId);
      const saved = selected
        ? await updateAnalysisView(session, selected.id, {
            datasetId: schema.sourceKey,
            expectedRevision: selected.revision,
            name,
            query: executedQuery,
            visualization: resolvedVisualization,
          })
        : await createAnalysisView(session, {
            datasetId: schema.sourceKey,
            name,
            query: executedQuery,
            visualization: resolvedVisualization,
          });
      setViews((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setSelectedViewId(saved.id);
      setViewName(saved.name);
      setVisualization(saved.visualization);
    } catch (error) {
      setViewError(
        error instanceof Error ? tr(error.message) : tr("分析视图保存失败"),
      );
    } finally {
      setViewSaving(false);
    }
  }

  async function removeSelectedView() {
    const selected = views.find((item) => item.id === selectedViewId);
    if (!selected) return;
    if (!window.confirm(tr("确定删除此分析视图吗？"))) return;
    setViewSaving(true);
    setViewError(null);
    try {
      const session = await requireAuthenticatedAdminSessionMarker();
      await deleteAnalysisView(session, selected.id, {
        expectedRevision: selected.revision,
      });
      setViews((current) => current.filter((item) => item.id !== selected.id));
      setSelectedViewId("new");
      setViewName("");
    } catch (error) {
      setViewError(
        error instanceof Error ? tr(error.message) : tr("分析视图删除失败"),
      );
    } finally {
      setViewSaving(false);
    }
  }

  function selectVisualizationType(type: VisualizationSpec["type"]) {
    if (!executedQuery) return;
    setVisualization(defaultVisualization(executedQuery, result, type));
  }

  async function goToPage(nextIndex: number, cursor: string | undefined) {
    if (!executedQuery || nextIndex < 0) return;
    if (await runQuery(executedQuery, cursor)) {
      setPageIndex(nextIndex);
    }
  }

  async function goNext() {
    const cursor = result?.pageInfo.nextCursor ?? undefined;
    if (!cursor) return;
    const nextHistory = [
      ...cursorHistory.slice(0, pageIndex + 1),
      cursor,
    ];
    if (await runQuery(executedQuery!, cursor)) {
      setCursorHistory(nextHistory);
      setPageIndex(pageIndex + 1);
    }
  }

  if (schemaLoading && !schema) {
    return <AnalyticsLoading />;
  }

  if (!schema || !draft) {
    return (
      <div className="mx-auto grid w-full max-w-7xl gap-4">
        <PageHeading />
        <InlineNotice title={tr("数据集加载失败")} tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{schemaError ?? tr("暂时无法读取工单分析字段")}</span>
            <Button onClick={() => void loadSchema()} size="sm" variant="outline">
              {tr("重试")}
            </Button>
          </div>
        </InlineNotice>
      </div>
    );
  }

  const fieldMap = new Map(schema.fields.map((field) => [field.key, field]));
  const visualizationTypes = availableVisualizationTypes(result);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
      <PageHeading />

      <Card size="sm">
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-52 flex-1 gap-1.5">
            <Label>{tr("分析视图")}</Label>
            <Select
              disabled={viewsLoading || viewSaving}
              onValueChange={(value) => void selectSavedView(value)}
              value={selectedViewId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={tr("选择分析视图")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{tr("新分析视图")}</SelectItem>
                {views.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {view.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-52 flex-[1.2] gap-1.5">
            <Label htmlFor="analysis-view-name">{tr("视图名称")}</Label>
            <Input
              disabled={viewSaving}
              id="analysis-view-name"
              onChange={(event) => setViewName(event.target.value)}
              placeholder={tr("例如：工单状态概览")}
              value={viewName}
            />
          </div>
          <Button
            disabled={viewSaving || !result}
            onClick={() => void saveCurrentView()}
            type="button"
          >
            {viewSaving ? <Spinner /> : <AppIcon name="check" />}
            {selectedViewId === "new" ? tr("保存视图") : tr("更新视图")}
          </Button>
          <Button
            aria-label={tr("删除分析视图")}
            disabled={viewSaving || selectedViewId === "new"}
            onClick={() => void removeSelectedView()}
            title={tr("删除分析视图")}
            type="button"
            variant="outline"
          >
            <AppIcon name="trash" />
            {tr("删除")}
          </Button>
        </CardContent>
      </Card>

      {viewError && (
        <InlineNotice title={tr("分析视图操作失败")} tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{viewError}</span>
            <Button onClick={() => void loadViews()} size="sm" variant="outline">
              {tr("刷新视图")}
            </Button>
          </div>
        </InlineNotice>
      )}

      {schemaError && (
        <InlineNotice title={tr("数据集刷新失败")} tone="error">
          {schemaError}
        </InlineNotice>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="min-h-0 xl:overflow-y-auto" size="sm">
          <CardHeader className="border-b">
            <CardTitle>{tr("查询条件")}</CardTitle>
            <CardDescription>
              {tr("只分析当前工作空间的工单状态与生命周期时间")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <FieldChecklist
              disabled={aggregateMode}
              fields={schema.fields.filter((field) => field.capabilities.selectable)}
              label={tr("明细字段")}
              onChange={(selectedFields) =>
                setDraft((current) => current && { ...current, selectedFields })
              }
              selected={draft.selectedFields}
            />
            {aggregateMode && (
              <p className="-mt-3 text-xs text-muted-foreground">
                {tr("分组或指标启用时，结果只显示分组字段与指标。")}
              </p>
            )}

            <Separator />

            <FieldChecklist
              fields={schema.fields.filter((field) => field.capabilities.groupable)}
              label={tr("分组")}
              onChange={(groupBy) =>
                setDraft((current) => current && { ...current, groupBy })
              }
              selected={draft.groupBy}
            />

            <MeasureEditor
              fields={schema.fields}
              measures={draft.measures}
              onAdd={() =>
                setDraft((current) => current && {
                  ...current,
                  measures: [
                    ...current.measures,
                    { aggregation: "count", field: "", id: nextId("measure") },
                  ],
                })
              }
              onChange={(id, value) =>
                setDraft((current) => current && {
                  ...current,
                  measures: current.measures.map((measure) =>
                    measure.id === id ? { ...measure, ...value } : measure,
                  ),
                })
              }
              onRemove={(id) =>
                setDraft((current) => current && {
                  ...current,
                  measures: current.measures.filter((measure) => measure.id !== id),
                })
              }
              resolved={resolvedMeasures}
            />

            <Separator />

            <FilterEditor
              fields={schema.fields}
              filters={draft.filters}
              onAdd={() => {
                const field = schema.fields.find((item) =>
                  item.capabilities.filterOperators.length > 0,
                );
                if (!field) return;
                setDraft((current) => current && {
                  ...current,
                  filters: [
                    ...current.filters,
                    defaultFilter(nextId("filter"), field),
                  ],
                });
              }}
              onChange={(id, value) =>
                setDraft((current) => current && {
                  ...current,
                  filters: current.filters.map((filter) =>
                    filter.id === id ? { ...filter, ...value } : filter,
                  ),
                })
              }
              onRemove={(id) =>
                setDraft((current) => current && {
                  ...current,
                  filters: current.filters.filter((filter) => filter.id !== id),
                })
              }
            />

            <Separator />

            <SortEditor
              onAdd={() => {
                const first = sortOptions[0];
                if (!first) return;
                setDraft((current) => current && {
                  ...current,
                  sorts: [
                    ...current.sorts,
                    { direction: "desc", field: first.key, id: nextId("sort") },
                  ],
                });
              }}
              onChange={(id, value) =>
                setDraft((current) => current && {
                  ...current,
                  sorts: current.sorts.map((sort) =>
                    sort.id === id ? { ...sort, ...value } : sort,
                  ),
                })
              }
              onRemove={(id) =>
                setDraft((current) => current && {
                  ...current,
                  sorts: current.sorts.filter((sort) => sort.id !== id),
                })
              }
              options={sortOptions}
              sorts={draft.sorts}
            />

            <div className="grid gap-1.5">
              <Label>{tr("每页行数")}</Label>
              <Select
                onValueChange={(value) =>
                  setDraft((current) => current && {
                    ...current,
                    pageSize: Number(value),
                  })
                }
                value={String(draft.pageSize)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100, 200].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {validationError && (
              <InlineNotice tone="error">{validationError}</InlineNotice>
            )}

            <Button
              className="w-full"
              disabled={queryRunning}
              onClick={() => void executeDraft()}
              type="button"
            >
              {queryRunning ? <Spinner /> : <AppIcon name="chart" />}
              {queryRunning ? tr("分析中") : tr("开始分析")}
            </Button>
          </CardContent>
        </Card>

        <Card className="min-h-[28rem] min-w-0" size="sm">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{tr("分析结果")}</CardTitle>
                <CardDescription>
                  {result
                    ? tr("查询结果来自当前工作空间的受限工单数据集")
                    : tr("设置查询条件后开始分析")}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  disabled={!result || queryRunning}
                  onValueChange={(value) =>
                    selectVisualizationType(value as VisualizationSpec["type"])
                  }
                  value={visualization.type}
                >
                  <SelectTrigger className="w-32" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visualizationTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {visualizationTypeLabel(type, tr)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {result && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {tr("第 {page} 页").replace("{page}", String(pageIndex + 1))}
                  </Badge>
                  <span>
                    {tr("{count} 行").replace(
                      "{count}",
                      String(result.summary.returnedRows),
                    )}
                  </span>
                  <span>·</span>
                  <span>{result.summary.durationMs} ms</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {queryError && (
              <InlineNotice title={tr("查询失败")} tone="error">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{queryError}</span>
                  {executedQuery && (
                    <Button
                      disabled={queryRunning}
                      onClick={() =>
                        void runQuery(executedQuery, cursorHistory[pageIndex])
                      }
                      size="sm"
                      variant="outline"
                    >
                      {tr("重试")}
                    </Button>
                  )}
                </div>
              </InlineNotice>
            )}

            {result?.summary.truncated && (
              <InlineNotice title={tr("结果已截断")}>
                {tr("结果超过当前查询预算，仅显示可安全返回的部分。")}
              </InlineNotice>
            )}

            <div
              aria-busy={queryRunning}
              className="relative min-h-0 flex-1 overflow-hidden rounded-lg border"
            >
              {queryRunning && result && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-background/65 backdrop-blur-[1px]">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    {tr("结果准备中")}
                  </div>
                </div>
              )}
              {queryRunning && !result ? (
                <ResultsLoading />
              ) : result && result.rows.length > 0 ? (
                <AnalyticsVisualization
                  formatValue={(value, field) => (
                    <ResultValue
                      descriptor={fieldMap.get(field.key)}
                      field={field}
                      preferences={runtimePreferences}
                      value={value}
                    />
                  )}
                  labels={resultLabels}
                  locale={runtimeFormattingLocale(runtimePreferences)}
                  result={result}
                  spec={visualization}
                />
              ) : (
                <EmptyResults hasRun={Boolean(result)} />
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {queryRunning
                  ? tr("正在执行受限查询")
                  : result
                    ? tr("查询完成")
                    : tr("尚未执行查询")}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  disabled={queryRunning || pageIndex === 0}
                  onClick={() =>
                    void goToPage(pageIndex - 1, cursorHistory[pageIndex - 1])
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {tr("上一页")}
                </Button>
                <Button
                  disabled={
                    queryRunning ||
                    !result?.pageInfo.hasMore ||
                    !result.pageInfo.nextCursor
                  }
                  onClick={() => void goNext()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {tr("下一页")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PageHeading() {
  const tr = useTextTranslation();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{tr("数据分析")}</h1>
        <p className="text-sm text-muted-foreground">
          {tr("使用受限字段探索当前工作空间的工单趋势")}
        </p>
      </div>
      <Badge variant="secondary">support.tickets / v1</Badge>
    </div>
  );
}

function AnalyticsLoading() {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4">
      <div className="grid gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Skeleton className="h-[34rem]" />
        <Skeleton className="h-[34rem]" />
      </div>
    </div>
  );
}

function ResultsLoading() {
  return (
    <div className="grid gap-3 p-4">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton className="h-7 w-full" key={index} />
      ))}
    </div>
  );
}

function EmptyResults({ hasRun }: { hasRun: boolean }) {
  const tr = useTextTranslation();
  return (
    <div className="grid min-h-[24rem] place-items-center p-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-2">
        <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <AppIcon className="size-5" name={hasRun ? "list-x" : "chart"} />
        </div>
        <div className="text-sm font-medium">
          {hasRun ? tr("没有符合条件的工单") : tr("尚无分析结果")}
        </div>
        <p className="text-xs text-muted-foreground">
          {hasRun
            ? tr("调整筛选、分组或时间范围后重试。")
            : tr("在左侧设置字段与条件，然后开始分析。")}
        </p>
      </div>
    </div>
  );
}

function FieldChecklist({
  disabled = false,
  fields,
  label,
  onChange,
  selected,
}: {
  disabled?: boolean;
  fields: DatasetFieldDescriptor[];
  label: string;
  onChange: (value: string[]) => void;
  selected: string[];
}) {
  const tr = useTextTranslation();
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {fields.map((field) => {
          const checked = selected.includes(field.key);
          const id = `${label}-${field.key}`;
          return (
            <div className="flex min-w-0 items-center gap-2" key={field.key}>
              <Checkbox
                checked={checked}
                disabled={disabled}
                id={id}
                onCheckedChange={(value) =>
                  onChange(
                    value === true
                      ? [...selected, field.key]
                      : selected.filter((item) => item !== field.key),
                  )
                }
              />
              <Label className="min-w-0 truncate text-xs font-normal" htmlFor={id}>
                {tr(field.label)}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function MeasureEditor({
  fields,
  measures,
  onAdd,
  onChange,
  onRemove,
  resolved,
}: {
  fields: DatasetFieldDescriptor[];
  measures: MeasureDraft[];
  onAdd: () => void;
  onChange: (id: string, value: Partial<MeasureDraft>) => void;
  onRemove: (id: string) => void;
  resolved: ResolvedMeasure[];
}) {
  const tr = useTextTranslation();
  const datetimeFields = fields.filter((field) =>
    field.capabilities.aggregations.some((item) => item === "min" || item === "max"),
  );
  return (
    <div className="grid gap-2">
      <SectionHeader label={tr("指标")} onAdd={onAdd} />
      {measures.length === 0 ? (
        <SmallEmpty>{tr("未添加指标")}</SmallEmpty>
      ) : (
        <div className="grid gap-2">
          {measures.map((measure, index) => (
            <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] gap-1.5" key={measure.id}>
              <Select
                onValueChange={(value) => {
                  const aggregation = value as MeasureDraft["aggregation"];
                  onChange(measure.id, {
                    aggregation,
                    field:
                      aggregation === "count"
                        ? ""
                        : measure.field || datetimeFields[0]?.key || "",
                  });
                }}
                value={measure.aggregation}
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">{tr("计数")}</SelectItem>
                  <SelectItem value="min">{tr("最早时间")}</SelectItem>
                  <SelectItem value="max">{tr("最晚时间")}</SelectItem>
                </SelectContent>
              </Select>
              {measure.aggregation === "count" ? (
                <div className="flex h-7 min-w-0 items-center rounded-lg border bg-muted/30 px-2 text-xs text-muted-foreground">
                  {resolved[index]?.label ?? tr("工单数")}
                </div>
              ) : (
                <Select
                  onValueChange={(field) => onChange(measure.id, { field })}
                  value={measure.field || datetimeFields[0]?.key}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder={tr("选择时间字段")} />
                  </SelectTrigger>
                  <SelectContent>
                    {datetimeFields.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {tr(field.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <IconButton label={tr("删除指标")} onClick={() => onRemove(measure.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterEditor({
  fields,
  filters,
  onAdd,
  onChange,
  onRemove,
}: {
  fields: DatasetFieldDescriptor[];
  filters: FilterDraft[];
  onAdd: () => void;
  onChange: (id: string, value: Partial<FilterDraft>) => void;
  onRemove: (id: string) => void;
}) {
  const tr = useTextTranslation();
  const filterable = fields.filter((field) =>
    supportedOperators(field).length > 0,
  );
  return (
    <div className="grid gap-2">
      <SectionHeader label={tr("筛选")} onAdd={onAdd} />
      {filters.length === 0 ? (
        <SmallEmpty>{tr("未添加筛选条件")}</SmallEmpty>
      ) : (
        <div className="grid gap-2">
          {filters.map((filter) => {
            const field = filterable.find((item) => item.key === filter.field) ?? filterable[0];
            if (!field) return null;
            const operators = supportedOperators(field);
            const operator = operators.includes(filter.operator)
              ? filter.operator
              : operators[0]!;
            const noValue = operator === "isNull" || operator === "isNotNull";
            return (
              <div className="grid gap-1.5 rounded-lg border bg-muted/15 p-2" key={filter.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-1.5">
                  <Select
                    onValueChange={(fieldKey) => {
                      const nextField = filterable.find((item) => item.key === fieldKey)!;
                      const nextOperator = supportedOperators(nextField)[0]!;
                      onChange(filter.id, {
                        field: fieldKey,
                        operator: nextOperator,
                        value: defaultFilterValue(nextField),
                      });
                    }}
                    value={field.key}
                  >
                    <SelectTrigger className="w-full" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {filterable.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {tr(item.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    onValueChange={(value) =>
                      onChange(filter.id, {
                        operator: value as AnalysisFilterOperator,
                      })
                    }
                    value={operator}
                  >
                    <SelectTrigger className="w-full" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {operators.map((item) => (
                        <SelectItem key={item} value={item}>
                          {filterOperatorLabel(item, tr)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <IconButton label={tr("删除筛选")} onClick={() => onRemove(filter.id)} />
                </div>
                {!noValue && (
                  <FilterValueInput
                    field={field}
                    onChange={(value) => onChange(filter.id, { value })}
                    value={filter.value}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterValueInput({
  field,
  onChange,
  value,
}: {
  field: DatasetFieldDescriptor;
  onChange: (value: string) => void;
  value: string;
}) {
  const tr = useTextTranslation();
  if (field.scalarType === "enum") {
    return (
      <Select onValueChange={onChange} value={value || field.enumValues?.[0]?.value}>
        <SelectTrigger className="w-full" size="sm">
          <SelectValue placeholder={tr("选择值")} />
        </SelectTrigger>
        <SelectContent>
          {field.enumValues?.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {tr(item.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      aria-label={tr(field.label)}
      onChange={(event) => onChange(event.target.value)}
      type={field.scalarType === "datetime" ? "datetime-local" : field.scalarType === "date" ? "date" : "text"}
      value={value}
    />
  );
}

function SortEditor({
  onAdd,
  onChange,
  onRemove,
  options,
  sorts,
}: {
  onAdd: () => void;
  onChange: (id: string, value: Partial<SortDraft>) => void;
  onRemove: (id: string) => void;
  options: { key: string; label: string }[];
  sorts: SortDraft[];
}) {
  const tr = useTextTranslation();
  return (
    <div className="grid gap-2">
      <SectionHeader disabled={options.length === 0} label={tr("排序")} onAdd={onAdd} />
      {sorts.length === 0 ? (
        <SmallEmpty>{tr("使用数据集默认排序")}</SmallEmpty>
      ) : (
        <div className="grid gap-2">
          {sorts.map((sort) => {
            const selected = options.some((item) => item.key === sort.field)
              ? sort.field
              : undefined;
            return (
              <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-1.5" key={sort.id}>
                <Select onValueChange={(field) => onChange(sort.id, { field })} value={selected}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder={tr("选择排序字段")} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  onValueChange={(direction) =>
                    onChange(sort.id, { direction: direction as SortDraft["direction"] })
                  }
                  value={sort.direction}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">{tr("升序")}</SelectItem>
                    <SelectItem value="desc">{tr("降序")}</SelectItem>
                  </SelectContent>
                </Select>
                <IconButton label={tr("删除排序")} onClick={() => onRemove(sort.id)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  disabled = false,
  label,
  onAdd,
}: {
  disabled?: boolean;
  label: string;
  onAdd: () => void;
}) {
  const tr = useTextTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <Label>{label}</Label>
      <Button
        aria-label={tr("添加 {label}").replace("{label}", label)}
        disabled={disabled}
        onClick={onAdd}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <AppIcon name="plus" />
      </Button>
    </div>
  );
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      aria-label={label}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      <AppIcon name="trash" />
    </Button>
  );
}

function SmallEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function ResultValue({
  descriptor,
  field,
  preferences,
  value,
}: {
  descriptor?: DatasetFieldDescriptor;
  field: DatasetResultField;
  preferences: ReturnType<typeof useI18n>["runtimePreferences"];
  value: boolean | number | string | null | undefined;
}) {
  const tr = useTextTranslation();
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (field.scalarType === "datetime") {
    return formatRuntimeDateTime(String(value), preferences);
  }
  if (field.scalarType === "date") {
    return formatRuntimeDate(String(value), preferences);
  }
  if (field.scalarType === "number" && typeof value === "number") {
    return new Intl.NumberFormat(runtimeFormattingLocale(preferences), {
      maximumFractionDigits: field.format?.type === "number"
        ? field.format.maximumFractionDigits
        : 2,
    }).format(value);
  }
  if (field.scalarType === "enum") {
    const label = descriptor?.enumValues?.find((item) => item.value === value)?.label;
    return <Badge variant="secondary">{label ? tr(label) : String(value)}</Badge>;
  }
  return String(value);
}

function defaultDraft(schema: DatasetSchema): QueryDraft {
  const status = schema.fields.find((field) => field.key === "status");
  const updatedAt = schema.fields.find((field) => field.key === "updatedAt");
  const groupBy = status?.capabilities.groupable ? [status.key] : [];
  const measures: MeasureDraft[] = [{
    aggregation: "count",
    field: "",
    id: "measure-1",
  }];
  return {
    filters: [],
    groupBy,
    measures,
    pageSize: 50,
    selectedFields: [status?.key, updatedAt?.key].filter(
      (value): value is string => Boolean(value),
    ),
    sorts: [{ direction: "desc", field: "ticketCount", id: "sort-1" }],
  };
}

function queryToDraft(
  query: AnalysisQuery,
  nextId: (prefix: string) => string,
): QueryDraft {
  return {
    filters: query.filters.map((filter) => ({
      field: filter.field,
      id: nextId("filter"),
      operator: filter.operator,
      value: "value" in filter
        ? Array.isArray(filter.value)
          ? filter.value.join(", ")
          : String(filter.value)
        : "",
    })),
    groupBy: [...query.groupBy],
    measures: query.measures.flatMap((measure) => {
      if (
        measure.aggregation !== "count" &&
        measure.aggregation !== "min" &&
        measure.aggregation !== "max"
      ) {
        return [];
      }
      return [{
        aggregation: measure.aggregation,
        field: measure.field ?? "",
        id: nextId("measure"),
      }];
    }),
    pageSize: query.page.size,
    selectedFields: [...query.select],
    sorts: query.sort.map((sort) => ({
      direction: sort.direction,
      field: sort.field,
      id: nextId("sort"),
    })),
  };
}

function defaultVisualization(
  query: AnalysisQuery,
  result: DatasetResult | null,
  requestedType: VisualizationSpec["type"],
): VisualizationSpec {
  const numericFields = result
    ? result.schema
        .filter((field) => field.scalarType === "number")
        .map((field) => field.key)
    : query.measures
        .filter((measure) =>
          measure.aggregation === "count" ||
          measure.aggregation === "countDistinct" ||
          measure.aggregation === "sum" ||
          measure.aggregation === "avg"
        )
        .map((measure) => measure.as);
  const numeric = new Set(numericFields);
  const dimensionFields = result
    ? result.schema
        .filter((field) => !numeric.has(field.key))
        .map((field) => field.key)
    : unique([...query.groupBy, ...query.select]).filter(
        (field) => !numeric.has(field),
      );
  const measure = numericFields[0];
  const dimension = dimensionFields[0];
  const schemaVersion = ANALYTICS_VISUALIZATION_VERSION;

  if (requestedType === "kpi" && measure && dimensionFields.length === 0) {
    return { measure, schemaVersion, type: "kpi" };
  }
  if (
    (requestedType === "bar" ||
      requestedType === "line" ||
      requestedType === "area") &&
    dimension &&
    numericFields.length > 0
  ) {
    return {
      schemaVersion,
      series: numericFields.map((field) => ({ field })),
      type: requestedType,
      x: dimension,
    };
  }
  if (requestedType === "pie" && dimension && measure) {
    return {
      dimension,
      measure,
      schemaVersion,
      showLegend: true,
      showTotal: true,
      type: "pie",
    };
  }
  return { schemaVersion, type: "table" };
}

function availableVisualizationTypes(
  result: DatasetResult | null,
): VisualizationSpec["type"][] {
  if (!result) return ["table"];
  const numeric = result.schema.filter((field) => field.scalarType === "number");
  const dimensions = result.schema.filter((field) => field.scalarType !== "number");
  return [
    "table",
    ...(numeric.length > 0 && dimensions.length === 0
      ? ["kpi" as const]
      : []),
    ...(numeric.length > 0 && dimensions.length > 0
      ? (["bar", "line", "area", "pie"] as const)
      : []),
  ];
}

function visualizationTypeLabel(
  type: VisualizationSpec["type"],
  tr: (value: string) => string,
) {
  const labels: Record<VisualizationSpec["type"], string> = {
    area: "面积图",
    bar: "柱状图",
    kpi: "指标卡",
    line: "折线图",
    pie: "饼图",
    table: "表格",
  };
  return tr(labels[type]);
}

function buildQuery(
  schema: DatasetSchema,
  draft: QueryDraft,
  tr: (value: string) => string,
): AnalysisQuery {
  const aggregateMode = draft.groupBy.length > 0 || draft.measures.length > 0;
  const select = aggregateMode ? unique(draft.groupBy) : unique(draft.selectedFields);
  const resolvedMeasures = resolveMeasures(draft.measures, schema, tr);
  const measures = resolvedMeasures.map(({ as, draft: measure }) =>
    toAnalysisMeasure(measure, as, schema, tr),
  );
  if (select.length === 0 && measures.length === 0) {
    throw new Error(tr("请至少选择一个明细字段或指标"));
  }
  const allowedSorts = new Set(
    buildSortOptions(schema, draft, resolvedMeasures, tr).map((option) => option.key),
  );
  const sort = uniqueBy(
    draft.sorts
      .filter((item) => allowedSorts.has(item.field))
      .map((item) => ({ direction: item.direction, field: item.field })),
    (item) => item.field,
  ) satisfies AnalysisSort[];

  return {
    filters: draft.filters.map((filter) => toAnalysisFilter(filter, schema, tr)),
    groupBy: unique(draft.groupBy),
    measures,
    page: { size: draft.pageSize },
    schemaVersion: ANALYTICS_QUERY_VERSION,
    select,
    sort,
    sourceKey: schema.sourceKey,
    sourceRevision: schema.sourceRevision,
  };
}

function resolveMeasures(
  measures: MeasureDraft[],
  schema: DatasetSchema | null,
  tr: (value: string) => string,
): ResolvedMeasure[] {
  if (!schema) return [];
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const seen = new Map<string, number>();
  return measures.map((draft) => {
    const field = fields.get(draft.field);
    const base = draft.aggregation === "count"
      ? "ticketCount"
      : `${draft.aggregation}${capitalize(draft.field || "Value")}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const as = count === 1 ? base : `${base}${count}`;
    const aggregationLabel = draft.aggregation === "count"
      ? tr("工单数")
      : draft.aggregation === "min"
        ? tr("最早")
        : tr("最晚");
    return {
      as,
      draft,
      label: field ? `${aggregationLabel} · ${tr(field.label)}` : aggregationLabel,
    };
  });
}

function buildSortOptions(
  schema: DatasetSchema,
  draft: QueryDraft,
  measures: ResolvedMeasure[],
  tr: (value: string) => string,
) {
  const fieldMap = new Map(schema.fields.map((field) => [field.key, field]));
  const aggregateMode = draft.groupBy.length > 0 || measures.length > 0;
  if (aggregateMode) {
    return [
      ...unique(draft.groupBy).map((key) => ({
        key,
        label: tr(fieldMap.get(key)?.label ?? key),
      })),
      ...measures.map((measure) => ({ key: measure.as, label: measure.label })),
    ];
  }
  return unique(draft.selectedFields)
    .map((key) => fieldMap.get(key))
    .filter((field): field is DatasetFieldDescriptor => Boolean(field?.capabilities.sortable))
    .map((field) => ({ key: field.key, label: tr(field.label) }));
}

function toAnalysisMeasure(
  measure: MeasureDraft,
  as: string,
  schema: DatasetSchema,
  tr: (value: string) => string,
): AnalysisMeasure {
  if (measure.aggregation === "count") {
    return { aggregation: "count", as };
  }
  const field = schema.fields.find((item) => item.key === measure.field);
  if (!field || !field.capabilities.aggregations.includes(measure.aggregation)) {
    throw new Error(tr("请选择支持该指标的时间字段"));
  }
  return { aggregation: measure.aggregation, as, field: field.key };
}

function toAnalysisFilter(
  filter: FilterDraft,
  schema: DatasetSchema,
  tr: (value: string) => string,
): AnalysisFilter {
  const field = schema.fields.find((item) => item.key === filter.field);
  if (!field || !field.capabilities.filterOperators.includes(filter.operator)) {
    throw new Error(tr("筛选字段或操作符无效"));
  }
  if (filter.operator === "isNull" || filter.operator === "isNotNull") {
    return { field: field.key, operator: filter.operator };
  }
  if (!filter.value.trim()) throw new Error(tr("请填写筛选值"));
  const scalar = normalizeFilterScalar(filter.value, field, tr);
  switch (filter.operator) {
    case "in":
    case "notIn":
      return {
        field: field.key,
        operator: filter.operator,
        value: filter.value
          .split(",")
          .map((item) => normalizeFilterScalar(item.trim(), field, tr)),
      };
    case "contains":
    case "startsWith":
      return { field: field.key, operator: filter.operator, value: String(scalar) };
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { field: field.key, operator: filter.operator, value: scalar };
  }
}

function normalizeFilterScalar(
  value: string,
  field: DatasetFieldDescriptor,
  tr: (value: string) => string,
) {
  if (field.scalarType === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(tr("请输入有效数字"));
    return number;
  }
  if (field.scalarType === "boolean") return value === "true";
  if (field.scalarType === "datetime") {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error(tr("请输入有效日期时间"));
    return date.toISOString();
  }
  return value;
}

function defaultFilter(id: string, field: DatasetFieldDescriptor): FilterDraft {
  const operator = supportedOperators(field)[0] ?? "eq";
  return {
    field: field.key,
    id,
    operator,
    value: defaultFilterValue(field),
  };
}

function defaultFilterValue(field: DatasetFieldDescriptor) {
  if (field.scalarType === "enum") return field.enumValues?.[0]?.value ?? "";
  return "";
}

function supportedOperators(field: DatasetFieldDescriptor): AnalysisFilterOperator[] {
  const preferred: AnalysisFilterOperator[] = field.scalarType === "datetime" || field.scalarType === "date"
    ? ["gte", "lte", "eq", "isNull", "isNotNull"]
    : field.scalarType === "enum"
      ? ["eq", "neq"]
      : ["eq", "neq"];
  return preferred.filter((operator) =>
    field.capabilities.filterOperators.includes(operator),
  );
}

function filterOperatorLabel(
  operator: AnalysisFilterOperator,
  tr: (value: string) => string,
) {
  const labels: Record<AnalysisFilterOperator, string> = {
    contains: "包含",
    eq: "等于",
    gt: "晚于",
    gte: "不早于",
    in: "属于",
    isNotNull: "有值",
    isNull: "无值",
    lt: "早于",
    lte: "不晚于",
    neq: "不等于",
    notIn: "不属于",
    startsWith: "开头为",
  };
  return tr(labels[operator]);
}

function capitalize(value: string) {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const selected = key(value);
    if (seen.has(selected)) return false;
    seen.add(selected);
    return true;
  });
}
