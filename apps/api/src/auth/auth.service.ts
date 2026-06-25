import { Injectable } from "@nestjs/common";
import type { LoginPayload } from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Injectable()
/**
 * Wraps the current lightweight admin session implementation behind an auth
 * module boundary compatible with the xpert migration shape.
 */
export class AuthService {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Authenticates an admin user and returns the session token plus snapshot.
   */
  login(payload: LoginPayload) {
    return this.tenancyService.login(payload);
  }

  /**
   * Checks whether the bearer token resolves to an active user and organization.
   */
  authenticated(authorization: string | undefined) {
    return this.tenancyService.isAuthenticated(authorization);
  }

  /**
   * Resolves the current authenticated user, role, permissions, and organization.
   */
  async me(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.getMe(context);
  }
}
