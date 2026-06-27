import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FilesModule } from "../files/files.module.js";
import { MailModule } from "../mail/mail.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { InviteModule } from "../invite/invite.module.js";
import { PasswordResetModule } from "../password-reset/password-reset.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { TagsModule } from "../tags/tags.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { UsersModule } from "../users/users.module.js";
import { AdminController } from "./admin.controller.js";

@Module({
  imports: [
    TenancyModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    SettingsModule,
    InviteModule,
    FilesModule,
    MailModule,
    TagsModule,
    NotificationsModule,
    PasswordResetModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
