import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METHOD_METADATA } from "@nestjs/common/constants";
import {
  ACCESS_OPERATION_METADATA,
  PUBLIC_ACCESS_METADATA,
} from "@hermes-swarm/rbac";
import { AuthController } from "./auth/auth.controller.js";
import {
  PlatformAuditController,
  TenantAuditController,
} from "./audit/audit.controller.js";
import { FilesController } from "./files/files.controller.js";
import { InfrastructureBootstrapController } from "./infrastructure-bootstrap.controller.js";
import { IntegrationTokensController } from "./integrations/integration-tokens.controller.js";
import { InviteController } from "./invite/invite.controller.js";
import { TenantMailController } from "./mail/mail.controller.js";
import { PlatformMailController } from "./mail/platform-mail.controller.js";
import { MembershipsController } from "./memberships/memberships.controller.js";
import { NotificationsController } from "./notifications/notifications.controller.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { PasswordResetController } from "./password-reset/password-reset.controller.js";
import { PlatformMembersController } from "./platform-members/platform-members.controller.js";
import { PlatformRolesController } from "./platform-roles/platform-roles.controller.js";
import { SettingsController } from "./settings/settings.controller.js";
import { TicketsController } from "../domains/support/tickets/tickets.controller.js";
import {
  TenantApplicationsController,
  TenantsController,
} from "./tenants/tenants.controller.js";
import { RolesController } from "./tenants/roles.controller.js";
import { UsersController } from "./users/users.controller.js";
import { PermissionsController } from "@hermes-swarm/rbac";

const ADMIN_CONTROLLERS = [
  AuthController,
  PlatformAuditController,
  FilesController,
  InfrastructureBootstrapController,
  IntegrationTokensController,
  InviteController,
  TenantMailController,
  MembershipsController,
  NotificationsController,
  OrganizationsController,
  PasswordResetController,
  PlatformMailController,
  PlatformMembersController,
  PlatformRolesController,
  PermissionsController,
  SettingsController,
  RolesController,
  TenantApplicationsController,
  TenantAuditController,
  TenantsController,
  TicketsController,
  UsersController,
] as const;

describe("admin route access metadata", () => {
  it("requires every admin handler to explicitly declare access or public behavior", () => {
    const missing: string[] = [];

    for (const controller of ADMIN_CONTROLLERS) {
      for (const methodName of Object.getOwnPropertyNames(controller.prototype)) {
        if (methodName === "constructor") continue;
        const handler = controller.prototype[methodName];
        if (
          typeof handler !== "function" ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        ) {
          continue;
        }

        const operation = Reflect.getMetadata(ACCESS_OPERATION_METADATA, handler);
        const publicAccess = Reflect.getMetadata(PUBLIC_ACCESS_METADATA, handler);
        if (!operation && !publicAccess) {
          missing.push(`${controller.name}.${methodName}`);
        }
      }
    }

    assert.deepEqual(missing, []);
  });

  it("allows tenant governors to read the role permission catalog", () => {
    const operation = Reflect.getMetadata(
      ACCESS_OPERATION_METADATA,
      PermissionsController.prototype.catalog,
    );

    assert.deepEqual(operation?.defaultRoles, ["tenant-owner", "tenant-admin"]);
  });
});
