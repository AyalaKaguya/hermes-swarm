import {
  adminContracts,
  type AnalysisQuery,
  type AnalysisView,
  type CreateAnalysisViewRequest,
  type DatasetResult,
  type DatasetSchema,
  type DeleteAnalysisViewRequest,
  type UpdateAnalysisViewRequest,
} from "@hermes-swarm/api-contracts";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { fetchAdmin } from "./client";

export type {
  AnalysisFilter,
  AnalysisFilterOperator,
  AnalysisMeasure,
  AnalysisQuery,
  AnalysisSort,
  AnalysisView,
  CreateAnalysisViewRequest,
  DatasetFieldDescriptor,
  DatasetResult,
  DatasetResultField,
  DatasetSchema,
  DeleteAnalysisViewRequest,
  UpdateAnalysisViewRequest,
  VisualizationSpec,
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

export function listAnalysisViews(
  _session: AuthenticatedAdminSessionMarker,
): Promise<AnalysisView[]> {
  return fetchAdmin(adminContracts.analyticsViews);
}

export function getAnalysisView(
  _session: AuthenticatedAdminSessionMarker,
  viewId: string,
): Promise<AnalysisView> {
  return fetchAdmin(adminContracts.analyticsViewGet, {
    params: { viewId },
  });
}

export function createAnalysisView(
  _session: AuthenticatedAdminSessionMarker,
  payload: CreateAnalysisViewRequest,
): Promise<AnalysisView> {
  return fetchAdmin(adminContracts.analyticsViewCreate, { body: payload });
}

export function updateAnalysisView(
  _session: AuthenticatedAdminSessionMarker,
  viewId: string,
  payload: UpdateAnalysisViewRequest,
): Promise<AnalysisView> {
  return fetchAdmin(adminContracts.analyticsViewUpdate, {
    body: payload,
    params: { viewId },
  });
}

export async function deleteAnalysisView(
  _session: AuthenticatedAdminSessionMarker,
  viewId: string,
  payload: DeleteAnalysisViewRequest,
): Promise<void> {
  await fetchAdmin(adminContracts.analyticsViewDelete, {
    body: payload,
    params: { viewId },
  });
}
