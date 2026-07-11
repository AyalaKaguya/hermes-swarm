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
  purpose: "tenant_integration",
  purposeLabel: "租户集成",
  purposeOrder: 10,
  scope: "tenant",
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
    description: "创建一个最长 1 年有效的租户、组织或部门集成 Token。",
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

@Controller("admin/organizations/:organizationId/integration-tokens")
@AccessResource({
  entity: "integration_token",
  entityLabel: "集成 Token",
  entityOrder: 20,
  purpose: "organization_integration",
  purposeLabel: "组织集成",
  purposeOrder: 20,
  scope: "organization",
})
export class OrganizationIntegrationTokensController {
  constructor(
    @Inject(IntegrationTokensService)
    private readonly integrationTokensService: IntegrationTokensService,
  ) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    description: "查看当前组织内所有用户创建的组织集成 Token。",
    label: "查看组织集成 Token",
    operation: "list",
    sortOrder: 10,
  })
  list(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
  ) {
    return this.integrationTokensService.listOrganization(
      authorization,
      organizationId,
    );
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    description: "允许当前用户创建当前组织作用域的集成 Token。",
    label: "创建组织集成 Token",
    operation: "create",
    sortOrder: 20,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body()
    payload: Omit<
      CreateIntegrationTokenPayload,
      "departmentId" | "organizationId" | "scope"
    >,
  ) {
    return this.integrationTokensService.createForCurrentUserInOrganization(
      authorization,
      organizationId,
      payload,
    );
  }

  @Delete(":tokenId")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    description: "撤销当前组织内用户创建的组织集成 Token。",
    isDangerous: true,
    label: "撤销组织集成 Token",
    operation: "revoke",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("tokenId") tokenId: string,
  ) {
    await this.integrationTokensService.revokeOrganization(
      authorization,
      organizationId,
      tokenId,
    );
  }
}

@Controller(
  "admin/organizations/:organizationId/departments/:departmentId/integration-tokens",
)
@AccessResource({
  entity: "integration_token",
  entityLabel: "集成 Token",
  entityOrder: 20,
  purpose: "department_integration",
  purposeLabel: "部门集成",
  purposeOrder: 30,
  scope: "department",
})
export class DepartmentIntegrationTokensController {
  constructor(
    @Inject(IntegrationTokensService)
    private readonly integrationTokensService: IntegrationTokensService,
  ) {}

  @Post()
  @AccessOperation({
    defaultRoles: ["owner", "admin", "department-manager"],
    description: "允许当前用户创建当前部门作用域的集成 Token。",
    label: "创建部门集成 Token",
    operation: "create",
    sortOrder: 20,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Body()
    payload: Omit<
      CreateIntegrationTokenPayload,
      "departmentId" | "organizationId" | "scope"
    >,
  ) {
    return this.integrationTokensService.createForCurrentUserInDepartment(
      authorization,
      organizationId,
      departmentId,
      payload,
    );
  }

  @Get()
  @AccessOperation({
    defaultRoles: ["owner", "admin", "department-manager"],
    description: "查看当前部门内所有用户创建的部门集成 Token。",
    label: "查看部门集成 Token",
    operation: "list",
    sortOrder: 10,
  })
  list(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
  ) {
    return this.integrationTokensService.listDepartment(
      authorization,
      organizationId,
      departmentId,
    );
  }

  @Delete(":tokenId")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "department-manager"],
    description: "撤销当前部门内用户创建的部门集成 Token。",
    isDangerous: true,
    label: "撤销平台集成 Token",
    operation: "revoke",
    sortOrder: 90,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Param("tokenId") tokenId: string,
  ) {
    await this.integrationTokensService.revokeDepartment(
      authorization,
      organizationId,
      departmentId,
      tokenId,
    );
  }
}
