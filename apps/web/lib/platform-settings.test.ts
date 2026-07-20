import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import { resolveWorkspaceApplicationsEnabled } from "./platform-settings";

describe("public platform settings", () => {
  it("keeps workspace applications open when the setting has not been created yet", () => {
    assert.equal(resolveWorkspaceApplicationsEnabled(undefined), true);
    assert.equal(resolveWorkspaceApplicationsEnabled([]), true);
  });

  it("uses the explicit platform workspace application setting", () => {
    assert.equal(
      resolveWorkspaceApplicationsEnabled([
        {
          id: "setting-1",
          name: PLATFORM_SETTING_KEYS.workspaceApplicationsEnabled,
          scope: "platform",
          value: "false",
          valueOptions: null,
          valueType: "boolean",
        },
      ]),
      false,
    );
  });
});
