import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { resolveWorkspaceEmailContext } from "./email-send.service.js";

describe("workspace email context", () => {
  it("uses the trusted workspace context rather than a caller-selected id", () => {
    assert.equal(
      resolveWorkspaceEmailContext(
        { scopeLevel: "workspace", workspaceId: "workspace-a" },
        "workspace-a",
      ),
      "workspace-a",
    );
    assert.equal(resolveWorkspaceEmailContext(null, "workspace-a"), null);
  });

  it("rejects a workspace id that conflicts with the trusted context", () => {
    assert.throws(
      () =>
        resolveWorkspaceEmailContext(
          { scopeLevel: "workspace", workspaceId: "workspace-a" },
          "workspace-b",
        ),
      BadRequestException,
    );
  });
});
