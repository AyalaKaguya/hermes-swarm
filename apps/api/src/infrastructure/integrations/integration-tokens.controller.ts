import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import type { CreateIntegrationTokenPayload } from "../../common/admin-api.types.js";
import { IntegrationTokensService } from "./integration-tokens.service.js";

@Controller("admin/users/:userId/integration-tokens")
@AccessResource({
  entity: "integration_token",
  entityLabel: "集成 Token",
  entityOrder: 20,
  purpose: "personal_integration",
  purposeLabel: "个人集成",
  purposeOrder: 10,
  scope: "own",
})
export class IntegrationTokensController {
  constructor(
    @Inject(IntegrationTokensService)
    private readonly integrationTokensService: IntegrationTokensService,
  ) {}

  @Get("capabilities")
  @AccessOperation({
    description: "查看当前账号可授权给集成 Token 的作用范围和权限。",
    label: "查看集成能力",
    operation: "capabilities",
    sortOrder: 10,
  })
  capabilities(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
  ) {
    return this.integrationTokensService.capabilities(authorization, userId);
  }

  @Get()
  @AccessOperation({
    description: "查看当前账号创建的集成 Token。",
    label: "查看集成 Token",
    operation: "list",
    sortOrder: 20,
  })
  list(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
  ) {
    return this.integrationTokensService.list(authorization, userId);
  }

  @Post()
  @AccessOperation({
    description: "创建一个最长 1 年有效的个人集成 Token。",
    label: "创建集成 Token",
    operation: "create",
    sortOrder: 30,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() payload: CreateIntegrationTokenPayload,
  ) {
    return this.integrationTokensService.create(authorization, userId, payload);
  }

  @Delete(":tokenId")
  @AccessOperation({
    description: "撤销当前账号创建的集成 Token。",
    isDangerous: true,
    label: "撤销集成 Token",
    operation: "revoke",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Param("tokenId") tokenId: string,
  ) {
    await this.integrationTokensService.revoke(authorization, userId, tokenId);
  }
}
