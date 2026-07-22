import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  Invite,
  Role,
  Workspace,
  Account,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { InviteService } from "./invite.service.js";

describe("InviteService workspace invitation contract", () => {
  it("creates one invitation with a single workspace role", async () => {
    const state = createState();
    const invite = await state.service.create("owner-a", {
      email: " Member@Example.com ",
      workspaceRoleId: "workspace-member",
    });

    assert.equal(invite.email, "member@example.com");
    assert.equal(invite.workspaceRoleId, "workspace-member");
    assert.match(invite.link ?? "", /workspace=workspace-a/);
    assert.equal(state.sentEmails.length, 1);
  });

  it("rejects roles outside the current workspace", async () => {
    const state = createState();
    await assert.rejects(
      state.service.create("owner-a", {
        email: "member@example.com",
        workspaceRoleId: "other-workspace-role",
      }),
      BadRequestException,
    );
  });

  it("keeps one pending invitation per normalized workspace email", async () => {
    const state = createState();
    const payload = {
      email: "member@example.com",
      workspaceRoleId: "workspace-member",
    };
    await state.service.create("owner-a", payload);
    await assert.rejects(
      state.service.create("owner-a", { ...payload, email: "MEMBER@example.com" }),
      ConflictException,
    );
  });
});

function createState() {
  const invites: Array<Record<string, any>> = [];
  const sentEmails: unknown[] = [];
  const roles = [
    {
      id: "workspace-owner",
      name: "workspace-owner",
      rolePermissions: [],
      scope: "workspace",
      workspaceId: "workspace-a",
    },
    {
      id: "workspace-member",
      name: "workspace-member",
      rolePermissions: [],
      scope: "workspace",
      workspaceId: "workspace-a",
    },
  ];
  const manager = {
    find: async (target: unknown, { where }: any) => {
      if (target === WorkspaceMembership) {
        return where.accountId === "owner-a"
          ? [{ role: roles[0], roleId: roles[0]!.id }]
          : [];
      }
      return [];
    },
    findOne: async (target: unknown, { where }: any = {}) => {
      if (target === Workspace) {
        return { id: "workspace-a", name: "Workspace A", slug: "workspace-a" };
      }
      if (target === Role) {
        return (
          roles.find(
            (item) =>
              item.id === where.id &&
              item.scope === where.scope &&
              item.workspaceId === where.workspaceId,
          ) ?? null
        );
      }
      return null;
    },
    transaction: async (work: (manager: unknown) => unknown) => work(manager),
  };
  const repositories = new Map<any, any>([
    [
      Invite,
      {
        create: (value: any) => ({
          id: `invite-${invites.length + 1}`,
          acceptedCount: 0,
          createdAt: new Date(),
          invitedBy: null,
          ...value,
        }),
        find: async () => invites,
        findOne: async ({ where }: any) =>
          invites.find(
            (item) =>
              item.email === where.email &&
              item.status === where.status &&
              item.workspaceId === where.workspaceId,
          ) ?? null,
        save: async (value: any) => {
          invites.push(value);
          return value;
        },
      },
    ],
    [Account, { findOne: async () => null }],
    [Workspace, {
      findOne: async () => ({
        id: "workspace-a",
        name: "Workspace A",
        slug: "workspace-a",
      }),
    }],
  ]);
  const workspaceContext = {
    current: () => ({ scopeLevel: "workspace", workspaceId: "workspace-a" }),
    run: (_context: unknown, work: () => unknown) => work(),
  };
  const service = new InviteService(
    { getRepository: (target: unknown) => repositories.get(target), manager } as never,
    workspaceContext as never,
    {
      send: async (input: unknown) => {
        sentEmails.push(input);
        return { sent: true };
      },
    } as never,
    {} as never,
    { getPlatformValue: async () => "http://localhost:3100" } as never,
    { assertCanGrant: () => undefined } as never,
  );
  return { sentEmails, service };
}
