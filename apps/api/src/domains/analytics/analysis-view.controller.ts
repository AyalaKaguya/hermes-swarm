import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../../infrastructure/feature-access/require-feature.decorator.js";
import {
  ANALYSIS_VIEW_CREATE_PERMISSION,
  ANALYSIS_VIEW_UPDATE_PERMISSION,
} from "./analysis-view.constants.js";
import { AnalysisViewService } from "./analysis-view.service.js";
import {
  AnalyticsAuthorizationContextFactory,
  type AnalyticsAuthorizedRequest,
} from "./analytics-authorization-context.factory.js";
import { SUPPORT_TICKETS_QUERY_PERMISSION } from "./support-tickets-analytics.constants.js";

@Controller("admin/analytics/views")
@RequireFeature("feature:analytics:enabled")
@AccessResource({
  entity: "analytics",
  entityLabel: "数据分析",
  entityOrder: 80,
  purpose: "saved_view",
  purposeLabel: "分析视图",
  purposeOrder: 20,
  scope: "workspace",
})
export class AnalysisViewController {
  constructor(
    private readonly authorizationFactory: AnalyticsAuthorizationContextFactory,
    private readonly views: AnalysisViewService,
  ) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "查看当前工作空间保存的分析视图。",
    label: "查看分析视图",
    operation: "list",
    sortOrder: 10,
  })
  list() {
    return this.views.list();
  }

  @Get(":viewId")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "查看当前工作空间内的指定分析视图。",
    label: "读取分析视图",
    operation: "read",
    sortOrder: 20,
  })
  get(@Param("viewId") viewId: string) {
    return this.views.get(viewId);
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "在当前工作空间保存分析查询与可视化。",
    label: "创建分析视图",
    operation: "create",
    sortOrder: 30,
  })
  async create(
    @Req() request: AnalyticsAuthorizedRequest,
    @Body() payload: unknown,
  ) {
    const authorization = await this.authorizationFactory.create(request, {
      operationPermission: ANALYSIS_VIEW_CREATE_PERMISSION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
    });
    return this.views.create(payload, authorization);
  }

  @Patch(":viewId")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "使用版本检查更新当前工作空间的分析视图。",
    label: "更新分析视图",
    operation: "update",
    sortOrder: 40,
  })
  async update(
    @Req() request: AnalyticsAuthorizedRequest,
    @Param("viewId") viewId: string,
    @Body() payload: unknown,
  ) {
    const authorization = await this.authorizationFactory.create(request, {
      operationPermission: ANALYSIS_VIEW_UPDATE_PERMISSION,
      requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
    });
    return this.views.update(viewId, payload, authorization);
  }

  @Delete(":viewId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "使用版本检查删除当前工作空间的分析视图。",
    isDangerous: true,
    label: "删除分析视图",
    operation: "delete",
    sortOrder: 50,
  })
  delete(@Param("viewId") viewId: string, @Body() payload: unknown) {
    return this.views.delete(viewId, payload);
  }
}
