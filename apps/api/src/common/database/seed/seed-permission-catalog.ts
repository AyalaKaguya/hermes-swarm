import "reflect-metadata";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  PERMISSION_RESOURCE_METADATA,
  REQUIRE_PERMISSION_METADATA,
  resolvePermissionDefinition,
  type ResolvedAccessDefinition,
} from "@hermes-swarm/rbac";
import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import { FilesController } from "../../../infrastructure/files/files.controller.js";
import {
  PlatformAuditController,
  WorkspaceAuditController,
} from "../../../infrastructure/audit/audit.controller.js";
import { IntegrationTokensController } from "../../../infrastructure/integrations/integration-tokens.controller.js";
import { InviteController } from "../../../infrastructure/invite/invite.controller.js";
import { WorkspaceMailController } from "../../../infrastructure/mail/mail.controller.js";
import { PlatformMailController } from "../../../infrastructure/mail/platform-mail.controller.js";
import { NotificationsController } from "../../../infrastructure/notifications/notifications.controller.js";
import { PlatformMembersController } from "../../../infrastructure/platform-members/platform-members.controller.js";
import { PlatformRolesController } from "../../../infrastructure/platform-roles/platform-roles.controller.js";
import { SettingsController } from "../../../infrastructure/settings/settings.controller.js";
import { WorkspaceApplicationsController, WorkspacesController } from "../../../infrastructure/workspaces/workspaces.controller.js";
import { TicketsController } from "../../../domains/support/tickets/tickets.controller.js";
import { UsersController } from "../../../infrastructure/users/users.controller.js";

const ACCESS_CONTROLLERS = [
  FilesController,
  PlatformAuditController,
  IntegrationTokensController,
  InviteController,
  WorkspaceMailController,
  PlatformMailController,
  NotificationsController,
  PlatformMembersController,
  PlatformRolesController,
  SettingsController,
  WorkspaceApplicationsController,
  WorkspaceAuditController,
  WorkspacesController,
  TicketsController,
  UsersController,
] as const;

/** Builds the same controller + navigation catalog that API startup discovers. */
export function buildSeedPermissionCatalog(): ResolvedAccessDefinition[] {
  const definitions = new Map<string, ResolvedAccessDefinition>();
  for (const controller of ACCESS_CONTROLLERS) {
    const classResource = getResourceMetadata(controller);
    const prototype = controller.prototype as unknown as Record<string, unknown>;
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === "constructor") continue;
      const method = prototype[methodName];
      if (typeof method !== "function") continue;
      const operation =
        Reflect.getMetadata(ACCESS_OPERATION_METADATA, method) ??
        Reflect.getMetadata(REQUIRE_PERMISSION_METADATA, method);
      if (!operation) continue;
      const definition = resolvePermissionDefinition(
        getResourceMetadata(method) ?? classResource,
        operation,
      );
      if (definition) definitions.set(definition.id, definition);
    }
  }
  for (const page of PAGE_ACCESS_DEFINITIONS) {
    definitions.set(page.permission, {
      defaultRoles: [...page.defaultRoles],
      description: page.description,
      entity: "navigation",
      entityLabel: "菜单和页面",
      entityOrder: 0,
      id: page.permission,
      isDangerous: false,
      operation: page.key,
      operationLabel: page.label,
      operationOrder: page.order,
      purpose: "page_access",
      purposeLabel: "页面访问",
      purposeOrder: 0,
      scope: page.scope,
      source: "navigation",
    });
  }
  return [...definitions.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function getResourceMetadata(target: object) {
  return (
    Reflect.getMetadata(ACCESS_RESOURCE_METADATA, target) ??
    Reflect.getMetadata(PERMISSION_RESOURCE_METADATA, target)
  );
}
