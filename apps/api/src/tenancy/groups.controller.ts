import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put } from "@nestjs/common";
import { GroupsService } from "./groups.service.js";

@Controller("admin/groups")
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  listGroups(@Headers("authorization") authorization?: string) {
    return this.groupsService.listGroups(authorization);
  }

  @Get(":groupId")
  getGroup(@Headers("authorization") authorization: string | undefined, @Param("groupId") groupId: string) {
    return this.groupsService.getGroup(authorization, groupId);
  }

  @Post()
  createGroup(@Headers("authorization") authorization: string | undefined, @Body() payload: any) {
    return this.groupsService.createGroup(authorization, payload);
  }

  @Patch(":groupId")
  updateGroup(@Headers("authorization") authorization: string | undefined, @Param("groupId") groupId: string, @Body() payload: any) {
    return this.groupsService.updateGroup(authorization, groupId, payload);
  }

  @Put(":groupId/members")
  updateMembers(@Headers("authorization") authorization: string | undefined, @Param("groupId") groupId: string, @Body() payload: any) {
    return this.groupsService.updateMembers(authorization, groupId, payload);
  }

  @Delete(":groupId")
  deleteGroup(@Headers("authorization") authorization: string | undefined, @Param("groupId") groupId: string) {
    return this.groupsService.deleteGroup(authorization, groupId);
  }
}
