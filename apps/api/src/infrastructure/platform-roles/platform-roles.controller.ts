import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type { ReplaceRolePermissionsPayload } from "../../common/admin-api.types.js";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { PlatformRolesService } from "./platform-roles.service.js";

@Controller("admin/platform/roles")
@AccessResource({
  entity: "role",
  entityLabel: "角色",
  entityOrder: 30,
  purpose: "platform_role",
  purposeLabel: "平台角色",
  purposeOrder: 20,
  scope: "platform",
})
export class PlatformRolesController {
  constructor(private readonly service: PlatformRolesService) {}

  @Get()
  @AccessOperation({
    description: "查看平台角色列表。",
    label: "查看平台角色",
    operation: "list",
    sortOrder: 10,
  })
  list() {
    return this.service.list();
  }

  @Post()
  @AccessOperation({
    description: "创建平台自定义角色。",
    label: "创建平台角色",
    operation: "create",
    sortOrder: 20,
  })
  create(@Body() payload: PlatformRolePayload) {
    return this.service.create(payload);
  }

  @Patch(":roleId")
  @AccessOperation({
    description: "更新平台角色的名称、颜色和描述。",
    label: "更新平台角色",
    operation: "update_basic",
    sortOrder: 30,
  })
  update(
    @Param("roleId") roleId: string,
    @Body() payload: Partial<PlatformRolePayload>,
  ) {
    return this.service.update(roleId, payload);
  }

  @Put(":roleId/permissions")
  @AccessOperation({
    description: "替换平台角色拥有的权限。",
    isDangerous: true,
    label: "配置平台角色权限",
    operation: "replace_permissions",
    sortOrder: 40,
  })
  replacePermissions(
    @Param("roleId") roleId: string,
    @Body() payload: ReplaceRolePermissionsPayload,
  ) {
    return this.service.replacePermissions(roleId, payload);
  }

  @Delete(":roleId")
  @AccessOperation({
    description: "删除平台自定义角色。",
    isDangerous: true,
    label: "删除平台角色",
    operation: "delete",
    sortOrder: 90,
  })
  remove(@Param("roleId") roleId: string) {
    return this.service.remove(roleId);
  }
}

export type PlatformRolePayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};
