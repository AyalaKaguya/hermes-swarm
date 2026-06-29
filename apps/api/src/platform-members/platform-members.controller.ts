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
import { PlatformMembersService } from "./platform-members.service.js";

@Controller("admin/platform/members")
export class PlatformMembersController {
  constructor(private readonly service: PlatformMembersService) {}

  @Get()
  @RequirePermission({ action: "read", entity: "user", scope: "platform" })
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission({ action: "create", entity: "user", scope: "platform" })
  create(@Body() payload: PlatformMemberPayload) {
    return this.service.create(payload);
  }

  @Patch(":memberId")
  @RequirePermission({ action: "update", entity: "user", scope: "platform" })
  update(
    @Param("memberId") memberId: string,
    @Body() payload: Partial<PlatformMemberPayload>,
  ) {
    return this.service.update(memberId, payload);
  }

  @Delete(":memberId")
  @RequirePermission({ action: "delete", entity: "user", scope: "platform" })
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
