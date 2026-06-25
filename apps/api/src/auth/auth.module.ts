import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";

@Module({
  imports: [TenancyModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
