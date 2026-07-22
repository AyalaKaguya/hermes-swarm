import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { InjectRepository } from "@nestjs/typeorm";
import {
  getOperationPermissionId,
  PAGE_ACCESS_DEFINITIONS,
} from "@hermes-swarm/rbac-api";
import {
  Permission,
  Role,
  RolePermission,
  type PermissionScope,
} from "@hermes-swarm/core";
import { In, Not, Repository } from "typeorm";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  PERMISSION_RESOURCE_METADATA,
  REQUIRE_PERMISSION_METADATA,
  PUBLIC_ACCESS_METADATA,
} from "./access.decorators.js";
import type {
  AccessDefaultRole,
  AccessOperationMetadata,
  AccessResourceMetadata,
  ResolvedAccessDefinition,
} from "./access.types.js";

const SCOPE_LABELS: Record<PermissionScope, string> = {
  own: "个人",
  platform: "平台",
  workspace: "工作空间",
};
const METHOD_METADATA = "method";
const PATH_METADATA = "path";

const SCOPE_ORDER: Record<PermissionScope, number> = {
  platform: 0,
  workspace: 1,
  own: 2,
};

@Injectable()
export class AccessCatalogService implements OnModuleInit {
  private readonly logger = new Logger(AccessCatalogService.name);
  private definitions: ResolvedAccessDefinition[] = [];

  constructor(
    private readonly discoveryService: DiscoveryService,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
  ) {}

  async onModuleInit() {
    this.definitions = [
      ...this.scanDefinitions(),
      ...resolveNavigationDefinitions(),
    ].sort(compareDefinition);
    if (process.env.RBAC_SYNC_CATALOG_ENABLED === "false") return;
    await this.syncCatalog().catch((error) => {
      this.logger.error(`权限目录同步失败: ${String(error)}`);
      if (process.env.NODE_ENV === "production") throw error;
    });
  }

  getDefinitions(scope?: PermissionScope) {
    const definitions = scope
      ? this.definitions.filter((definition) => definition.scope === scope)
      : this.definitions;
    return [...definitions];
  }

  getDefinition(permissionId: string) {
    return (
      this.definitions.find((definition) => definition.id === permissionId) ??
      null
    );
  }

  getCatalog(scope?: PermissionScope) {
    const scopes = new Map<PermissionScope, ScopeNode>();

    for (const definition of this.getDefinitions(scope)) {
      let scopeNode = scopes.get(definition.scope);
      if (!scopeNode) {
        scopeNode = {
          entities: [],
          label: SCOPE_LABELS[definition.scope],
          scope: definition.scope,
        };
        scopes.set(definition.scope, scopeNode);
      }

      let entityNode = scopeNode.entities.find(
        (item) => item.entity === definition.entity,
      );
      if (!entityNode) {
        entityNode = {
          entity: definition.entity,
          label: definition.entityLabel,
          order: definition.entityOrder,
          purposes: [],
        };
        scopeNode.entities.push(entityNode);
      }

      let purposeNode = entityNode.purposes.find(
        (item) => item.purpose === definition.purpose,
      );
      if (!purposeNode) {
        purposeNode = {
          label: definition.purposeLabel,
          operations: [],
          order: definition.purposeOrder,
          purpose: definition.purpose,
        };
        entityNode.purposes.push(purposeNode);
      }

      purposeNode.operations.push({
        description: definition.description,
        isDangerous: definition.isDangerous,
        label: definition.operationLabel,
        operation: definition.operation,
        order: definition.operationOrder,
        permission: definition.id,
      });
    }

    return {
      scopes: [...scopes.values()]
        .sort((left, right) => SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope])
        .map((scopeNode) => ({
          ...scopeNode,
          entities: scopeNode.entities
            .sort(compareOrdered("order", "label", "entity"))
            .map((entityNode) => ({
              ...entityNode,
              purposes: entityNode.purposes
                .sort(compareOrdered("order", "label", "purpose"))
                .map((purposeNode) => ({
                  ...purposeNode,
                  operations: purposeNode.operations.sort(
                    compareOrdered("order", "label", "operation"),
                  ),
                })),
            })),
        })),
    };
  }

  async findPermissionOrThrow(permissionId: string, scope: PermissionScope) {
    return this.permissionRepository.findOne({
      where: { code: permissionId, scope },
    });
  }

  async findDefaultPermissions(roleName: string, scope?: PermissionScope) {
    const permissions = await this.permissionRepository.find({
      order: { code: "ASC" },
      where: scope ? { scope } : undefined,
    });
    return permissions.filter((permission) =>
      permission.defaultRoles?.includes(roleName),
    );
  }

  private scanDefinitions() {
    const definitions = new Map<string, ResolvedAccessDefinition>();
    const invalid: string[] = [];

    for (const wrapper of this.discoveryService.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype?.prototype) continue;

      const controllerResource = getResourceMetadata(metatype);
      const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype);
      const isAdminController = String(controllerPath ?? "").startsWith("admin");
      const prototype = metatype.prototype as Record<string, unknown>;

      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") continue;
        const method = prototype[methodName];
        if (typeof method !== "function") continue;
        if (Reflect.getMetadata(METHOD_METADATA, method) === undefined) continue;

        const operation = getHandlerMetadata(method);
        const publicAccess = Reflect.getMetadata(PUBLIC_ACCESS_METADATA, method) as
          | { reason?: string }
          | undefined;
        if (!operation) {
          if (publicAccess?.reason?.trim()) continue;
          if (isAdminController) invalid.push(`${metatype.name}.${methodName}:missing`);
          continue;
        }

        const resource = getResourceMetadata(method) ?? controllerResource;
        const definition = resolveAccessDefinition(resource, operation);
        if (!definition) {
          invalid.push(`${metatype.name}.${methodName}:invalid`);
          continue;
        }
        if (definitions.has(definition.id)) {
          invalid.push(`${metatype.name}.${methodName}:duplicate:${definition.id}`);
          continue;
        }
        definitions.set(definition.id, definition);
      }
    }

    if (invalid.length) {
      throw new Error(`Invalid admin Access metadata: ${invalid.join(", ")}`);
    }
    return [...definitions.values()].sort(compareDefinition);
  }

  private async syncCatalog() {
    const codes = this.definitions.map((definition) => definition.id);
    if (codes.length === 0) return;

    await this.pruneStaleCatalogPermissions(codes);

    await this.permissionRepository.upsert(
      this.definitions.map((definition) =>
        this.permissionRepository.create({
          action:
            definition.source === "navigation"
              ? "access"
              : definition.operation,
          code: definition.id,
          defaultRoles: definition.defaultRoles,
          description: definition.description,
          entity: definition.entity,
          entityLabel: definition.entityLabel,
          entityOrder: definition.entityOrder ?? null,
          isDangerous: definition.isDangerous,
          operation: definition.operation,
          operationLabel: definition.operationLabel,
          operationOrder: definition.operationOrder,
          purpose: definition.purpose,
          purposeLabel: definition.purposeLabel,
          purposeOrder: definition.purposeOrder ?? null,
          scope: definition.scope,
          source: definition.source ?? "controller",
        }),
      ),
      ["code"],
    );

    await this.backfillMissingDefaultRolePermissions();
  }

  private async pruneStaleCatalogPermissions(activeCodes: string[]) {
    const stalePermissions = await this.permissionRepository.find({
      where: {
        code: Not(In(activeCodes)),
        source: In(["controller", "navigation"]),
      },
    });
    const staleIds = stalePermissions.map((permission) => permission.id);
    if (staleIds.length === 0) return;

    await this.rolePermissionRepository.delete({ permissionId: In(staleIds) });
    await this.permissionRepository.delete({ id: In(staleIds) });
  }

  private async backfillMissingDefaultRolePermissions() {
    const roles = await this.roleRepository.find({
      where: { isSystem: true },
    });
    if (roles.length === 0) return;

    const permissions = await this.permissionRepository.find({
      order: { code: "ASC" },
    });
    const existingRows = await this.rolePermissionRepository.find({
      where: { roleId: In(roles.map((role) => role.id)) },
    });
    const existing = new Set(
      existingRows.map((row) => `${row.roleId}:${row.permissionId}`),
    );
    const missingRows: RolePermission[] = [];

    for (const role of roles) {
      const rolePermissions = permissions.filter((permission) => {
        if (!permission.defaultRoles?.includes(role.name)) return false;
        return role.scope === "platform"
          ? permission.scope === "platform"
          : permission.scope === "workspace" || permission.scope === "own";
      });

      for (const permission of rolePermissions) {
        const key = `${role.id}:${permission.id}`;
        if (existing.has(key)) continue;
        existing.add(key);
        missingRows.push(
          this.rolePermissionRepository.create({
            enabled: true,
            permissionId: permission.id,
            roleId: role.id,
          }),
        );
      }
    }

    if (missingRows.length > 0) {
      await this.rolePermissionRepository.save(missingRows);
    }
  }

}

type ScopeNode = {
  entities: EntityNode[];
  label: string;
  scope: PermissionScope;
};

type EntityNode = {
  entity: string;
  label: string;
  order?: number | null;
  purposes: PurposeNode[];
};

type PurposeNode = {
  label: string;
  operations: OperationNode[];
  order?: number | null;
  purpose: string;
};

type OperationNode = {
  description: string | null;
  isDangerous: boolean;
  label: string;
  operation: string;
  order: number | null;
  permission: string;
};

export function resolveAccessDefinition(
  resource: AccessResourceMetadata | undefined,
  operation: AccessOperationMetadata,
): ResolvedAccessDefinition | null {
  const entity = operation.entity ?? resource?.entity;
  const entityLabel = operation.entityLabel ?? resource?.entityLabel ?? entity;
  const purpose = operation.purpose ?? resource?.purpose;
  const purposeLabel = operation.purposeLabel ?? resource?.purposeLabel ?? purpose;
  const scope = operation.scope ?? resource?.scope;

  if (!entity || !entityLabel || !purpose || !purposeLabel || !scope) return null;

  return {
    defaultRoles:
      operation.defaultRoles ?? resolveFallbackDefaultRoles(scope, operation),
    description: operation.description ?? null,
    entity,
    entityLabel,
    entityOrder: operation.entityOrder ?? resource?.entityOrder ?? null,
    id: getOperationPermissionId(entity, purpose, operation.operation, scope),
    isDangerous: Boolean(operation.isDangerous),
    operation: operation.operation,
    operationLabel: operation.label,
    operationOrder: operation.sortOrder ?? null,
    purpose,
    purposeLabel,
    purposeOrder: operation.purposeOrder ?? resource?.purposeOrder ?? null,
    scope,
    source: "controller",
  };
}

export const resolvePermissionDefinition = resolveAccessDefinition;

function resolveNavigationDefinitions(): ResolvedAccessDefinition[] {
  return PAGE_ACCESS_DEFINITIONS.map((definition) => ({
    defaultRoles: [...definition.defaultRoles],
    description: definition.description,
    entity: "navigation",
    entityLabel: "菜单和页面",
    entityOrder: 0,
    id: definition.permission,
    isDangerous: false,
    operation: definition.key,
    operationLabel: definition.label,
    operationOrder: definition.order,
    purpose: "page_access",
    purposeLabel: "页面访问",
    purposeOrder: 0,
    scope: definition.scope,
    source: "navigation",
  }));
}

function resolveFallbackDefaultRoles(
  scope: PermissionScope,
  operation: AccessOperationMetadata,
): AccessDefaultRole[] {
  if (scope === "platform") return ["platform-admin"];
  if (scope === "workspace") return ["workspace-owner", "workspace-admin"];
  if (scope === "own") {
    return ["workspace-owner", "workspace-admin", "workspace-member"];
  }
  if (operation.isDangerous) return ["owner"];
  if (/^(list|view|get|read|search)/.test(operation.operation)) {
    return ["admin", "member", "owner", "viewer"];
  }
  return ["admin", "owner"];
}

function getResourceMetadata(target: object) {
  return (
    Reflect.getMetadata(ACCESS_RESOURCE_METADATA, target) ??
    Reflect.getMetadata(PERMISSION_RESOURCE_METADATA, target)
  ) as AccessResourceMetadata | undefined;
}

function getHandlerMetadata(method: Function) {
  return (
    Reflect.getMetadata(ACCESS_OPERATION_METADATA, method) ??
    Reflect.getMetadata(REQUIRE_PERMISSION_METADATA, method)
  ) as AccessOperationMetadata | undefined;
}

function compareDefinition(
  left: ResolvedAccessDefinition,
  right: ResolvedAccessDefinition,
) {
  return (
    SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope] ||
    compareNullableOrder(left.entityOrder, right.entityOrder) ||
    compareText(left.entityLabel, right.entityLabel) ||
    compareText(left.entity, right.entity) ||
    compareNullableOrder(left.purposeOrder, right.purposeOrder) ||
    compareText(left.purposeLabel, right.purposeLabel) ||
    compareText(left.purpose, right.purpose) ||
    compareNullableOrder(left.operationOrder, right.operationOrder) ||
    compareText(left.operationLabel, right.operationLabel) ||
    compareText(left.operation, right.operation)
  );
}

function compareOrdered<T extends Record<string, unknown>>(
  orderKey: keyof T,
  labelKey: keyof T,
  keyKey: keyof T,
) {
  return (left: T, right: T) =>
    compareNullableOrder(
      left[orderKey] as number | null | undefined,
      right[orderKey] as number | null | undefined,
    ) ||
    compareText(String(left[labelKey] ?? ""), String(right[labelKey] ?? "")) ||
    compareText(String(left[keyKey] ?? ""), String(right[keyKey] ?? ""));
}

function compareNullableOrder(
  left: number | null | undefined,
  right: number | null | undefined,
) {
  const leftConfigured = typeof left === "number";
  const rightConfigured = typeof right === "number";
  if (leftConfigured && rightConfigured) return left - right;
  if (leftConfigured) return -1;
  if (rightConfigured) return 1;
  return 0;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "zh-Hans");
}
