import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Invite,
  Organization,
  Role,
  RolePermission,
  User,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { MailModule } from "../mail/mail.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { InviteController } from "./invite.controller.js";
import { InviteService } from "./invite.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    MailModule,
    NotificationsModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      Invite,
      User,
      Organization,
      Role,
      RolePermission,
      UserOrganization,
      UserOrganizationRole,
      UserTenantRole,
    ]),
  ],
  controllers: [InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
