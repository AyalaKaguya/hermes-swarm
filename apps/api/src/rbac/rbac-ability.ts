import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from "@casl/ability";
import type { PermissionScope } from "@hermes-swarm/core";
import type { ResolvedPermissionDefinition } from "./rbac.types.js";

export type RbacSubject = `${string}:${PermissionScope}`;
export type RbacAbility = MongoAbility<[string, RbacSubject]>;

export function buildRbacAbility(requirements: ResolvedPermissionDefinition[]) {
  const { can, build } = new AbilityBuilder<RbacAbility>(createMongoAbility);
  for (const requirement of requirements) {
    can(
      requirement.operation,
      toRbacSubject(requirement.entity, requirement.scope),
    );
  }
  return build();
}

export function toRbacSubject(
  entity: string,
  scope: PermissionScope,
): RbacSubject {
  return `${entity}:${scope}`;
}
