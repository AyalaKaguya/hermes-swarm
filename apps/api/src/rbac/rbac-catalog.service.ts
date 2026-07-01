import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { InjectRepository } from "@nestjs/typeorm";
import { Permission, type PermissionScope } from "@hermes-swarm/core";
import { In, Repository } from "typeorm";
import {
  PERMISSION_RESOURCE_METADATA,
  REQUIRE_PERMISSION_METADATA,
} from "./require-permission.decorator.js";
import type {
  PermissionDefaultRole,
  PermissionOperationMetadata,
  PermissionResourceMetadata,
  ResolvedPermissionDefinition,
} from "./rbac.types.js";

const SCOPE_LABELS: Record<PermissionScope, string> = {
  organization: "组织",
  own: "个人",
  platform: "平台",
};

const SCOPE_ORDER: Record<PermissionScope, number> = {
  platform: 0,
  organization: 1,
  own: 2,
};

@Injectable()
export class RbacCatalogService implements OnModuleInit {
  private readonly logger = new Logger(RbacCatalogService.name);
  private definitions: ResolvedPermissionDefinition[] = [];

  constructor(
    private readonly discoveryService: DiscoveryService,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  onModuleInit() {
    this.definitions = this.scanDefinitions();
    void this.syncCatalog().catch((error) => {
      this.logger.error(`权限目录同步失败: ${String(error)}`);
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
    const permission = await this.permissionRepository.findOne({
      where: { code: permissionId, scope },
    });
    return permission;
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
    const definitions = new Map<string, ResolvedPermissionDefinition>();

    for (const wrapper of this.discoveryService.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype?.prototype) continue;

      const resource = Reflect.getMetadata(
        PERMISSION_RESOURCE_METADATA,
        metatype,
      ) as PermissionResourceMetadata | undefined;
      const prototype = metatype.prototype as Record<string, unknown>;

      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") continue;
        const method = prototype[methodName];
        if (typeof method !== "function") continue;

        const operation = Reflect.getMetadata(
          REQUIRE_PERMISSION_METADATA,
          method,
        ) as PermissionOperationMetadata | undefined;
        if (!operation) continue;

        const definition = resolvePermissionDefinition(resource, operation);
        if (definition) definitions.set(definition.id, definition);
      }
    }

    return [...definitions.values()].sort(compareDefinition);
  }

  private async syncCatalog() {
    const codes = this.definitions.map((definition) => definition.id);
    if (codes.length === 0) return;

    const existing = await this.permissionRepository.find({
      where: { code: In(codes) },
    });
    const existingByCode = new Map(
      existing
        .filter((permission) => permission.code)
        .map((permission) => [permission.code as string, permission]),
    );

    for (const definition of this.definitions) {
      const permission =
        existingByCode.get(definition.id) ??
        this.permissionRepository.create({ code: definition.id });
      permission.code = definition.id;
      permission.entity = definition.entity;
      permission.entityLabel = definition.entityLabel;
      permission.entityOrder = definition.entityOrder ?? null;
      permission.purpose = definition.purpose;
      permission.purposeLabel = definition.purposeLabel;
      permission.purposeOrder = definition.purposeOrder ?? null;
      permission.operation = definition.operation;
      permission.operationLabel = definition.operationLabel;
      permission.operationOrder = definition.operationOrder;
      permission.action = definition.operation;
      permission.scope = definition.scope;
      permission.description = definition.description;
      permission.isDangerous = definition.isDangerous;
      permission.source = "controller";
      permission.defaultRoles = definition.defaultRoles;
      await this.permissionRepository.save(permission);
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

export function resolvePermissionDefinition(
  resource: PermissionResourceMetadata | undefined,
  operation: PermissionOperationMetadata,
): ResolvedPermissionDefinition | null {
  const entity = operation.entity ?? resource?.entity;
  const entityLabel = operation.entityLabel ?? resource?.entityLabel ?? entity;
  const purpose = operation.purpose ?? resource?.purpose;
  const purposeLabel = operation.purposeLabel ?? resource?.purposeLabel ?? purpose;
  const scope = operation.scope ?? resource?.scope;

  if (!entity || !entityLabel || !purpose || !purposeLabel || !scope) return null;

  const id = `${entity}.${purpose}.${operation.operation}:${scope}`;
  const definition = {
    defaultRoles:
      operation.defaultRoles ?? resolveFallbackDefaultRoles(scope, operation),
    description: operation.description ?? null,
    entity,
    entityLabel,
    entityOrder: operation.entityOrder ?? resource?.entityOrder ?? null,
    id,
    isDangerous: Boolean(operation.isDangerous),
    operation: operation.operation,
    operationLabel: operation.label,
    operationOrder: operation.sortOrder ?? null,
    purpose,
    purposeLabel,
    purposeOrder: operation.purposeOrder ?? resource?.purposeOrder ?? null,
    scope,
  };
  return definition;
}

function resolveFallbackDefaultRoles(
  scope: PermissionScope,
  operation: PermissionOperationMetadata,
): PermissionDefaultRole[] {
  if (scope === "platform") return ["platform-admin"];
  if (scope === "own") return ["admin", "member", "owner", "viewer"];
  if (operation.isDangerous) return ["owner"];
  if (/^(list|view|get|read|search)/.test(operation.operation)) {
    return ["admin", "member", "owner", "viewer"];
  }
  return ["admin", "owner"];
}

function compareDefinition(
  left: ResolvedPermissionDefinition,
  right: ResolvedPermissionDefinition,
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
