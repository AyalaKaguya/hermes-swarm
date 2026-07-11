import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformMembersService } from "./platform-members.service.js";

describe("PlatformMembersService independent platform users", () => {
  it("creates a platform account without creating a tenant user", async () => {
    const users: any[] = [];
    const service = createService({ users });

    const result = await service.create({
      displayName: "Platform Operator",
      email: "operator@example.com",
      password: "password-123",
    });

    assert.equal(result.email, "operator@example.com");
    assert.equal(users.length, 1);
    assert.equal("tenantId" in users[0], false);
    assert.match(users[0].passwordHash, /^pbkdf2_sha256\$/);
  });

  it("does not disable the final active platform administrator", async () => {
    const admin = {
      displayName: "Admin",
      email: "admin@example.com",
      id: "platform-user-1",
      roles: [{ platformRole: { id: "role-admin", name: "platform-admin" } }],
      status: "active",
    };
    const service = createService({ users: [admin] });

    await assert.rejects(
      () => service.update(admin.id, { status: "disabled" }),
      BadRequestException,
    );
  });
});

function createService({ users }: { users: any[] }) {
  const manager = {
    create: (_target: unknown, value: any) => value,
    delete: async () => ({ affected: 1 }),
    find: async () => users,
    findOne: async (_target: unknown, { where }: any) =>
      users.find((item) => item.id === where.id) ?? null,
    save: async (_target: unknown, value: any) => value,
    softDelete: async () => ({ affected: 1 }),
    transaction: async (work: any) => work(manager),
  };
  const userRepository = {
    create: (value: any) => value,
    find: async () => users,
    findOne: async ({ where }: any) =>
      users.find((item) =>
        Object.entries(where).every(([key, value]) => item[key] === value),
      ) ?? null,
    manager,
    save: async (value: any) => {
      const saved = { id: value.id ?? `platform-user-${users.length + 1}`, ...value };
      users.push(saved);
      return saved;
    },
  };
  return new PlatformMembersService(
    userRepository as any,
    { manager } as any,
    {
      create: (value: any) => value,
      findOne: async () => null,
      save: async (value: any) => value,
    } as any,
  );
}
