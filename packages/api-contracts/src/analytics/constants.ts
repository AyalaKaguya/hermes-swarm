import { z } from "zod";

export const ANALYTICS_DATASET_VERSION = "hermes.analytics.dataset/v1" as const;
export const ANALYTICS_QUERY_VERSION = "hermes.analytics.query/v1" as const;
export const ANALYTICS_RESULT_VERSION = "hermes.analytics.result/v1" as const;
export const ANALYTICS_VISUALIZATION_VERSION = "hermes.analytics.visualization/v1" as const;

export const AnalyticsDatasetVersionSchema = z.literal(ANALYTICS_DATASET_VERSION);
export const AnalyticsQueryVersionSchema = z.literal(ANALYTICS_QUERY_VERSION);
export const AnalyticsResultVersionSchema = z.literal(ANALYTICS_RESULT_VERSION);
export const AnalyticsVisualizationVersionSchema = z.literal(
  ANALYTICS_VISUALIZATION_VERSION,
);

export const ANALYTICS_QUERY_TIMEOUT_MS = 10_000;
export const ANALYTICS_QUERY_DEFAULT_PAGE_SIZE = 50;
export const ANALYTICS_QUERY_MAX_PAGE_SIZE = 500;
export const ANALYTICS_QUERY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const ANALYTICS_QUERY_MAX_GROUPS = 3;
export const ANALYTICS_QUERY_MAX_MEASURES = 8;
export const ANALYTICS_QUERY_MAX_SORTS = 3;
export const ANALYTICS_QUERY_MAX_FILTERS = 30;
export const ANALYTICS_QUERY_MAX_IN_VALUES = 100;

/**
 * Public query limits shared by the gateway, adapters, and clients.
 *
 * These are hard security and resource ceilings rather than UI defaults that
 * callers may override.
 */
export const ANALYTICS_QUERY_BUDGET = Object.freeze({
  defaultPageSize: ANALYTICS_QUERY_DEFAULT_PAGE_SIZE,
  maxFilters: ANALYTICS_QUERY_MAX_FILTERS,
  maxGroupByFields: ANALYTICS_QUERY_MAX_GROUPS,
  maxInValues: ANALYTICS_QUERY_MAX_IN_VALUES,
  maxMeasures: ANALYTICS_QUERY_MAX_MEASURES,
  maxPageSize: ANALYTICS_QUERY_MAX_PAGE_SIZE,
  maxResponseBytes: ANALYTICS_QUERY_MAX_RESPONSE_BYTES,
  maxSortFields: ANALYTICS_QUERY_MAX_SORTS,
  timeoutMs: ANALYTICS_QUERY_TIMEOUT_MS,
});
