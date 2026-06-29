import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { MembershipsService } from "./memberships.service.js";

@Controller("admin/organizations/:organizationId/members")
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @RequirePermission({ action: "read", entity: "user", scope: "organization" })
  list(@Param("organizationId") organizationId: string) {
    return this.membershipsService.list(organizationId);
  }

  @Post()
  @RequirePermission({ action: "create", entity: "user", scope: "organization" })
  create(
    @Param("organizationId") organizationId: string,
    @Body() payload: MembershipPayload,
  ) {
    return this.membershipsService.create(organizationId, payload);
  }

  @Patch(":membershipId")
  @RequirePermission({ action: "update", entity: "user", scope: "organization" })
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
  @RequirePermission({ action: "delete", entity: "user", scope: "organization" })
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
