import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import type { LoginPayload } from "../tenancy/tenancy.types.js";
import { AuthService } from "./auth.service.js";

@Controller("admin/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() payload: LoginPayload) {
    return this.authService.login(payload);
  }

  @Get("authenticated")
  authenticated(@Headers("authorization") authorization?: string) {
    return this.authService.authenticated(authorization);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(authorization);
  }
}
