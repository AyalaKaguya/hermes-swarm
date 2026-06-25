import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [TenancyModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
