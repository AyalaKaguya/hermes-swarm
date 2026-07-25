import {
  adminContracts,
  type AnalysisQuery,
  type DatasetResult,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { fetchAdmin } from "./client";

export type {
  AnalysisFilter,
  AnalysisFilterOperator,
  AnalysisMeasure,
  AnalysisQuery,
  AnalysisSort,
  DatasetFieldDescriptor,
  DatasetResult,
  DatasetResultField,
  DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";

export function getSupportTicketsAnalyticsSchema(
  _session: AuthenticatedAdminSessionMarker,
): Promise<DatasetSchema> {
  return fetchAdmin(adminContracts.analyticsSupportTicketsSchema);
}

export function runAnalyticsQuery(
  _session: AuthenticatedAdminSessionMarker,
  query: AnalysisQuery,
): Promise<DatasetResult> {
  return fetchAdmin(adminContracts.analyticsQuery, { body: query });
}
