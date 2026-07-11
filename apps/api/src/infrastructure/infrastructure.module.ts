import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  PlatformRole,
  PlatformRolePermission,
  PlatformUser,
  PlatformUserRole,
} from "@hermes-swarm/core";
import { AuthModule } from "./auth/auth.module.js";
import { ConversationsModule } from "./conversations/conversations.module.js";
import { DepartmentsModule } from "./departments/departments.module.js";
import { FeatureAccessModule } from "./feature-access/feature-access.module.js";
import { FilesModule } from "./files/files.module.js";
import { GroupsModule } from "./groups/groups.module.js";
import { IntegrationsModule } from "./integrations/integrations.module.js";
import { InviteModule } from "./invite/invite.module.js";
import { MailModule } from "./mail/mail.module.js";
import { MembershipsModule } from "./memberships/memberships.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { PasswordResetModule } from "./password-reset/password-reset.module.js";
import { PlatformMembersModule } from "./platform-members/platform-members.module.js";
import { PlatformRolesModule } from "./platform-roles/platform-roles.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { TicketsModule } from "./tickets/tickets.module.js";
import { TenantsModule } from "./tenants/tenants.module.js";
import { UsersModule } from "./users/users.module.js";
import { InfrastructureBootstrapController } from "./infrastructure-bootstrap.controller.js";
import { PLATFORM_DATA_SOURCE } from "../common/database/database.constants.js";
import { JobsModule } from "../common/jobs/jobs.module.js";

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        Permission,
        PlatformRole,
        PlatformRolePermission,
        PlatformUser,
        PlatformUserRole,
      ],
      PLATFORM_DATA_SOURCE,
    ),
    AuthModule,
    ConversationsModule,
    DepartmentsModule,
    FeatureAccessModule,
    UsersModule,
    OrganizationsModule,
    SettingsModule,
    InviteModule,
    JobsModule,
    FilesModule,
    GroupsModule,
    IntegrationsModule,
    MailModule,
    MembershipsModule,
    PlatformMembersModule,
    PlatformRolesModule,
    RealtimeModule,
    NotificationsModule,
    TicketsModule,
    TenantsModule,
    PasswordResetModule,
  ],
  controllers: [InfrastructureBootstrapController],
})
export class InfrastructureModule {}
