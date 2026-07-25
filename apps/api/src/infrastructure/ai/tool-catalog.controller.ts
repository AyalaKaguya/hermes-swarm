import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  type BindWorkspaceToolGrantConnectionRequest,
  type CreatePlatformToolDefinitionRequest,
  type CreatePlatformToolNetworkPolicyRequest,
  type CreatePlatformToolVersionRequest,
  type CreateWorkspaceToolConnectionRequest,
  type CreateWorkspaceToolGrantRequest,
  type ToolConnectionSecretWriteRequest,
  type UpdatePlatformToolDefinitionRequest,
  type UpdatePlatformToolNetworkPolicyRequest,
  type UpdatePlatformToolVersionStatusRequest,
  type UpdateWorkspaceToolConnectionRequest,
  type UpdateWorkspaceToolGrantRequest,
} from "@hermes-swarm/api-contracts/ai";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { ToolCatalogService } from "./tool-catalog.service.js";
import { ToolGatewayExceptionFilter } from "./tool-gateway-exception.filter.js";

const PLATFORM_ADMIN = ["platform-admin"];
const WORKSPACE_ADMIN = ["workspace-owner", "workspace-admin"];

@Controller("admin/platform/ai/tools")
@UseFilters(ToolGatewayExceptionFilter)
@RequireFeature("feature:ai:enabled")
@AccessResource({
  entity: "tool_gateway",
  entityLabel: "工具网关",
  purpose: "ai_governance",
  purposeLabel: "AI 治理",
  scope: "platform",
})
export class PlatformToolCatalogController {
  constructor(private readonly catalog: ToolCatalogService) {}

  @Get()
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "查看工具目录",
    operation: "list_definitions",
  })
  listToolDefinitions() {
    return this.catalog.listPlatformToolDefinitions();
  }

  @Post()
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "创建工具定义",
    operation: "create_definition",
  })
  createToolDefinition(@Body() payload: CreatePlatformToolDefinitionRequest) {
    return this.catalog.createPlatformToolDefinition(payload);
  }

  @Patch(":toolDefinitionId")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "更新工具定义",
    operation: "update_definition",
  })
  updateToolDefinition(
    @Param("toolDefinitionId") toolDefinitionId: string,
    @Body() payload: UpdatePlatformToolDefinitionRequest,
  ) {
    return this.catalog.updatePlatformToolDefinition(toolDefinitionId, payload);
  }

  @Get(":toolDefinitionId/versions")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "查看工具版本",
    operation: "list_versions",
  })
  listToolVersions(@Param("toolDefinitionId") toolDefinitionId: string) {
    return this.catalog.listPlatformToolVersions(toolDefinitionId);
  }

  @Post(":toolDefinitionId/versions")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "创建工具版本",
    operation: "create_version",
  })
  createToolVersion(
    @Param("toolDefinitionId") toolDefinitionId: string,
    @Body() payload: CreatePlatformToolVersionRequest,
  ) {
    return this.catalog.createPlatformToolVersion(toolDefinitionId, payload);
  }

  @Patch(":toolDefinitionId/versions/:version")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "更新工具版本状态",
    operation: "update_version_status",
  })
  updateToolVersionStatus(
    @Param("toolDefinitionId") toolDefinitionId: string,
    @Param("version") version: string,
    @Body() payload: UpdatePlatformToolVersionStatusRequest,
  ) {
    return this.catalog.updatePlatformToolVersionStatus(
      toolDefinitionId,
      version,
      payload,
    );
  }

  @Get("network-policies")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "查看工具网络策略",
    operation: "list_network_policies",
  })
  listNetworkPolicies() {
    return this.catalog.listPlatformToolNetworkPolicies();
  }

  @Post("network-policies")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "创建工具网络策略",
    operation: "create_network_policy",
  })
  createNetworkPolicy(
    @Body() payload: CreatePlatformToolNetworkPolicyRequest,
  ) {
    return this.catalog.createPlatformToolNetworkPolicy(payload);
  }

  @Patch("network-policies/:networkPolicyId")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "更新工具网络策略",
    operation: "update_network_policy",
  })
  updateNetworkPolicy(
    @Param("networkPolicyId") networkPolicyId: string,
    @Body() payload: UpdatePlatformToolNetworkPolicyRequest,
  ) {
    return this.catalog.updatePlatformToolNetworkPolicy(networkPolicyId, payload);
  }
}

@Controller("admin/workspace/ai/tools")
@UseFilters(ToolGatewayExceptionFilter)
@RequireFeature("feature:ai:enabled")
@AccessResource({
  entity: "tool_configuration",
  entityLabel: "工具配置",
  purpose: "ai_configuration",
  purposeLabel: "AI 配置",
  scope: "workspace",
})
export class WorkspaceToolCatalogController {
  constructor(private readonly catalog: ToolCatalogService) {}

  @Get("connections")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "查看工具连接",
    operation: "list_connections",
  })
  listConnections() {
    return this.catalog.listWorkspaceToolConnections();
  }

  @Post("connections")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "创建工具连接",
    operation: "create_connection",
  })
  createConnection(@Body() payload: CreateWorkspaceToolConnectionRequest) {
    return this.catalog.createWorkspaceToolConnection(payload);
  }

  @Patch("connections/:connectionId")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "更新工具连接",
    operation: "update_connection",
  })
  updateConnection(
    @Param("connectionId") connectionId: string,
    @Body() payload: UpdateWorkspaceToolConnectionRequest,
  ) {
    return this.catalog.updateWorkspaceToolConnection(connectionId, payload);
  }

  @Post("connections/:connectionId/secret")
  @HttpCode(HttpStatus.OK)
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    isDangerous: true,
    label: "轮换工具连接凭据",
    operation: "rotate_connection_secret",
  })
  rotateConnectionSecret(
    @Param("connectionId") connectionId: string,
    @Body() payload: ToolConnectionSecretWriteRequest,
  ) {
    return this.catalog.rotateWorkspaceToolConnectionSecret(
      connectionId,
      payload,
    );
  }

  @Get("grants")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "查看工具授权",
    operation: "list_grants",
  })
  listGrants() {
    return this.catalog.listWorkspaceToolGrants();
  }

  @Post("grants")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "创建工具授权",
    operation: "create_grant",
  })
  createGrant(@Body() payload: CreateWorkspaceToolGrantRequest) {
    return this.catalog.createWorkspaceToolGrant(payload);
  }

  @Patch("grants/:grantId")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "更新工具授权",
    operation: "update_grant",
  })
  updateGrant(
    @Param("grantId") grantId: string,
    @Body() payload: UpdateWorkspaceToolGrantRequest,
  ) {
    return this.catalog.updateWorkspaceToolGrant(grantId, payload);
  }

  @Put("grants/:grantId/connection")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "绑定工具连接",
    operation: "bind_grant_connection",
  })
  bindGrantConnection(
    @Param("grantId") grantId: string,
    @Body() payload: BindWorkspaceToolGrantConnectionRequest,
  ) {
    return this.catalog.bindWorkspaceToolGrantConnection(grantId, payload);
  }
}
