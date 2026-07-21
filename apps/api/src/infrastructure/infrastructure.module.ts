import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  Permission,
  PlatformMembership,
  Role,
  RolePermission,
} from "@hermes-swarm/core";
import { AuthModule } from "./auth/auth.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { FeatureAccessModule } from "./feature-access/feature-access.module.js";
import { FilesModule } from "./files/files.module.js";
import { IntegrationsModule } from "./integrations/integrations.module.js";
import { InviteModule } from "./invite/invite.module.js";
import { MailModule } from "./mail/mail.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { PasswordResetModule } from "./password-reset/password-reset.module.js";
import { PlatformMembersModule } from "./platform-members/platform-members.module.js";
import { PlatformRolesModule } from "./platform-roles/platform-roles.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";
import { UsersModule } from "./users/users.module.js";
import { InfrastructureBootstrapController } from "./infrastructure-bootstrap.controller.js";
import { PLATFORM_DATA_SOURCE } from "../common/database/database.constants.js";

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        Permission,
        Account,
        PlatformMembership,
        Role,
        RolePermission,
      ],
      PLATFORM_DATA_SOURCE,
    ),
    AuthModule,
    AuditModule,
    FeatureAccessModule,
    UsersModule,
    SettingsModule,
    InviteModule,
    FilesModule,
    IntegrationsModule,
    MailModule,
    PlatformMembersModule,
    PlatformRolesModule,
    RealtimeModule,
    NotificationsModule,
    WorkspacesModule,
    PasswordResetModule,
  ],
  controllers: [InfrastructureBootstrapController],
})
export class InfrastructureModule {}
