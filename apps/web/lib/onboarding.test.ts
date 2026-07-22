import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createWorkspaceSlug,
  isWorkspaceSlug,
  resolveOnboardingLoginRedirect,
  validateOnboardingStep,
} from "./onboarding";

describe("onboarding workspace slug", () => {
  it("derives a stable editable slug from the workspace name", () => {
    assert.equal(createWorkspaceSlug("Acme Support Team"), "acme-support-team");
    assert.equal(createWorkspaceSlug("  Café Platform  "), "cafe-platform");
  });

  it("provides a safe fallback and validates the final value", () => {
    assert.equal(createWorkspaceSlug("首个工作空间"), "workspace");
    assert.equal(isWorkspaceSlug("acme-support"), true);
    assert.equal(isWorkspaceSlug("Acme Support"), false);
  });

  it("validates each onboarding step and skips credentials during resume", () => {
    const valid = {
      adminEmail: "admin@example.com",
      adminName: "Admin",
      adminPassword: "strong-password",
      confirmPassword: "strong-password",
      platformTitle: "Hermes",
      resumeMode: false,
      step: 0,
      workspaceName: "Acme",
      workspaceSlug: "acme",
    };
    assert.equal(validateOnboardingStep(valid), null);
    assert.equal(
      validateOnboardingStep({ ...valid, confirmPassword: "different" }),
      "passwordMismatch",
    );
    assert.equal(
      validateOnboardingStep({ ...valid, step: 1, workspaceSlug: "Bad Slug" }),
      "slugInvalid",
    );
    assert.equal(
      validateOnboardingStep({ ...valid, platformTitle: "", step: 2 }),
      "platformTitleRequired",
    );
    assert.equal(
      validateOnboardingStep({
        ...valid,
        adminEmail: "",
        adminName: "",
        adminPassword: "",
        confirmPassword: "",
        resumeMode: true,
      }),
      null,
    );
  });

  it("routes only the relevant first-start states", () => {
    assert.equal(
      resolveOnboardingLoginRedirect("admin_required", {
        context: null,
        next: null,
      }),
      "/onboarding",
    );
    assert.equal(
      resolveOnboardingLoginRedirect("workspace_required", {
        context: null,
        next: null,
      }),
      "/login?context=platform&next=%2Fonboarding",
    );
    assert.equal(
      resolveOnboardingLoginRedirect("workspace_required", {
        context: "platform",
        next: "/onboarding",
      }),
      null,
    );
    assert.equal(
      resolveOnboardingLoginRedirect("complete", { context: null, next: null }),
      null,
    );
  });
});
