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
import type { ReplaceRolePermissionsPayload } from "../tenancy/tenancy.types.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PlatformRolesService } from "./platform-roles.service.js";

@Controller("admin/platform/roles")
export class PlatformRolesController {
  constructor(private readonly service: PlatformRolesService) {}

  @Get()
  @RequirePermission({ action: "read", entity: "role", scope: "platform" })
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission({ action: "create", entity: "role", scope: "platform" })
  create(@Body() payload: PlatformRolePayload) {
    return this.service.create(payload);
  }

  @Patch(":roleId")
  @RequirePermission({ action: "update", entity: "role", scope: "platform" })
  update(
    @Param("roleId") roleId: string,
    @Body() payload: Partial<PlatformRolePayload>,
  ) {
    return this.service.update(roleId, payload);
  }

  @Put(":roleId/permissions")
  @RequirePermission({ action: "update", entity: "role", scope: "platform" })
  replacePermissions(
    @Param("roleId") roleId: string,
    @Body() payload: ReplaceRolePermissionsPayload,
  ) {
    return this.service.replacePermissions(roleId, payload);
  }

  @Delete(":roleId")
  @RequirePermission({ action: "delete", entity: "role", scope: "platform" })
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
