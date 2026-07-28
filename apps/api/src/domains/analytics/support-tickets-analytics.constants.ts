import {
  SUPPORT_TICKETS_QUERY_DATASET_SCHEMA,
  SUPPORT_TICKETS_QUERY_POLICY_REVISION,
  SUPPORT_TICKETS_QUERY_SOURCE_KEY,
  SUPPORT_TICKETS_QUERY_SOURCE_REVISION,
} from "@hermes-swarm/core/analytics";
import { getOperationPermissionId } from "@hermes-swarm/rbac-api";

export const SUPPORT_TICKETS_SOURCE_KEY = SUPPORT_TICKETS_QUERY_SOURCE_KEY;
export const SUPPORT_TICKETS_SOURCE_REVISION =
  SUPPORT_TICKETS_QUERY_SOURCE_REVISION;
export const SUPPORT_TICKETS_POLICY_REVISION =
  SUPPORT_TICKETS_QUERY_POLICY_REVISION;
export const SUPPORT_TICKETS_DATASET_SCHEMA =
  SUPPORT_TICKETS_QUERY_DATASET_SCHEMA;

export const SUPPORT_TICKETS_DESCRIBE_PERMISSION = getOperationPermissionId(
  "analytics",
  "ticket_dataset",
  "describe",
  "workspace",
);

export const SUPPORT_TICKETS_QUERY_PERMISSION = getOperationPermissionId(
  "analytics",
  "ticket_dataset",
  "query",
  "workspace",
);
