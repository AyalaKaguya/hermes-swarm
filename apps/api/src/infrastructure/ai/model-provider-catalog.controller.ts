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
} from "@nestjs/common";
import {
  type CreatePlatformModelDeploymentRequest,
  type CreatePlatformModelProviderRequest,
  type CreateWorkspaceModelDeploymentRequest,
  type CreateWorkspaceModelGrantRequest,
  type CreateWorkspaceModelProviderRequest,
  type ProviderSecretWriteRequest,
  type SetWorkspaceDefaultModelRequest,
  type UpdatePlatformModelDeploymentRequest,
  type UpdatePlatformModelProviderRequest,
  type UpdateWorkspaceModelDeploymentRequest,
  type UpdateWorkspaceModelGrantRequest,
  type UpdateWorkspaceModelProviderRequest,
} from "@hermes-swarm/api-contracts/ai";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { ModelProviderCatalogService } from "./model-provider-catalog.service.js";

const PLATFORM_ADMIN = ["platform-admin"];
const WORKSPACE_ADMIN = ["workspace-owner", "workspace-admin"];

@Controller("admin/platform/ai")
@RequireFeature("feature:ai:enabled")
@AccessResource({
  entity: "model_provider",
  entityLabel: "模型服务",
  purpose: "ai_governance",
  purposeLabel: "AI 治理",
  scope: "platform",
})
export class PlatformModelProviderCatalogController {
  constructor(private readonly catalog: ModelProviderCatalogService) {}

  @Get("providers")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "查看平台模型服务",
    operation: "list",
  })
  listProviders() {
    return this.catalog.listPlatformProviders();
  }

  @Post("providers")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "创建平台模型服务",
    operation: "create",
  })
  createProvider(@Body() payload: CreatePlatformModelProviderRequest) {
    return this.catalog.createPlatformProvider(payload);
  }

  @Patch("providers/:providerId")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "更新平台模型服务",
    operation: "update",
  })
  updateProvider(
    @Param("providerId") providerId: string,
    @Body() payload: UpdatePlatformModelProviderRequest,
  ) {
    return this.catalog.updatePlatformProvider(providerId, payload);
  }

  @Post("providers/:providerId/secret")
  @HttpCode(HttpStatus.OK)
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    isDangerous: true,
    label: "轮换平台模型凭据",
    operation: "rotate_secret",
  })
  rotateProviderSecret(
    @Param("providerId") providerId: string,
    @Body() payload: ProviderSecretWriteRequest,
  ) {
    return this.catalog.rotatePlatformProviderSecret(providerId, payload);
  }

  @Get("providers/:providerId/deployments")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "查看平台模型部署",
    operation: "list_deployments",
  })
  listDeployments(@Param("providerId") providerId: string) {
    return this.catalog.listPlatformDeployments(providerId);
  }

  @Post("providers/:providerId/deployments")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "创建平台模型部署",
    operation: "create_deployment",
  })
  createDeployment(
    @Param("providerId") providerId: string,
    @Body() payload: CreatePlatformModelDeploymentRequest,
  ) {
    return this.catalog.createPlatformDeployment(providerId, payload);
  }

  @Patch("deployments/:deploymentId")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "更新平台模型部署",
    operation: "update_deployment",
  })
  updateDeployment(
    @Param("deploymentId") deploymentId: string,
    @Body() payload: UpdatePlatformModelDeploymentRequest,
  ) {
    return this.catalog.updatePlatformDeployment(deploymentId, payload);
  }

  @Get("workspaces/:workspaceId/grants")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "查看工作空间模型授权",
    operation: "list_grants",
  })
  listGrants(@Param("workspaceId") workspaceId: string) {
    return this.catalog.listWorkspaceGrants(workspaceId);
  }

  @Post("workspaces/:workspaceId/grants")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "授予工作空间模型",
    operation: "create_grant",
  })
  createGrant(
    @Param("workspaceId") workspaceId: string,
    @Body() payload: CreateWorkspaceModelGrantRequest,
  ) {
    return this.catalog.createWorkspaceGrant(workspaceId, payload);
  }

  @Patch("workspaces/:workspaceId/grants/:grantId")
  @AccessOperation({
    defaultRoles: PLATFORM_ADMIN,
    label: "更新工作空间模型授权",
    operation: "update_grant",
  })
  updateGrant(
    @Param("workspaceId") workspaceId: string,
    @Param("grantId") grantId: string,
    @Body() payload: UpdateWorkspaceModelGrantRequest,
  ) {
    return this.catalog.updateWorkspaceGrant(workspaceId, grantId, payload);
  }
}

@Controller("admin/workspace/ai")
@RequireFeature("feature:ai:enabled")
@AccessResource({
  entity: "model_provider",
  entityLabel: "模型服务",
  purpose: "ai_configuration",
  purposeLabel: "AI 配置",
  scope: "workspace",
})
export class WorkspaceModelProviderCatalogController {
  constructor(private readonly catalog: ModelProviderCatalogService) {}

  @Get("providers")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "查看工作空间模型服务",
    operation: "list",
  })
  listProviders() {
    return this.catalog.listWorkspaceProviders();
  }

  @Post("providers")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "创建工作空间模型服务",
    operation: "create",
  })
  createProvider(@Body() payload: CreateWorkspaceModelProviderRequest) {
    return this.catalog.createWorkspaceProvider(payload);
  }

  @Patch("providers/:providerId")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "更新工作空间模型服务",
    operation: "update",
  })
  updateProvider(
    @Param("providerId") providerId: string,
    @Body() payload: UpdateWorkspaceModelProviderRequest,
  ) {
    return this.catalog.updateWorkspaceProvider(providerId, payload);
  }

  @Post("providers/:providerId/secret")
  @HttpCode(HttpStatus.OK)
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    isDangerous: true,
    label: "轮换工作空间模型凭据",
    operation: "rotate_secret",
  })
  rotateProviderSecret(
    @Param("providerId") providerId: string,
    @Body() payload: ProviderSecretWriteRequest,
  ) {
    return this.catalog.rotateWorkspaceProviderSecret(providerId, payload);
  }

  @Get("providers/:providerId/deployments")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "查看工作空间模型部署",
    operation: "list_deployments",
  })
  listDeployments(@Param("providerId") providerId: string) {
    return this.catalog.listWorkspaceDeployments(providerId);
  }

  @Post("providers/:providerId/deployments")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "创建工作空间模型部署",
    operation: "create_deployment",
  })
  createDeployment(
    @Param("providerId") providerId: string,
    @Body() payload: CreateWorkspaceModelDeploymentRequest,
  ) {
    return this.catalog.createWorkspaceDeployment(providerId, payload);
  }

  @Patch("deployments/:deploymentId")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "更新工作空间模型部署",
    operation: "update_deployment",
  })
  updateDeployment(
    @Param("deploymentId") deploymentId: string,
    @Body() payload: UpdateWorkspaceModelDeploymentRequest,
  ) {
    return this.catalog.updateWorkspaceDeployment(deploymentId, payload);
  }

  @Get("grants")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "查看可用平台模型授权",
    operation: "list_grants",
  })
  listGrants() {
    return this.catalog.listCurrentWorkspaceGrants();
  }

  @Get("defaults")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "查看默认模型",
    operation: "list_defaults",
  })
  listDefaults() {
    return this.catalog.listWorkspaceDefaults();
  }

  @Put("defaults")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    label: "设置默认模型",
    operation: "set_default",
  })
  setDefault(@Body() payload: SetWorkspaceDefaultModelRequest) {
    return this.catalog.setWorkspaceDefault(payload);
  }
}
