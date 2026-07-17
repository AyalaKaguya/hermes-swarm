import type { DynamicModule, InjectionToken, ModuleMetadata } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AccessAuditInterceptor } from "./access-audit.interceptor.js";
import { AccessGuard } from "./access.guard.js";
import { AccessNestModule } from "./access-nest.module.js";
import {
  OrganizationPermissionsController,
  PlatformPermissionsController,
  PermissionsController,
} from "./permissions.controller.js";
import { ACCESS_AUTH_SESSION_SERVICE } from "./tokens.js";

export type RbacModuleOptions = {
  authSessionService: InjectionToken;
  imports?: ModuleMetadata["imports"];
};

@Module({})
export class RbacModule {
  static register(options: RbacModuleOptions): DynamicModule {
    return {
      module: RbacModule,
      imports: [...(options.imports ?? []), AccessNestModule],
      controllers: [
        OrganizationPermissionsController,
        PermissionsController,
        PlatformPermissionsController,
      ],
      providers: [
        {
          provide: ACCESS_AUTH_SESSION_SERVICE,
          useExisting: options.authSessionService,
        },
        {
          provide: APP_GUARD,
          useClass: AccessGuard,
        },
        {
          provide: APP_INTERCEPTOR,
          useExisting: AccessAuditInterceptor,
        },
      ],
      exports: [AccessNestModule],
    };
  }
}
