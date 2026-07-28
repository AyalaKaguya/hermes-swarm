import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type {
  AnalysisQuery,
  DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import { ANALYTICS_QUERY_TIMEOUT_MS } from "@hermes-swarm/api-contracts/analytics";
import {
  SUPPORT_TICKETS_QUERY_DATASET_SCHEMA,
  SupportTicketsQueryError,
  executeSupportTicketsQuery,
} from "@hermes-swarm/core/analytics";
import { Ticket } from "@hermes-swarm/core";
import { DataSource } from "typeorm";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import type {
  AnalyticsAdapterResult,
  AnalyticsExecutionContext,
  AnalyticsSourceAdapter,
} from "./analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";
import {
  SUPPORT_TICKETS_POLICY_REVISION,
  SUPPORT_TICKETS_QUERY_PERMISSION,
  SUPPORT_TICKETS_SOURCE_KEY,
} from "./support-tickets-analytics.constants.js";

@Injectable()
export class SupportTicketsAnalyticsAdapter
  implements AnalyticsSourceAdapter, OnModuleInit, OnModuleDestroy
{
  readonly kind = "typeorm-support-tickets";
  private unregister: (() => void) | null = null;

  constructor(
    private readonly sourceRegistry: AnalyticsSourceRegistry,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    this.unregister = this.sourceRegistry.register({
      adapter: this,
      policyRevision: SUPPORT_TICKETS_POLICY_REVISION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
      sourceKey: SUPPORT_TICKETS_SOURCE_KEY,
    });
  }

  onModuleDestroy() {
    this.unregister?.();
    this.unregister = null;
  }

  async describe(
    _context: AnalyticsExecutionContext,
    sourceKey: string,
    signal: AbortSignal,
  ): Promise<DatasetSchema> {
    throwIfAborted(signal);
    if (sourceKey !== SUPPORT_TICKETS_SOURCE_KEY) {
      throw new AnalyticsQueryError(
        "ANALYTICS_SOURCE_NOT_FOUND",
        "Analytics source was not found.",
      );
    }
    return SUPPORT_TICKETS_QUERY_DATASET_SCHEMA;
  }

  async execute(
    context: AnalyticsExecutionContext,
    query: AnalysisQuery,
    signal: AbortSignal,
  ): Promise<AnalyticsAdapterResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `SET LOCAL statement_timeout = '${ANALYTICS_QUERY_TIMEOUT_MS}ms'`,
        );
        return executeSupportTicketsQuery({
          createQueryBuilder: () =>
            manager.getRepository(Ticket).createQueryBuilder("ticket"),
          query,
          signal,
          workspaceId: context.workspaceId,
        });
      });
    } catch (error) {
      if (error instanceof SupportTicketsQueryError) {
        throw new AnalyticsQueryError(error.code, error.message);
      }
      if (isPostgresStatementTimeout(error)) {
        throw new AnalyticsQueryError(
          "ANALYTICS_QUERY_TIMEOUT",
          "Analytics query exceeded its execution deadline.",
        );
      }
      throw error;
    }
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}

function isPostgresStatementTimeout(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "57014"
  );
}
