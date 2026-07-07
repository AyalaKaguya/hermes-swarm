import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthModule } from "./auth/auth.module.js";
import { ConversationsModule } from "./conversations/conversations.module.js";
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
import { UsersModule } from "./users/users.module.js";
import { InfrastructureBootstrapController } from "./infrastructure-bootstrap.controller.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      Permission,
      PlatformMember,
      Role,
      RolePermission,
      User,
      UserOrganization,
    ]),
    AuthModule,
    ConversationsModule,
    FeatureAccessModule,
    UsersModule,
    OrganizationsModule,
    SettingsModule,
    InviteModule,
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
    PasswordResetModule,
  ],
  controllers: [InfrastructureBootstrapController],
})
export class InfrastructureModule {}
