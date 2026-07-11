import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { DepartmentDispatchRelation } from "./department-dispatch-relation.entity.js";
import { Organization } from "./organization.entity.js";
import { Role } from "./role.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";
import { UserDepartment } from "./user-department.entity.js";
import { UserDepartmentRole } from "./user-department-role.entity.js";
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

  it("locks role scope columns to tenant, organization or department", () => {
    const check = getMetadataArgsStorage().checks.find(
      (candidate) =>
        candidate.target === Role && candidate.name === "CHK_roles_scope_columns",
    );

    assert.ok(check);
    assert.match(String(check.expression), /scope = 'tenant'/);
    assert.match(String(check.expression), /scope = 'department'/);
  });

  it("requires department membership to pass through an organization membership", () => {
    const membershipColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === UserDepartment && column.propertyName === "membershipId",
    );
    const relation = getMetadataArgsStorage().relations.find(
      (candidate) =>
        candidate.target === UserDepartment &&
        candidate.propertyName === "membership",
    );
    const organizationColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === UserDepartment &&
        column.propertyName === "organizationId",
    );

    assert.ok(membershipColumn);
    assert.notEqual(membershipColumn.options.nullable, true);
    assert.ok(relation);
    assert.ok(organizationColumn);
  });

  it("prevents a department dispatch edge from targeting itself", () => {
    const check = getMetadataArgsStorage().checks.find(
      (candidate) =>
        candidate.target === DepartmentDispatchRelation &&
        candidate.name === "CHK_department_dispatch_not_self",
    );

    assert.ok(check);
  });

  it("persists organization and department scope on role assignments", () => {
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
    assert.equal(
      hasRequiredColumn(UserDepartmentRole, "organizationId"),
      true,
    );
    assert.equal(
      hasRequiredColumn(UserDepartmentRole, "departmentId"),
      true,
    );
  });
});
