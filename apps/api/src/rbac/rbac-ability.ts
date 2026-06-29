import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from "@casl/ability";
import type {
  PermissionAction,
  PermissionScope,
} from "@hermes-swarm/core";
import type { PermissionRequirement } from "./rbac.types.js";

export type RbacSubject = `${string}:${PermissionScope}`;
export type RbacAbility = MongoAbility<[PermissionAction, RbacSubject]>;

export function buildRbacAbility(requirements: PermissionRequirement[]) {
  const { can, build } = new AbilityBuilder<RbacAbility>(createMongoAbility);
  for (const requirement of requirements) {
    can(
      requirement.action,
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
