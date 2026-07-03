import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  PermissionOperation,
  PermissionResource,
} from "@hermes-swarm/rbac";
import { PlatformMembersService } from "./platform-members.service.js";

@Controller("admin/platform/members")
@PermissionResource({
  entity: "user",
  entityLabel: "用户",
  entityOrder: 10,
  purpose: "platform_member",
  purposeLabel: "平台访问人员",
  purposeOrder: 20,
  scope: "platform",
})
export class PlatformMembersController {
  constructor(private readonly service: PlatformMembersService) {}

  @Get()
  @PermissionOperation({
    description: "查看平台访问人员列表。",
    label: "查看平台访问人员",
    operation: "list",
    sortOrder: 10,
  })
  list() {
    return this.service.list();
  }

  @Post()
  @PermissionOperation({
    description: "添加平台访问人员。",
    label: "添加平台访问人员",
    operation: "create",
    sortOrder: 20,
  })
  create(@Body() payload: PlatformMemberPayload) {
    return this.service.create(payload);
  }

  @Patch(":memberId")
  @PermissionOperation({
    description: "更新平台访问人员的角色或状态。",
    label: "更新平台访问人员",
    operation: "update",
    sortOrder: 30,
  })
  update(
    @Param("memberId") memberId: string,
    @Body() payload: Partial<PlatformMemberPayload>,
  ) {
    return this.service.update(memberId, payload);
  }

  @Delete(":memberId")
  @PermissionOperation({
    description: "移除平台访问人员。",
    isDangerous: true,
    label: "移除平台访问人员",
    operation: "remove",
    sortOrder: 90,
  })
  remove(@Param("memberId") memberId: string) {
    return this.service.remove(memberId);
  }
}

export type PlatformMemberPayload = {
  displayName?: string | null;
  roleId?: string | null;
  status?: "active" | "disabled";
  userId?: string;
};
