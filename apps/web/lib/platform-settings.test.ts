import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLATFORM_SETTING_KEYS,
  PLATFORM_SLOGAN_SETTING_KEY,
  PLATFORM_TITLE_SETTING_KEY,
} from "@hermes-swarm/core/settings/definitions";
import {
  resolvePlatformNameFromSettings,
  resolvePlatformSloganFromSettings,
  resolveWorkspaceApplicationsEnabled,
} from "./platform-settings";

describe("public platform settings", () => {
  it("resolves the configured platform name for every authenticated shell", () => {
    const settings = [
      {
        id: "setting-1",
        name: PLATFORM_TITLE_SETTING_KEY,
        scope: "platform" as const,
        value: "  Jiangsen Intelligence  ",
        valueOptions: null,
        valueType: "string" as const,
      },
      {
        id: "setting-2",
        name: `${PLATFORM_TITLE_SETTING_KEY}.zh-Hans`,
        scope: "platform" as const,
        value: "江森智能",
        valueOptions: null,
        valueType: "string" as const,
      },
    ];

    assert.equal(
      resolvePlatformNameFromSettings(settings),
      "Jiangsen Intelligence",
    );
    assert.equal(
      resolvePlatformNameFromSettings(settings, "zh-Hans"),
      "江森智能",
    );
  });

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

  it("uses a configured platform slogan and treats an empty one as unset", () => {
    assert.equal(resolvePlatformSloganFromSettings(undefined), null);
    assert.equal(
      resolvePlatformSloganFromSettings([
        {
          id: "setting-1",
          name: PLATFORM_SLOGAN_SETTING_KEY,
          scope: "platform",
          value: "  AI support for every workspace  ",
          valueOptions: null,
          valueType: "string",
        },
      ]),
      "AI support for every workspace",
    );
    assert.equal(
      resolvePlatformSloganFromSettings([
        {
          id: "setting-1",
          name: PLATFORM_SLOGAN_SETTING_KEY,
          scope: "platform",
          value: "   ",
          valueOptions: null,
          valueType: "string",
        },
      ]),
      null,
    );
  });
});
