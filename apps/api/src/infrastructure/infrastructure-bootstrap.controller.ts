import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  AccessOperation,
  AccessResource,
  PublicAccess,
} from "@hermes-swarm/rbac";
import type {
  OnboardingPayload,
  ResumeOnboardingPayload,
} from "../common/admin-api.types.js";
import { AuthService } from "./auth/auth.service.js";
import { OnboardingService } from "./onboarding/onboarding.service.js";
import { SettingsService } from "./settings/settings.service.js";

type PlatformPrincipalRequest = {
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "workspace";
    userId?: string;
  };
};

@Controller("admin")
export class InfrastructureBootstrapController {
  constructor(
    private readonly authService: AuthService,
    private readonly onboardingService: OnboardingService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get("bootstrap")
  @PublicAccess({ reason: "Bootstrap state is required before a platform operator can log in." })
  async getPublicBootstrap() {
    const [onboardingState, systemSettings] = await Promise.all([
      this.onboardingService.getState(),
      this.settingsService.listPlatformSettings(),
    ]);
    return {
      onboardingRequired: onboardingState === "admin_required",
      onboardingState,
      systemSettings,
    };
  }

  @Post("onboarding")
  @PublicAccess({ reason: "Initial onboarding is allowed only while no platform administrator or workspace exists." })
  async onboard(
    @Body() payload: OnboardingPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    const provisioned = await this.onboardingService.create(payload);
    return this.authService.createWorkspaceLoginResponse(
      provisioned.account,
      provisioned.membership,
      request,
      response,
    );
  }

  @Post("onboarding/resume")
  @AccessResource({
    entity: "onboarding",
    entityLabel: "初始化",
    purpose: "platform_bootstrap",
    purposeLabel: "平台初始化",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    description: "为已存在的平台主管理员补建首个工作空间。",
    isDangerous: true,
    label: "续办平台初始化",
    operation: "resume",
  })
  async resume(
    @Body() payload: ResumeOnboardingPayload,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: PlatformPrincipalRequest,
    @Res({ passthrough: true }) response: any,
  ) {
    const provisioned = await this.onboardingService.resume(
      requirePlatformAccountId(request),
      payload,
    );
    return this.authService.switchContext(
      authorization,
      {
        contextType: "workspace",
        membershipId: provisioned.membership.id,
      },
      request,
      response,
    );
  }
}

function requirePlatformAccountId(request: PlatformPrincipalRequest) {
  if (request.accessPrincipal?.principalType !== "platform") {
    throw new Error("Platform principal was not established by the access guard.");
  }
  const accountId = request.accessPrincipal.userId?.trim();
  if (!accountId) throw new Error("Platform principal is missing an account id.");
  return accountId;
}
