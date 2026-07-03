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
import { MembershipsService } from "./memberships.service.js";

@Controller("admin/organizations/:organizationId/members")
@PermissionResource({
  entity: "user",
  entityLabel: "用户",
  entityOrder: 10,
  purpose: "organization_member",
  purposeLabel: "组织成员",
  purposeOrder: 10,
  scope: "organization",
})
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @PermissionOperation({
    description: "查看当前组织的成员列表。",
    label: "查看成员列表",
    operation: "list",
    sortOrder: 10,
  })
  list(@Param("organizationId") organizationId: string) {
    return this.membershipsService.list(organizationId);
  }

  @Post()
  @PermissionOperation({
    description: "向当前组织添加成员。",
    label: "添加成员",
    operation: "create",
    sortOrder: 20,
  })
  create(
    @Param("organizationId") organizationId: string,
    @Body() payload: MembershipPayload,
  ) {
    return this.membershipsService.create(organizationId, payload);
  }

  @Patch(":membershipId")
  @PermissionOperation({
    description: "更新组织成员的角色、状态或显示名称。",
    label: "更新成员",
    operation: "update",
    sortOrder: 30,
  })
  update(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() payload: Partial<MembershipPayload>,
  ) {
    return this.membershipsService.update(
      organizationId,
      membershipId,
      payload,
    );
  }

  @Delete(":membershipId")
  @PermissionOperation({
    description: "从当前组织移除成员。",
    isDangerous: true,
    label: "移除成员",
    operation: "remove",
    sortOrder: 90,
  })
  remove(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
  ) {
    return this.membershipsService.remove(organizationId, membershipId);
  }
}

export type MembershipPayload = {
  displayName?: string | null;
  email?: string;
  password?: string;
  roleId?: string | null;
  status?: "active" | "disabled" | "invited";
  userId?: string;
};
