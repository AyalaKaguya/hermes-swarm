import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  PasswordReset,
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
import { DatabaseModule } from "../../common/database/database.module.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { MailModule } from "../mail/mail.module.js";
import { SettingsModule } from "../settings/settings.module.js";

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    SettingsModule,
    TypeOrmModule.forFeature([Workspace]),
    TypeOrmModule.forFeature(
      [
        Permission,
        PasswordReset,
        Account,
        Role,
        RolePermission,
        Workspace,
        WorkspaceApplication,
        WorkspaceMembership,
      ],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [RolesController, WorkspaceApplicationsController, WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
