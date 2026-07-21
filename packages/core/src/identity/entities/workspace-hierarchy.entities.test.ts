import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { Role } from "./role.entity.js";
import { WorkspaceMembership } from "./workspace-membership.entity.js";
import { WorkspaceOwnedBaseEntity } from "./workspace-owned-base.entity.js";
import { Account } from "./account.entity.js";

describe("workspace hierarchy entity metadata", () => {
  it("makes workspace ownership non-null at the shared base", () => {
    const workspaceColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === WorkspaceOwnedBaseEntity &&
        column.propertyName === "workspaceId",
    );

    assert.ok(workspaceColumn);
    assert.equal(workspaceColumn.options.name, "workspace_id");
    assert.notEqual(workspaceColumn.options.nullable, true);
  });

  it("uses globally unique account identities", () => {
    const userIndex = getMetadataArgsStorage().indices.find(
      (index) =>
        index.target === Account && index.name === "UQ_users_email",
    );

    assert.ok(userIndex);
    assert.equal(userIndex.unique, true);
  });

  it("enforces one workspace role per member", () => {
    const assignmentIndex = getMetadataArgsStorage().indices.find(
      (index) =>
        index.target === WorkspaceMembership &&
        index.name === "UQ_user_workspace_roles",
    );
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === WorkspaceMembership,
    );

    assert.ok(assignmentIndex);
    assert.equal(assignmentIndex.unique, true);
    assert.deepEqual(assignmentIndex.columns, ["workspaceId", "accountId"]);
    assert.equal(
      columns.some((column) => column.propertyName === "roleId"),
      true,
    );
  });

  it("keeps roles exclusively at workspace scope", () => {
    const scopeColumn = getMetadataArgsStorage().columns.find(
      (column) => column.target === Role && column.propertyName === "scope",
    );

    assert.ok(scopeColumn);
    assert.equal(scopeColumn.options.default, "workspace");
    assert.equal(
      getMetadataArgsStorage().columns
        .filter((column) => column.target === Role)
        .some((column) => column.propertyName.endsWith("Id") && column.propertyName !== "workspaceId"),
      false,
    );
  });
});
