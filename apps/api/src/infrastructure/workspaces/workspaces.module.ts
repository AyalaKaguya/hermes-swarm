import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  Permission,
  Role,
  RolePermission,
  Workspace,
  WorkspaceApplication,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { WorkspaceApplicationsController, WorkspacesController } from "./workspaces.controller.js";
import { RolesController } from "./roles.controller.js";
import { WorkspacesService } from "./workspaces.service.js";
import { WorkspaceApplicationsService } from "./workspace-applications.service.js";
import { WorkspaceRolesService } from "./workspace-roles.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { MailModule } from "../mail/mail.module.js";
import { SettingsModule } from "../settings/settings.module.js";

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      Permission,
      Account,
      Role,
      RolePermission,
      Workspace,
      WorkspaceApplication,
      WorkspaceMembership,
    ]),
  ],
  controllers: [RolesController, WorkspaceApplicationsController, WorkspacesController],
  providers: [
    WorkspaceApplicationsService,
    WorkspaceRolesService,
    WorkspacesService,
  ],
  exports: [WorkspaceApplicationsService, WorkspaceRolesService, WorkspacesService],
})
export class WorkspacesModule {}
