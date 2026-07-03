import type { DynamicModule, InjectionToken, ModuleMetadata } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AccessGuard } from "./access.guard.js";
import { AccessNestModule } from "./access-nest.module.js";
import { PermissionsController } from "./permissions.controller.js";
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
      controllers: [PermissionsController],
      providers: [
        {
          provide: ACCESS_AUTH_SESSION_SERVICE,
          useExisting: options.authSessionService,
        },
        {
          provide: APP_GUARD,
          useClass: AccessGuard,
        },
      ],
      exports: [AccessNestModule],
    };
  }
}
