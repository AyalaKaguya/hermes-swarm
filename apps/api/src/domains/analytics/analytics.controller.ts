import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { getOperationPermissionId } from "@hermes-swarm/rbac-api";
import { RequireFeature } from "../../infrastructure/feature-access/require-feature.decorator.js";
import { AnalysisQueryRunService } from "./analysis-query-run.service.js";
import {
  AnalyticsAuthorizationContextFactory,
  type AnalyticsAuthorizedRequest,
} from "./analytics-authorization-context.factory.js";
import { AnalyticsQueryGateway } from "./analytics-query.gateway.js";
import {
  SUPPORT_TICKETS_DESCRIBE_PERMISSION,
  SUPPORT_TICKETS_QUERY_PERMISSION,
  SUPPORT_TICKETS_SOURCE_KEY,
} from "./support-tickets-analytics.constants.js";

const SUPPORT_TICKETS_QUERY_RUN_SUBMIT_PERMISSION = getOperationPermissionId(
  "analytics",
  "ticket_dataset",
  "query_run_submit",
  "workspace",
);

@Controller("admin/analytics")
@RequireFeature("feature:analytics:enabled")
@AccessResource({
  entity: "analytics",
  entityLabel: "数据分析",
  entityOrder: 80,
  purpose: "ticket_dataset",
  purposeLabel: "工单数据集",
  purposeOrder: 10,
  scope: "workspace",
})
export class AnalyticsController {
  constructor(
    private readonly gateway: AnalyticsQueryGateway,
    private readonly authorizationFactory: AnalyticsAuthorizationContextFactory,
    private readonly queryRuns: AnalysisQueryRunService,
  ) {}

  @Get("sources/support.tickets/schema")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "查看当前工作空间可分析的工单状态与时间字段。",
    label: "查看工单数据集",
    operation: "describe",
    sortOrder: 10,
  })
  async describe(@Req() request: AnalyticsAuthorizedRequest) {
    const authorization = await this.authorizationFactory.create(request, {
      operationPermission: SUPPORT_TICKETS_DESCRIBE_PERMISSION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
    });
    return this.gateway.describe(SUPPORT_TICKETS_SOURCE_KEY, authorization);
  }

  @Post("query")
  @HttpCode(HttpStatus.OK)
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "在当前工作空间内执行受限的工单统计查询。",
    label: "查询工单数据",
    operation: "query",
    sortOrder: 20,
  })
  async query(
    @Req() request: AnalyticsAuthorizedRequest,
    @Body() payload: unknown,
  ) {
    const authorization = await this.authorizationFactory.create(request, {
      operationPermission: SUPPORT_TICKETS_QUERY_PERMISSION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
    });
    return this.gateway.execute(payload, authorization);
  }

  @Post("query-runs")
  @HttpCode(HttpStatus.ACCEPTED)
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "提交当前工作空间的异步工单分析查询。",
    label: "提交异步分析",
    operation: "query_run_submit",
    sortOrder: 30,
  })
  async submitQueryRun(
    @Req() request: AnalyticsAuthorizedRequest,
    @Body() payload: unknown,
  ) {
    const authorization = await this.authorizationFactory.create(request, {
      operationPermission: SUPPORT_TICKETS_QUERY_RUN_SUBMIT_PERMISSION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
    });
    return this.queryRuns.submit(payload, authorization);
  }

  @Get("query-runs/:runId")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "读取当前工作空间的异步分析状态。",
    label: "查看异步分析",
    operation: "query_run_read",
    sortOrder: 40,
  })
  getQueryRun(@Param("runId") runId: string) {
    return this.queryRuns.get(runId);
  }

  @Post("query-runs/:runId/cancel")
  @HttpCode(HttpStatus.OK)
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "取消当前工作空间尚未完成的异步分析。",
    isDangerous: true,
    label: "取消异步分析",
    operation: "query_run_cancel",
    sortOrder: 50,
  })
  cancelQueryRun(@Param("runId") runId: string) {
    return this.queryRuns.cancel(runId);
  }

  @Get("query-runs/:runId/result")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "读取当前工作空间已完成的异步分析结果。",
    label: "读取异步分析结果",
    operation: "query_run_result",
    sortOrder: 60,
  })
  getQueryRunResult(@Param("runId") runId: string) {
    return this.queryRuns.getResult(runId);
  }

  @Get("artifacts/:artifactId/content")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "鉴权后下载当前工作空间的分析制品。",
    label: "下载分析制品",
    operation: "artifact_download",
    sortOrder: 70,
  })
  async downloadArtifact(
    @Param("artifactId") artifactId: string,
    @Res() response: { redirect(status: number, url: string): void },
  ) {
    response.redirect(
      HttpStatus.FOUND,
      await this.queryRuns.getArtifactContentUrl(artifactId),
    );
  }
}
