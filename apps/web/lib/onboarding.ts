import type { PublicBootstrap } from "@hermes-swarm/api-contracts";

export type OnboardingValidationIssue =
  | "adminRequired"
  | "emailInvalid"
  | "passwordLength"
  | "passwordMismatch"
  | "platformTitleRequired"
  | "slugInvalid"
  | "workspaceRequired";

export function createWorkspaceSlug(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "workspace";
}

export function isWorkspaceSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
}

export function validateOnboardingStep(input: {
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  confirmPassword: string;
  platformTitle: string;
  resumeMode: boolean;
  step: number;
  workspaceName: string;
  workspaceSlug: string;
}): OnboardingValidationIssue | null {
  if (input.step === 0 && !input.resumeMode) {
    if (!input.adminName.trim() || !input.adminEmail.trim() || !input.adminPassword) {
      return "adminRequired";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.adminEmail.trim())) {
      return "emailInvalid";
    }
    if (input.adminPassword.length < 8) return "passwordLength";
    if (input.adminPassword !== input.confirmPassword) return "passwordMismatch";
  }
  if (input.step === 1) {
    if (!input.workspaceName.trim() || !input.workspaceSlug.trim()) {
      return "workspaceRequired";
    }
    if (!isWorkspaceSlug(input.workspaceSlug.trim())) return "slugInvalid";
  }
  if (input.step === 2 && !input.platformTitle.trim()) {
    return "platformTitleRequired";
  }
  return null;
}

export function resolveOnboardingLoginRedirect(
  state: PublicBootstrap["onboardingState"],
  current: { context: string | null; next: string | null },
) {
  if (state === "admin_required") return "/onboarding";
  if (
    state === "workspace_required" &&
    (current.context !== "platform" || current.next !== "/onboarding")
  ) {
    return "/login?context=platform&next=%2Fonboarding";
  }
  return null;
}
