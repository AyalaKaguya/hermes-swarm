import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type {
  CreateAgentRequest,
  PublishAgentDraftRequest,
  ReplaceAgentDraftRequest,
  UpdateAgentRequest,
} from "@hermes-swarm/api-contracts/ai";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { AgentCatalogService } from "./agent-catalog.service.js";

const WORKSPACE_ADMIN = ["workspace-owner", "workspace-admin"];

@Controller("admin/agents")
@RequireFeature("feature:ai:enabled")
@AccessResource({
  entity: "agent",
  entityLabel: "智能助手",
  entityOrder: 70,
  purpose: "ai_configuration",
  purposeLabel: "AI 配置",
  purposeOrder: 30,
  scope: "workspace",
})
export class AgentCatalogController {
  constructor(private readonly catalog: AgentCatalogService) {}

  @Get()
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "查看当前工作空间的智能助手目录。",
    label: "查看智能助手",
    operation: "list",
    sortOrder: 10,
  })
  listAgents() {
    return this.catalog.listAgents();
  }

  @Post()
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "在当前工作空间创建智能助手及初始草稿。",
    label: "创建智能助手",
    operation: "create",
    sortOrder: 20,
  })
  createAgent(@Body() payload: CreateAgentRequest) {
    return this.catalog.createAgent(payload);
  }

  @Get(":agentId")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "读取当前工作空间的智能助手详情。",
    label: "查看智能助手详情",
    operation: "read",
    sortOrder: 30,
  })
  getAgent(@Param("agentId") agentId: string) {
    return this.catalog.getAgent(agentId);
  }

  @Patch(":agentId")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "更新当前工作空间智能助手的名称、说明与状态。",
    label: "更新智能助手",
    operation: "update",
    sortOrder: 40,
  })
  updateAgent(
    @Param("agentId") agentId: string,
    @Body() payload: UpdateAgentRequest,
  ) {
    return this.catalog.updateAgent(agentId, payload);
  }

  @Get(":agentId/draft")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "读取当前工作空间智能助手的可编辑草稿。",
    label: "查看智能助手草稿",
    operation: "read_draft",
    sortOrder: 50,
  })
  getDraft(@Param("agentId") agentId: string) {
    return this.catalog.getDraft(agentId);
  }

  @Put(":agentId/draft")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "使用修订检查替换当前工作空间的智能助手草稿。",
    label: "保存智能助手草稿",
    operation: "update_draft",
    sortOrder: 60,
  })
  replaceDraft(
    @Param("agentId") agentId: string,
    @Body() payload: ReplaceAgentDraftRequest,
  ) {
    return this.catalog.replaceDraft(agentId, payload);
  }

  @Get(":agentId/versions")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "查看当前工作空间智能助手的已发布版本。",
    label: "查看智能助手版本",
    operation: "list_versions",
    sortOrder: 70,
  })
  listVersions(@Param("agentId") agentId: string) {
    return this.catalog.listVersions(agentId);
  }

  @Post(":agentId/versions")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "从经过验证的草稿发布不可变智能助手版本。",
    isDangerous: true,
    label: "发布智能助手版本",
    operation: "publish",
    sortOrder: 80,
  })
  publishDraft(
    @Param("agentId") agentId: string,
    @Body() payload: PublishAgentDraftRequest,
  ) {
    return this.catalog.publishDraft(agentId, payload);
  }

  @Get(":agentId/versions/:version")
  @AccessOperation({
    defaultRoles: WORKSPACE_ADMIN,
    description: "读取当前工作空间的指定智能助手版本。",
    label: "查看智能助手版本详情",
    operation: "read_version",
    sortOrder: 90,
  })
  getVersion(
    @Param("agentId") agentId: string,
    @Param("version") version: string,
  ) {
    return this.catalog.getVersion(agentId, version);
  }
}
