import { Controller, Get, Headers, Query, UnauthorizedException } from "@nestjs/common";
import type { PermissionScope } from "@hermes-swarm/core";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { RbacCatalogService } from "./rbac-catalog.service.js";

@Controller("admin/permissions")
export class PermissionsController {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly catalogService: RbacCatalogService,
  ) {}

  @Get("catalog")
  async catalog(
    @Headers("authorization") authorization: string | undefined,
    @Query("scope") scope?: PermissionScope,
  ) {
    await requireSession(this.authSessionService, authorization);
    return this.catalogService.getCatalog(isScope(scope) ? scope : undefined);
  }
}

function isScope(value: string | undefined): value is PermissionScope {
  return value === "platform" || value === "organization" || value === "own";
}

async function requireSession(
  authSessionService: AuthSessionService,
  authorization: string | undefined,
) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  try {
    await authSessionService.validateAccessToken(token);
  } catch {
    throw new UnauthorizedException("登录已失效，请重新登录");
  }
}
