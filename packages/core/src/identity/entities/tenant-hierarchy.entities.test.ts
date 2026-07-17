import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { Organization } from "./organization.entity.js";
import { Role } from "./role.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";
import { UserOrganization } from "./user-organization.entity.js";
import { UserOrganizationRole } from "./user-organization-role.entity.js";
import { User } from "./user.entity.js";

describe("tenant hierarchy entity metadata", () => {
  it("makes tenant ownership non-null at the shared base", () => {
    const tenantColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === TenantOwnedBaseEntity &&
        column.propertyName === "tenantId",
    );

    assert.ok(tenantColumn);
    assert.equal(tenantColumn.options.name, "tenant_id");
    assert.notEqual(tenantColumn.options.nullable, true);
  });

  it("uses tenant-scoped identities for users, organizations and memberships", () => {
    const indices = getMetadataArgsStorage().indices;
    const hasIndex = (target: Function, name: string) =>
      indices.some((index) => index.target === target && index.name === name);

    assert.equal(hasIndex(User, "UQ_users_tenant_identity"), true);
    assert.equal(hasIndex(Organization, "UQ_organizations_tenant_identity"), true);
    assert.equal(
      hasIndex(UserOrganization, "UQ_user_organizations_tenant_identity"),
      true,
    );
  });

  it("models a single-root organization tree", () => {
    const parentColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === Organization &&
        column.propertyName === "parentOrganizationId",
    );
    const rootIndex = getMetadataArgsStorage().indices.find(
      (index) =>
        index.target === Organization &&
        index.name === "UQ_organizations_single_root",
    );

    assert.ok(parentColumn);
    assert.equal(parentColumn.options.nullable, true);
    assert.ok(rootIndex);
    assert.equal(rootIndex.unique, true);
  });

  it("persists exact organization scope on role assignments", () => {
    const columns = getMetadataArgsStorage().columns;
    const hasRequiredColumn = (target: Function, propertyName: string) => {
      const column = columns.find(
        (candidate) =>
          candidate.target === target && candidate.propertyName === propertyName,
      );
      return Boolean(column && column.options.nullable !== true);
    };

    assert.equal(
      hasRequiredColumn(UserOrganizationRole, "organizationId"),
      true,
    );
  });

  it("binds organization roles to an explicit organization owner", () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === Role,
    );
    assert.equal(
      columns.some((column) => column.propertyName === "organizationId"),
      true,
    );
    assert.equal(
      columns.some((column) => column.propertyName === "departmentId"),
      false,
    );
  });
});
