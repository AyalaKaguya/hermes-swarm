import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GroupsService } from "./groups.service.js";

describe("GroupsService member consistency", () => {
  it("maps concurrent group name uniqueness failures during create", async () => {
    const state = createService({
      failGroupSaveWithUniqueError: true,
      memberships: [],
    });

    await assert.rejects(
      () =>
        state.service.create("org-1", "user-1", {
          displayName: "Support",
          name: "support",
        }),
      BadRequestException,
    );
  });

  it("maps concurrent group name uniqueness failures during update", async () => {
    const state = createService({
      failGroupSaveWithUniqueError: true,
      memberships: [],
    });

    await assert.rejects(
      () =>
        state.service.update("org-1", "group-1", {
          name: "renamed-support",
        }),
      BadRequestException,
    );
  });

  it("replaces group members inside a transaction", async () => {
    const state = createService({
      memberships: [
        {
          id: "membership-1",
          organizationId: "org-1",
          role: null,
          user: null,
          userId: "user-1",
        },
      ],
    });

    const result = await state.service.replaceMembers("org-1", "group-1", {
      membershipIds: ["membership-1"],
    });

    assert.equal(state.transactions, 1);
    assert.deepEqual(state.deletedGroupMemberQueries, [
      { groupId: "group-1", organizationId: "org-1" },
    ]);
    assert.equal(state.savedGroupMembers.length, 1);
    assert.equal(state.savedGroupMembers[0].membershipId, "membership-1");
    assert.deepEqual(result, []);
  });

  it("clears group members atomically when the replacement list is empty", async () => {
    const state = createService({ memberships: [] });

    await state.service.replaceMembers("org-1", "group-1", {
      membershipIds: [],
    });

    assert.equal(state.transactions, 1);
    assert.deepEqual(state.deletedGroupMemberQueries, [
      { groupId: "group-1", organizationId: "org-1" },
    ]);
    assert.equal(state.savedGroupMembers.length, 0);
  });

  it("does not delete existing group members when payload contains outside memberships", async () => {
    const state = createService({ memberships: [] });

    await assert.rejects(
      () =>
        state.service.replaceMembers("org-1", "group-1", {
          membershipIds: ["membership-outside"],
        }),
      BadRequestException,
    );

    assert.equal(state.transactions, 0);
    assert.equal(state.deletedGroupMemberQueries.length, 0);
    assert.equal(state.savedGroupMembers.length, 0);
  });

  it("removes group and group members inside one transaction", async () => {
    const state = createService({ memberships: [] });

    await state.service.remove("org-1", "group-1");

    assert.equal(state.transactions, 1);
    assert.deepEqual(state.deletedGroupMemberQueries, [
      { groupId: "group-1", organizationId: "org-1" },
    ]);
    assert.deepEqual(state.deletedGroupQueries, [
      { id: "group-1", organizationId: "org-1" },
    ]);
  });
});

function createService(options: {
  failGroupSaveWithUniqueError?: boolean;
  memberships: Array<{
    id: string;
    organizationId: string;
    role: unknown;
    user: unknown;
    userId: string;
  }>;
}) {
  const deletedGroupMemberQueries: unknown[] = [];
  const deletedGroupQueries: unknown[] = [];
  const savedGroupMembers: any[] = [];
  let transactions = 0;

  const service = new GroupsService(
    {
      async findOne({ where }: any) {
        return where.id === "org-1" ? { id: "org-1", name: "Hermes" } : null;
      },
    } as any,
    {
      create(value: any) {
        return {
          color: null,
          createdAt: new Date("2026-07-01T00:00:00Z"),
          id: `group-${savedGroupMembers.length + 1}`,
          updatedAt: new Date("2026-07-01T00:00:00Z"),
          ...value,
        };
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          transactions += 1;
          return callback({
            async delete(target: { name?: string }, query: unknown) {
              if (target.name === "OrganizationGroupMember") {
                deletedGroupMemberQueries.push(query);
              } else {
                deletedGroupQueries.push(query);
              }
            },
            async save(_target: unknown, values: any[]) {
              savedGroupMembers.push(...values);
              return values;
            },
          });
        },
      },
      async findOne({ where }: any) {
        if (where.name === "support" && where.organizationId === "org-1") {
          return null;
        }
        return where.id === "group-1" && where.organizationId === "org-1"
          ? {
              color: null,
              createdAt: new Date("2026-07-01T00:00:00Z"),
              createdByUserId: "user-1",
              description: null,
              displayName: "Support",
              id: "group-1",
              name: "support",
              organizationId: "org-1",
              updatedAt: new Date("2026-07-01T00:00:00Z"),
            }
          : null;
      },
      async save(group: any) {
        if (options.failGroupSaveWithUniqueError) {
          throw { driverError: { code: "23505" } };
        }
        return group;
      },
    } as any,
    {
      create(value: any) {
        return value;
      },
      async count() {
        return 0;
      },
      async find() {
        return [];
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          transactions += 1;
          return callback({
            async delete(_target: unknown, query: unknown) {
              deletedGroupMemberQueries.push(query);
            },
            async save(_target: unknown, values: any[]) {
              savedGroupMembers.push(...values);
              return values;
            },
          });
        },
      },
    } as any,
    {
      async find({ where }: any) {
        return options.memberships.filter(
          (membership) => membership.organizationId === where.organizationId,
        );
      },
    } as any,
  );

  return {
    get transactions() {
      return transactions;
    },
    deletedGroupMemberQueries,
    deletedGroupQueries,
    savedGroupMembers,
    service,
  };
}
