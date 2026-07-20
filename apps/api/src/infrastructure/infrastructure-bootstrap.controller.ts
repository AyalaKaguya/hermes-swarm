import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Permission,
  PlatformRole,
  PlatformRolePermission,
  PlatformUser,
  PlatformUserRole,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { PublicAccess } from "@hermes-swarm/rbac";
import type { OnboardingPayload } from "../common/admin-api.types.js";
import { hashPassword } from "../common/security/password-hash.js";
import { AuthService } from "./auth/auth.service.js";
import { SettingsService } from "./settings/settings.service.js";
import { PLATFORM_DATA_SOURCE } from "../common/database/database.constants.js";

@Controller("admin")
export class InfrastructureBootstrapController {
  constructor(
    @InjectRepository(PlatformUser, PLATFORM_DATA_SOURCE)
    private readonly platformUserRepository: Repository<PlatformUser>,
    @InjectRepository(PlatformRole, PLATFORM_DATA_SOURCE)
    private readonly platformRoleRepository: Repository<PlatformRole>,
    @InjectRepository(PlatformUserRole, PLATFORM_DATA_SOURCE)
    private readonly platformUserRoleRepository: Repository<PlatformUserRole>,
    @InjectRepository(Permission, PLATFORM_DATA_SOURCE)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(PlatformRolePermission, PLATFORM_DATA_SOURCE)
    private readonly platformRolePermissionRepository: Repository<PlatformRolePermission>,
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get("bootstrap")
  @PublicAccess({ reason: "Bootstrap state is required before a platform operator can log in." })
  async getPublicBootstrap() {
    const [platformUserCount, systemSettings] = await Promise.all([
      this.platformUserRepository.count(),
      this.settingsService.listPlatformSettings(),
    ]);
    return {
      onboardingRequired: platformUserCount === 0,
      organizations: [],
      systemSettings,
    };
  }

  @Post("onboarding")
  @PublicAccess({ reason: "Initial platform onboarding is allowed only before the first platform account exists." })
  async onboard(
    @Body() payload: OnboardingPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    if ((await this.platformUserRepository.count()) > 0) {
      throw new BadRequestException("平台已经完成初始化");
    }
    const displayName = requireText(payload.adminName, "管理员名称");
    const email = normalizeEmail(payload.adminEmail);
    const password = requirePassword(payload.adminPassword);

    await this.platformUserRepository.manager.transaction(async (manager) => {
      const user = await manager.save(
        PlatformUser,
        manager.create(PlatformUser, {
          displayName,
          email,
          passwordHash: await hashPassword(password),
          preferredLanguage: "zh-CN",
          status: "active",
        }),
      );
      const role = await manager.save(
        PlatformRole,
        manager.create(PlatformRole, {
          description: "Platform administrator with all platform permissions.",
          isSystem: true,
          label: "Platform Admin",
          name: "platform-admin",
        }),
      );
      await manager.save(
        PlatformUserRole,
        manager.create(PlatformUserRole, {
          platformRoleId: role.id,
          platformUserId: user.id,
        }),
      );
      const permissions = await manager.find(Permission, {
        where: { scope: "platform" },
      });
      const rows = permissions
        .filter((permission) => permission.defaultRoles?.includes("platform-admin"))
        .map((permission) =>
          this.platformRolePermissionRepository.create({
            enabled: true,
            permissionId: permission.id,
            platformRoleId: role.id,
          }),
        );
      if (rows.length) await manager.save(PlatformRolePermission, rows);
    });

    return this.authService.loginPlatform(
      { email, password },
      request,
      response,
    );
  }
}

function normalizeEmail(value: string | undefined) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function requireText(value: string | undefined | null, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}
