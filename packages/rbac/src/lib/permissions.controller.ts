import {
  Controller,
  Get,
  Headers,
  Inject,
  UnauthorizedException,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "./access.decorators.js";
import { AccessCatalogService } from "./access-catalog.service.js";
import type { AccessAuthSessionService } from "./access.types.js";
import { ACCESS_AUTH_SESSION_SERVICE } from "./tokens.js";

@Controller("admin/workspace/permissions")
@AccessResource({
  entity: "permission",
  entityLabel: "权限",
  entityOrder: 5,
  purpose: "catalog",
  purposeLabel: "权限目录",
  purposeOrder: 10,
  scope: "own",
})
export class PermissionsController {
  constructor(
    @Inject(ACCESS_AUTH_SESSION_SERVICE)
    private readonly authSessionService: AccessAuthSessionService,
    private readonly catalogService: AccessCatalogService,
  ) {}

  @Get("catalog")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "查看当前账号可配置的权限目录。",
    label: "查看权限目录",
    operation: "list",
    sortOrder: 10,
  })
  async catalog(
    @Headers("authorization") authorization: string | undefined,
  ) {
    await this.requireSession(authorization);
    const workspace = this.catalogService.getCatalog("workspace");
    const own = this.catalogService.getCatalog("own");
    return { scopes: [...workspace.scopes, ...own.scopes] };
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

@Controller("admin/platform/permissions")
@AccessResource({
  entity: "permission",
  entityLabel: "权限",
  entityOrder: 5,
  purpose: "platform_catalog",
  purposeLabel: "平台权限目录",
  purposeOrder: 10,
  scope: "platform",
})
export class PlatformPermissionsController {
  constructor(private readonly catalogService: AccessCatalogService) {}

  @Get("catalog")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    description: "查看平台角色可配置的权限目录。",
    label: "查看平台权限目录",
    operation: "list",
    sortOrder: 10,
  })
  catalog() {
    return this.catalogService.getCatalog("platform");
  }
}
