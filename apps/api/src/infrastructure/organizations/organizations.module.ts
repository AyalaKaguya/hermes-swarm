import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { SettingsModule } from "../settings/settings.module.js";
import { MailModule } from "../mail/mail.module.js";

@Module({
  imports: [
    AuthModule,
    MailModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      Organization,
      Permission,
      PlatformMember,
      Role,
      RolePermission,
      UserOrganization,
    ]),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
