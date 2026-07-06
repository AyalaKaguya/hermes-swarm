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
  Organization,
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { AuthService } from "./auth/auth.service.js";
import type { OnboardingPayload } from "../common/admin-api.types.js";
import { hashPassword } from "../common/security/password-hash.js";
import { SettingsService } from "./settings/settings.service.js";

@Controller("admin")
export class InfrastructureBootstrapController {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get("bootstrap")
  async getPublicBootstrap() {
    const [organizationCount, userCount, organizations, systemSettings] =
      await Promise.all([
        this.organizationRepository.count(),
        this.userRepository.count(),
        this.organizationRepository.find({ order: { createdAt: "ASC" } }),
        this.settingsService.listPlatformSettings(),
      ]);

    return {
      onboardingRequired: organizationCount === 0 || userCount === 0,
      organizations,
      systemSettings,
    };
  }

  @Post("onboarding")
  async onboard(
    @Body() payload: OnboardingPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    const [organizationCount, userCount] = await Promise.all([
      this.organizationRepository.count(),
      this.userRepository.count(),
    ]);
    if (organizationCount > 0 || userCount > 0) {
      throw new BadRequestException("系统已经完成初始化");
    }

    const displayName = requireText(payload.adminName, "管理员名称");
    const email = normalizeEmail(payload.adminEmail);
    const password = requirePassword(payload.adminPassword);
    const organizationName = requireText(payload.organizationName, "组织名称");
    const organizationSlug = normalizeSlug(
      payload.organizationSlug ?? organizationName,
      "org",
    );

    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName,
        email,
        emailVerified: true,
        nickname: displayName,
        passwordHash: hashPassword(password),
        preferredLanguage: "zh-CN",
        status: "active",
        type: "user",
      }),
    );

    const organization = await this.organizationRepository.save(
      this.organizationRepository.create({
        createdByUserId: user.id,
        isDefault: true,
        name: organizationName,
        slug: organizationSlug,
        status: "active",
      }),
    );

    const platformRole = await this.createPlatformAdminRole();
    await this.platformMemberRepository.save(
      this.platformMemberRepository.create({
        displayName,
        roleId: platformRole.id,
        status: "active",
        userId: user.id,
      }),
    );

    const ownerRole = await this.createOrganizationOwnerRole(organization.id);
    await this.membershipRepository.save(
      this.membershipRepository.create({
        displayName,
        joinedAt: new Date(),
        organizationId: organization.id,
        roleId: ownerRole.id,
        status: "active",
        userId: user.id,
      }),
    );

    return this.authService.createLoginResponse(user, request, response);
  }

  private async createPlatformAdminRole() {
    const role = await this.roleRepository.save(
      this.roleRepository.create({
        color: "#7c3aed",
        description: "Platform administrator with all platform permissions.",
        displayName: "Platform Admin",
        isSystem: true,
        label: "Platform Admin",
        name: "platform-admin",
        organizationId: null,
        scope: "platform",
      }),
    );

    await this.assignDefaultPermissions(role);
    return role;
  }

  private async createOrganizationOwnerRole(organizationId: string) {
    const role = await this.roleRepository.save(
      this.roleRepository.create({
        color: "#2563eb",
        description: "Organization owner with all organization permissions.",
        displayName: "Owner",
        isSystem: true,
        label: "Owner",
        name: "owner",
        organizationId,
        scope: "organization",
      }),
    );

    await this.assignDefaultPermissions(role);
    return role;
  }

  private async assignDefaultPermissions(role: Role) {
    const records = await this.permissionRepository.find({
      order: { code: "ASC" },
      where:
        role.scope === "organization"
          ? [{ scope: "organization" }, { scope: "own" }]
          : { scope: role.scope as Permission["scope"] },
    });
    const permissions = records.filter((permission) =>
      permission.defaultRoles?.includes(role.name),
    );
    await this.rolePermissionRepository.save(
      permissions.map((permission) =>
        this.rolePermissionRepository.create({
          enabled: true,
          organizationId: role.organizationId,
          permission: permission.code ?? "",
          permissionId: permission.id,
          roleId: role.id,
        }),
      ),
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

function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}
