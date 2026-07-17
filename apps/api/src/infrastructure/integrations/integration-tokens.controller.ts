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
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import type { CreateIntegrationTokenPayload } from "../../common/admin-api.types.js";
import { IntegrationTokensService } from "./integration-tokens.service.js";

@Controller("admin/account/integration-tokens")
@AccessResource({
  entity: "integration_token",
  entityLabel: "个人 API Token",
  entityOrder: 20,
  purpose: "personal_api_token",
  purposeLabel: "个人 API Token",
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
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    description: "查看当前账号可授权给个人 API Token 的权限。",
    label: "查看可授权权限",
    operation: "capabilities",
    sortOrder: 10,
  })
  capabilities(@Headers("authorization") authorization: string | undefined) {
    return this.integrationTokensService.capabilities(authorization);
  }

  @Get()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    description: "查看当前账号创建的个人 API Token。",
    label: "查看个人 API Token",
    operation: "list",
    sortOrder: 20,
  })
  list(@Headers("authorization") authorization: string | undefined) {
    return this.integrationTokensService.list(authorization);
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    description: "创建一个最长 1 年有效的个人 API Token。",
    label: "创建个人 API Token",
    operation: "create",
    sortOrder: 30,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateIntegrationTokenPayload,
  ) {
    return this.integrationTokensService.create(authorization, payload);
  }

  @Delete(":tokenId")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    description: "撤销当前账号创建的个人 API Token。",
    isDangerous: true,
    label: "撤销个人 API Token",
    operation: "revoke",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Headers("authorization") authorization: string | undefined,
    @Param("tokenId") tokenId: string,
  ) {
    await this.integrationTokensService.revoke(authorization, tokenId);
  }
}
