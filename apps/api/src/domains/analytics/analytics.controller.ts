import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../../infrastructure/feature-access/require-feature.decorator.js";
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
}
