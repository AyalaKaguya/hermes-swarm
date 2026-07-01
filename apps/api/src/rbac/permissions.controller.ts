import { Controller, Get, Headers, Query, UnauthorizedException } from "@nestjs/common";
import type { PermissionScope } from "@hermes-swarm/core";
import { parseAuthSessionToken } from "../auth/auth-session.js";
import { RbacCatalogService } from "./rbac-catalog.service.js";

@Controller("admin/permissions")
export class PermissionsController {
  constructor(private readonly catalogService: RbacCatalogService) {}

  @Get("catalog")
  catalog(
    @Headers("authorization") authorization: string | undefined,
    @Query("scope") scope?: PermissionScope,
  ) {
    requireSession(authorization);
    return this.catalogService.getCatalog(isScope(scope) ? scope : undefined);
  }
}

function isScope(value: string | undefined): value is PermissionScope {
  return value === "platform" || value === "organization" || value === "own";
}

function requireSession(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const session = parseAuthSessionToken(token);
  if (!session) throw new UnauthorizedException("登录已失效，请重新登录");
}
