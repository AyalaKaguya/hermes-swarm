import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

describe("AuthService interactive session guard", () => {
  it("rejects integration tokens from login session management", async () => {
    const service = new AuthService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          integrationToken: {
            id: "token-1",
            organizationId: null,
            permissions: ["page.home.access:own"],
            scope: "own",
          },
          sessionId: "integration:token-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      } as any,
      {} as any,
    );

    await assert.rejects(
      () => service.listSessions("Bearer integration-token"),
      UnauthorizedException,
    );
  });
});
