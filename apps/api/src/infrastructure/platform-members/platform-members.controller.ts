import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { PlatformMembersService } from "./platform-members.service.js";

@Controller("admin/platform/members")
@AccessResource({
  entity: "user",
  entityLabel: "用户",
  entityOrder: 10,
  purpose: "platform_member",
  purposeLabel: "平台运营人员",
  purposeOrder: 20,
  scope: "platform",
})
export class PlatformMembersController {
  constructor(
    @Inject(PlatformMembersService)
    private readonly service: PlatformMembersService,
  ) {}

  @Get()
  @AccessOperation({
    description: "查看平台运营人员列表。",
    label: "查看平台运营人员",
    operation: "list",
    sortOrder: 10,
  })
  list() {
    return this.service.list();
  }

  @Post()
  @AccessOperation({
    description: "添加平台运营人员。",
    label: "添加平台运营人员",
    operation: "create",
    sortOrder: 20,
  })
  create(@Body() payload: PlatformMemberPayload) {
    return this.service.create(payload);
  }

  @Patch(":memberId")
  @AccessOperation({
    description: "更新平台运营人员的角色或状态。",
    label: "更新平台运营人员",
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
  @AccessOperation({
    description: "移除平台运营人员。",
    isDangerous: true,
    label: "移除平台运营人员",
    operation: "remove",
    sortOrder: 90,
  })
  remove(@Param("memberId") memberId: string) {
    return this.service.remove(memberId);
  }
}

export type PlatformMemberPayload = {
  displayName?: string | null;
  email?: string;
  password?: string;
  roleId?: string | null;
  status?: "active" | "disabled";
  userId?: string;
};
