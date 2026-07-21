import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  buildWorkspaceApplicationLinks,
  buildWorkspaceOwnerActivationLink,
  WorkspacesService,
} from "./workspaces.service.js";

describe("WorkspacesService applications", () => {
  it("normalizes a public application and requires email verification", async () => {
    const state = createState();
    const result = await state.service.apply({
      ownerDisplayName: " Alice ",
      ownerEmail: "ALICE@example.com",
      requestedName: "North Region",
      requestedSlug: "North Region",
    });
    assert.equal(result.applicationId, "application-1");
    assert.ok(result.verificationToken);
    assert.equal(state.applications[0]?.ownerEmail, "alice@example.com");
    assert.equal(state.applications[0]?.requestedSlug, "north-region");
    assert.equal(state.applications[0]?.status, "pending_email_verification");
    assert.ok(result.cancellationToken);
    assert.equal(result.verificationEmailSent, true);
    assert.equal(state.sentEmails[0]?.templateName, "workspace-application-verification");
  });

  it("keeps an application when platform email delivery fails", async () => {
    const state = createState({ failEmail: true });
    const result = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      preferredLanguage: "en-US",
      requestedName: "North Region",
    });
    assert.equal(result.verificationEmailSent, false);
    assert.equal(state.applications[0]?.preferredLanguage, "en");
  });

  it("rejects new applications when the platform has closed workspace applications", async () => {
    const state = createState({ workspaceApplicationsEnabled: false });
    await assert.rejects(
      state.service.apply({
        ownerDisplayName: "Alice",
        ownerEmail: "alice@example.com",
        requestedName: "North Region",
      }),
      ForbiddenException,
    );
    assert.equal(state.applications.length, 0);
    assert.equal(state.sentEmails.length, 0);
  });

  it("builds encoded public application and activation links", () => {
    const links = buildWorkspaceApplicationLinks("app/1", "verify token", "cancel token");
    assert.match(links.verificationLink, /applicationId=app%2F1/);
    assert.match(links.cancellationLink, /cancelToken=cancel\+token/);
    assert.match(
      buildWorkspaceOwnerActivationLink("owner+workspace@example.com", "token value"),
      /email=owner%2Bworkspace%40example.com&token=token\+value/,
    );
  });

  it("moves a verified application into platform review", async () => {
    const state = createState();
    const applied = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    const verified = await state.service.verifyApplication(
      applied.applicationId,
      applied.verificationToken,
    );
    assert.equal(verified.status, "pending_review");
    assert.ok(verified.emailVerifiedAt instanceof Date);
    assert.equal(verified.emailVerificationTokenHash, null);
  });

  it("rejects duplicate workspace slugs before creating an application", async () => {
    const state = createState({ duplicateSlug: "north-region" });
    await assert.rejects(
      state.service.apply({
        ownerDisplayName: "Alice",
        ownerEmail: "alice@example.com",
        requestedName: "North Region",
        requestedSlug: "north-region",
      }),
      BadRequestException,
    );
  });

  it("allows the applicant to cancel an unprocessed application with a private token", async () => {
    const state = createState();
    const applied = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    const cancelled = await state.service.cancelApplication(
      applied.applicationId,
      applied.cancellationToken,
    );
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.cancellationTokenHash, null);
    assert.equal(cancelled.emailVerificationTokenHash, null);
  });

  it("does not expose application cancellation by id alone", async () => {
    const state = createState();
    const applied = await state.service.apply({
      ownerDisplayName: "Alice",
      ownerEmail: "alice@example.com",
      requestedName: "North Region",
      requestedSlug: "north-region",
    });
    await assert.rejects(
      state.service.cancelApplication(applied.applicationId, "wrong-token"),
      BadRequestException,
    );
    assert.equal(state.applications[0]?.status, "pending_email_verification");
  });

  it("lets the platform suspend an active workspace but never directly activates provisioning", async () => {
    const active = createState({ workspace: { id: "workspace-1", status: "active" } });
    assert.equal(
      (await active.service.updateWorkspaceStatus("workspace-1", "suspended")).status,
      "suspended",
    );

    const provisioning = createState({
      workspace: { id: "workspace-2", status: "provisioning" },
    });
    await assert.rejects(
      provisioning.service.updateWorkspaceStatus("workspace-2", "active"),
      BadRequestException,
    );
    await assert.rejects(
      provisioning.service.updateWorkspaceStatus("workspace-2", "suspended"),
      BadRequestException,
    );
    await assert.rejects(
      provisioning.service.updateWorkspaceStatus("missing", "suspended"),
      NotFoundException,
    );
  });

  it("creates roles directly at workspace scope", async () => {
    const state = createWorkspaceRoleState();
    const created = await state.service.createWorkspaceRole("workspace-1", {
      displayName: "Support Lead",
      name: "Support Lead",
    });
    assert.equal(created.name, "support-lead");
    assert.equal(created.scope, "workspace");
  });

  it("keeps reserved system role names and workspace context isolated", async () => {
    const state = createWorkspaceRoleState();
    await assert.rejects(
      state.service.createWorkspaceRole("workspace-1", {
        displayName: "Looks like owner",
        name: "workspace-owner",
      }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.listWorkspaceRoles("workspace-2"),
      NotFoundException,
    );
  });

  it("returns workspace role permissions as the shared role DTO contract", async () => {
    const state = createWorkspaceRoleState();
    state.roles.push({
      id: "role-owner",
      isSystem: true,
      label: "Workspace Owner",
      name: "workspace-owner",
      rolePermissions: [
        {
          enabled: true,
          id: "role-permission-1",
          permission: "workspace.workspace_profile.list_roles:workspace",
          permissionId: "permission-1",
          roleId: "role-owner",
        },
      ],
      scope: "workspace",
      workspaceId: "workspace-1",
    });

    const [role] = await state.service.listWorkspaceRoles("workspace-1");

    assert.deepEqual(role.permissions, [
      {
        enabled: true,
        id: "role-permission-1",
        permission: "workspace.workspace_profile.list_roles:workspace",
        permissionId: "permission-1",
        roleId: "role-owner",
      },
    ]);
  });

  it("rejects duplicate workspace role renames", async () => {
    const state = createWorkspaceRoleState();
    const first = await state.service.createWorkspaceRole("workspace-1", {
      displayName: "First",
      name: "first",
    });
    await state.service.createWorkspaceRole("workspace-1", {
      displayName: "Second",
      name: "second",
    });
    await assert.rejects(
      state.service.updateWorkspaceRole("workspace-1", first.id, { name: "second" }),
      BadRequestException,
    );
  });

  it("allows Workspace Owner to replace a system Workspace Member role's permissions", async () => {
    const state = createWorkspaceRoleState();
    state.permissions.push({
      code: "member.workspace_user.list:workspace",
      id: "permission-list-users",
      scope: "workspace",
    });
    state.roles.push({
      id: "role-member",
      isSystem: true,
      label: "Workspace Member",
      name: "workspace-member",
      rolePermissions: [],
      scope: "workspace",
      workspaceId: "workspace-1",
    });

    const updated = await state.service.replaceWorkspaceRolePermissions(
      "workspace-1",
      "role-member",
      {
        permissions: [
          { enabled: true, permission: "member.workspace_user.list:workspace" },
        ],
      },
    );

    assert.deepEqual(
      updated.permissions.map((item: any) => item.permission),
      ["member.workspace_user.list:workspace"],
    );
  });

  it("keeps Workspace Owner's full permission set immutable", async () => {
    const state = createWorkspaceRoleState();
    state.roles.push({
      id: "role-owner",
      isSystem: true,
      label: "Workspace Owner",
      name: "workspace-owner",
      rolePermissions: [],
      scope: "workspace",
      workspaceId: "workspace-1",
    });

    await assert.rejects(
      state.service.replaceWorkspaceRolePermissions("workspace-1", "role-owner", {
        permissions: [],
      }),
      BadRequestException,
    );
  });
});

function createState(options: {
  duplicateSlug?: string;
  failEmail?: boolean;
  workspace?: { id: string; status: string };
  workspaceApplicationsEnabled?: boolean;
} = {}) {
  const applications: any[] = [];
  const applicationRepository: any = {
    create: (value: any) => ({ id: `application-${applications.length + 1}`, ...value }),
    findOne: async ({ where }: any) =>
      applications.find((item) => item.id === where.id) ?? null,
    save: async (value: any) => {
      const index = applications.findIndex((item) => item.id === value.id);
      if (index >= 0) applications[index] = value;
      else applications.push(value);
      return value;
    },
  };
  const workspaceRepository: any = {
    find: async () => options.workspace ? [options.workspace] : [],
    findOne: async ({ where }: any) => {
      const candidates = Array.isArray(where) ? where : [where];
      if (options.workspace && candidates.some((candidate) => candidate.id === options.workspace?.id)) {
        return options.workspace;
      }
      return options.duplicateSlug &&
        candidates.some((candidate) => candidate.slug === options.duplicateSlug)
        ? { id: "existing-workspace" }
        : null;
    },
    save: async (value: any) => value,
  };
  const manager = {
    findOne: async (target: { name?: string }, { where }: any) => {
      if (target.name === "WorkspaceApplication") {
        return applications.find((item) => item.id === where.id) ?? null;
      }
      return workspaceRepository.findOne({ where });
    },
    save: async (target: { name?: string }, value: any) => {
      if (target.name === "WorkspaceApplication") return applicationRepository.save(value);
      return workspaceRepository.save(value);
    },
    transaction: async (work: (manager: any) => Promise<unknown>) => work(manager),
  };
  applicationRepository.manager = manager;
  workspaceRepository.manager = manager;
  const sentEmails: any[] = [];
  return {
    applications,
    sentEmails,
    service: new WorkspacesService(
      workspaceRepository as never,
      applicationRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        send: async (input: any) => {
          sentEmails.push(input);
          if (options.failEmail) throw new Error("smtp failed");
          return { sent: true };
        },
      } as never,
      {} as never,
      {
        getPlatformValue: async () =>
          options.workspaceApplicationsEnabled === false ? "false" : "true",
      } as never,
    ),
  };
}

function createWorkspaceRoleState() {
  const roles: any[] = [];
  const permissions: any[] = [];
  const workspaceContext = {
    current: () => ({
      manager: {
        delete: async (target: { name?: string }, where: any) => {
          if (target.name === "RolePermission") {
            const role = roles.find((item) => item.id === where.roleId);
            if (role) role.rolePermissions = [];
          }
          return { affected: 0 };
        },
        save: async (target: { name?: string }, values: any) => {
          if (target.name === "RolePermission") {
            const rows = Array.isArray(values) ? values : [values];
            const role = roles.find((item) => item.id === rows[0]?.roleId);
            if (role) {
              role.rolePermissions = rows.map((row, index) => ({
                id: `role-permission-${index + 1}`,
                ...row,
                permissionRecord: permissions.find(
                  (permission) => permission.id === row.permissionId,
                ),
                permission: permissions.find(
                  (permission) => permission.id === row.permissionId,
                )?.code,
              }));
            }
          }
          return values;
        },
      },
      workspaceId: "workspace-1",
    }),
    repository: (target: { name?: string }) => {
      if (target.name === "Role") {
        return {
          create: (value: any) => ({ id: `role-${roles.length + 1}`, ...value }),
          find: async () => roles,
          findOne: async ({ where }: any) =>
            roles.find(
              (role) =>
                (!where.id || role.id === where.id) &&
                (!where.name || role.name === where.name) &&
                role.workspaceId === where.workspaceId,
            ) ?? null,
          save: async (value: any) => {
            const index = roles.findIndex((role) => role.id === value.id);
            if (index >= 0) roles[index] = value;
            else roles.push(value);
            return value;
          },
        };
      }
      if (target.name === "Permission") {
        return {
          findOne: async ({ where }: any) =>
            permissions.find((permission) => permission.code === where.code) ?? null,
        };
      }
      return { findOne: async () => null };
    },
  };
  return {
    permissions,
    roles,
    service: new WorkspacesService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workspaceContext as never,
      { send: async () => ({ sent: true }) } as never,
    ),
  };
}
