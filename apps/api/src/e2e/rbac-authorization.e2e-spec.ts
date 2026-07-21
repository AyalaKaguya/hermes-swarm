import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthSessionService } from "../infrastructure/auth/auth-session.service.js";
import { InviteController } from "../infrastructure/invite/invite.controller.js";
import { InviteService } from "../infrastructure/invite/invite.service.js";
import { UsersController } from "../infrastructure/users/users.controller.js";
import { UsersService } from "../infrastructure/users/users.service.js";

describe("workspace admin route contract e2e", { concurrency: false }, () => {
  let app: INestApplication;
  const calls: Array<{ method: string; value?: unknown }> = [];

  before(async () => {
    const users = {
      list: async () => [{
        account: { email: "owner@example.com", id: "account-1" },
        membershipId: "membership-1",
        role: null,
        status: "active",
      }],
      removeMembership: async (_authorization: string, membershipId: string) =>
        calls.push({ method: "removeMembership", value: membershipId }),
      replaceWorkspaceRole: async (
        _authorization: string,
        membershipId: string,
        roleId: string,
      ) => ({ membershipId, roleId }),
      updateMembershipStatus: async (
        _authorization: string,
        membershipId: string,
        status: string,
      ) => ({ membershipId, status }),
    };
    const invites = {
      create: async (userId: string, value: unknown) => ({ id: "invite-1", invitedById: userId, ...value as object }),
      list: async () => [{ email: "member@example.com", id: "invite-1", status: "invited" }],
      resend: async (inviteId: string, userId: string) => ({ id: inviteId, invitedById: userId, status: "invited" }),
      revoke: async (inviteId: string) => calls.push({ method: "revokeInvite", value: inviteId }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [InviteController, UsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: InviteService, useValue: invites },
        {
          provide: AuthSessionService,
          useValue: { validateAccessToken: async () => ({ userId: "user-1" }) },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  after(async () => {
    await app?.close();
  });

  it("exposes workspace member CRUD and role replacement", async () => {
    await request(app.getHttpServer()).get("/admin/workspace/members").expect(200).expect(({ body }) => {
      assert.equal(body[0].membershipId, "membership-1");
    });
    await request(app.getHttpServer())
      .patch("/admin/workspace/members/membership-2/status")
      .set("Authorization", "Bearer token")
      .send({ status: "disabled" })
      .expect(200)
      .expect(({ body }) => assert.equal(body.status, "disabled"));
    await request(app.getHttpServer())
      .put("/admin/workspace/members/membership-2/role")
      .set("Authorization", "Bearer token")
      .send({ roleId: "role-1" })
      .expect(200)
      .expect(({ body }) => assert.equal(body.roleId, "role-1"));
    await request(app.getHttpServer())
      .delete("/admin/workspace/members/membership-2")
      .set("Authorization", "Bearer token")
      .expect(204);
    assert.deepEqual(
      calls.find((call) => call.method === "removeMembership")?.value,
      "membership-2",
    );
  });

  it("exposes one workspace invite with one workspace role", async () => {
    await request(app.getHttpServer()).get("/admin/invites").expect(200);
    await request(app.getHttpServer())
      .post("/admin/invites")
      .set("Authorization", "Bearer token")
      .send({
        email: "member@example.com",
        workspaceRoleId: "role-workspace",
      })
      .expect(201)
      .expect(({ body }) => {
        assert.equal(body.invitedById, "user-1");
        assert.equal(body.workspaceRoleId, "role-workspace");
      });
    await request(app.getHttpServer())
      .post("/admin/invites/invite-1/resend")
      .set("Authorization", "Bearer token")
      .expect(201);
    await request(app.getHttpServer()).delete("/admin/invites/invite-1").expect(204);
    assert.deepEqual(calls.find((call) => call.method === "revokeInvite")?.value, "invite-1");
  });
});
