import { Injectable } from "@nestjs/common";
import type { LoginPayload } from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Injectable()
export class AuthService {
  constructor(private readonly tenancyService: TenancyService) {}

  login(payload: LoginPayload) {
    return this.tenancyService.login(payload);
  }

  authenticated(authorization: string | undefined) {
    return this.tenancyService.isAuthenticated(authorization);
  }

  async me(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getMe(context);
  }
}
