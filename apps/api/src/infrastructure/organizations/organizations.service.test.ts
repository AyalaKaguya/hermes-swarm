import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Organization, Ticket, UserOrganization } from "@hermes-swarm/core";
import { OrganizationsService } from "./organizations.service.js";

describe("OrganizationsService lightweight tree", () => {
  it("requires a same-tenant active parent when creating a child", async () => {
    const state = createState();
    await assert.rejects(
      state.service.create("user-a", { name: "No parent", slug: "no-parent" }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.create("user-a", { name: "Cross tenant", parentOrganizationId: "other-tenant", slug: "cross" }),
      NotFoundException,
    );
    const child = await state.service.create("user-a", {
      name: "Engineering",
      parentOrganizationId: "root",
      slug: "Engineering",
    });
    assert.equal(child.parentOrganizationId, "root");
    assert.equal(child.slug, "engineering");
  });

  it("protects the root organization", async () => {
    const state = createState();
    await assert.rejects(
      state.service.update("root", { status: "suspended" }),
      BadRequestException,
    );
    await assert.rejects(
      state.service.update("root", { parentOrganizationId: "child" }),
      BadRequestException,
    );
    await assert.rejects(state.service.delete("root"), BadRequestException);
  });

  it("rejects self-parenting, cycles and referenced organization deletion", async () => {
    const state = createState();
    await assert.rejects(
      state.service.update("child", { parentOrganizationId: "child" }),
      BadRequestException,
    );
    state.cycle = true;
    await assert.rejects(
      state.service.update("child", { parentOrganizationId: "sibling" }),
      BadRequestException,
    );
    state.cycle = false;
    state.membershipCount = 1;
    await assert.rejects(state.service.delete("child"), ConflictException);
  });
});

function createState() {
  const organizations: Array<Record<string, any>> = [
    { id: "root", name: "Root", parentOrganizationId: null, slug: "root", status: "active", tenantId: "tenant-a" },
    { id: "child", name: "Child", parentOrganizationId: "root", slug: "child", status: "active", tenantId: "tenant-a" },
    { id: "sibling", name: "Sibling", parentOrganizationId: "root", slug: "sibling", status: "active", tenantId: "tenant-a" },
    { id: "other-tenant", name: "Other", parentOrganizationId: null, slug: "other", status: "active", tenantId: "tenant-b" },
  ];
  const state = { cycle: false, membershipCount: 0 };
  const organizationRepository = {
    count: async ({ where }: any) => organizations.filter((item) => item.tenantId === where.tenantId && item.parentOrganizationId === where.parentOrganizationId).length,
    create: (value: Record<string, unknown>) => ({ id: `org-${organizations.length}`, ...value }),
    find: async () => organizations.filter((item) => item.tenantId === "tenant-a"),
    findOne: async ({ where }: any) => organizations.find((item) => item.tenantId === where.tenantId && (where.id ? item.id === where.id : item.slug === where.slug)) ?? null,
    save: async (value: Record<string, any>) => {
      const index = organizations.findIndex((item) => item.id === value.id);
      if (index >= 0) organizations[index] = value;
      else organizations.push(value);
      return value;
    },
    softRemove: async () => undefined,
  };
  const memberships: Array<Record<string, any>> = [];
  const membershipRepository = {
    count: async () => state.membershipCount,
    create: (value: Record<string, unknown>) => ({ id: `membership-${memberships.length + 1}`, ...value }),
    save: async (value: Record<string, any>) => { memberships.push(value); return value; },
  };
  const manager = {
    insert: async () => ({ identifiers: [] }),
    query: async () => state.cycle ? [{ id: "cycle" }] : [],
  };
  const tenantContext = {
    current: () => ({
      manager,
      tenantId: "tenant-a",
    }),
    repository: (target: unknown) => {
      if (target === Organization) return organizationRepository;
      if (target === UserOrganization) return membershipRepository;
      if (target === Ticket) return { count: async () => 0 };
      throw new Error("unexpected repository");
    },
  };
  return {
    get cycle() { return state.cycle; },
    set cycle(value: boolean) { state.cycle = value; },
    get membershipCount() { return state.membershipCount; },
    set membershipCount(value: number) { state.membershipCount = value; },
    service: new OrganizationsService(
      tenantContext as never,
      {
        bootstrap: async (organizationId: string) => new Map([
          ["owner", { id: `owner-${organizationId}` }],
        ]),
      } as never,
    ),
  };
}
