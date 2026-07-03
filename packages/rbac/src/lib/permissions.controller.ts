import {
  Controller,
  Get,
  Headers,
  Inject,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import type { PermissionScope } from "@hermes-swarm/core";
import { AccessCatalogService } from "./access-catalog.service.js";
import type { AccessAuthSessionService } from "./access.types.js";
import { ACCESS_AUTH_SESSION_SERVICE } from "./tokens.js";

@Controller("admin/permissions")
export class PermissionsController {
  constructor(
    @Inject(ACCESS_AUTH_SESSION_SERVICE)
    private readonly authSessionService: AccessAuthSessionService,
    private readonly catalogService: AccessCatalogService,
  ) {}

  @Get("catalog")
  async catalog(
    @Headers("authorization") authorization: string | undefined,
    @Query("scope") scope?: PermissionScope,
  ) {
    await this.requireSession(authorization);
    return this.catalogService.getCatalog(isScope(scope) ? scope : undefined);
  }

  private async requireSession(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    try {
      await this.authSessionService.validateAccessToken(token);
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }
}

function isScope(value: string | undefined): value is PermissionScope {
  return value === "platform" || value === "organization" || value === "own";
}
