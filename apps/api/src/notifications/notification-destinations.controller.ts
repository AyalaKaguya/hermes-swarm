import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  PermissionOperation,
  PermissionResource,
} from "@hermes-swarm/rbac";
import { NotificationDestinationsService } from "./notification-destinations.service.js";

@Controller("admin/organizations/:organizationId/notification-destinations")
@PermissionResource({
  entity: "notification",
  entityLabel: "通知",
  entityOrder: 80,
  purpose: "destination",
  purposeLabel: "通知目的地",
  purposeOrder: 10,
  scope: "organization",
})
export class NotificationDestinationsController {
  constructor(private readonly service: NotificationDestinationsService) {}

  @Get()
  @PermissionOperation({
    description: "查看当前组织的通知目的地列表。",
    label: "查看通知目的地",
    operation: "list",
    sortOrder: 10,
  })
  list(@Param("organizationId") organizationId: string) {
    return this.service.list(organizationId);
  }

  @Get("types")
  @PermissionOperation({
    description: "查看可用的通知目的地类型。",
    label: "查看目的地类型",
    operation: "list_types",
    sortOrder: 20,
  })
  types() {
    return this.service.types();
  }

  @Get(":destinationId")
  @PermissionOperation({
    description: "查看当前组织的通知目的地详情。",
    label: "查看目的地详情",
    operation: "view",
    sortOrder: 30,
  })
  getOne(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.getOne(organizationId, destinationId);
  }

  @Get(":destinationId/groups")
  @PermissionOperation({
    description: "查看通知目的地关联的用户组。",
    label: "查看目的地用户组",
    operation: "list_groups",
    sortOrder: 40,
  })
  groups(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.groups(organizationId, destinationId);
  }

  @Post()
  @PermissionOperation({
    description: "创建当前组织的通知目的地。",
    label: "创建通知目的地",
    operation: "create",
    sortOrder: 50,
  })
  create(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.service.create(organizationId, payload);
  }

  @Patch(":destinationId")
  @PermissionOperation({
    description: "更新当前组织的通知目的地。",
    label: "更新通知目的地",
    operation: "update",
    sortOrder: 60,
  })
  update(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
    @Body() payload: unknown,
  ) {
    return this.service.update(organizationId, destinationId, payload);
  }

  @Delete(":destinationId")
  @PermissionOperation({
    description: "删除当前组织的通知目的地。",
    isDangerous: true,
    label: "删除通知目的地",
    operation: "delete",
    sortOrder: 90,
  })
  delete(
    @Param("organizationId") organizationId: string,
    @Param("destinationId") destinationId: string,
  ) {
    return this.service.delete(organizationId, destinationId);
  }
}
