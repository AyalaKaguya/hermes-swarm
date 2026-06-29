import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DEFAULT_PERMISSION_KEYS,
  defaultPermissionsForRole,
  Organization,
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { hashPassword } from "../common/security/password-hash.js";
import {
  createAuthSessionToken,
} from "../auth/auth-session.js";
import type {
  OnboardingPayload,
} from "../common/admin-api.types.js";
import { AuthService } from "../auth/auth.service.js";

@Controller("admin")
export class AdminController {
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
  ) {}

  @Get("bootstrap")
  async getPublicBootstrap() {
    const [organizationCount, userCount, organizations] = await Promise.all([
      this.organizationRepository.count(),
      this.userRepository.count(),
      this.organizationRepository.find({ order: { createdAt: "ASC" } }),
    ]);

    return {
      onboardingRequired: organizationCount === 0 || userCount === 0,
      organizations,
    };
  }

  @Post("onboarding")
  async onboard(@Body() payload: OnboardingPayload) {
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

    const token = createAuthSessionToken({ userId: user.id });
    return {
      snapshot: await this.authService.me(`Bearer ${token}`),
      token,
    };
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

    await this.assignPermissions(role, DEFAULT_PERMISSION_KEYS);
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

    await this.assignPermissions(
      role,
      defaultPermissionsForRole("owner").filter((permission) =>
        permission.endsWith(":organization"),
      ),
    );
    return role;
  }

  private async assignPermissions(role: Role, permissionKeys: readonly string[]) {
    const records = await Promise.all(
      permissionKeys.map((key) => this.getPermissionOrThrow(key)),
    );
    await this.rolePermissionRepository.save(
      records.map(({ key, permission }) =>
        this.rolePermissionRepository.create({
          enabled: true,
          organizationId: role.organizationId,
          permission: key,
          permissionId: permission.id,
          roleId: role.id,
        }),
      ),
    );
  }

  private async getPermissionOrThrow(key: string) {
    const [entity, action, scope] = key.split(":");
    const permission = await this.permissionRepository.findOne({
      where: {
        action: action as Permission["action"],
        entity,
        scope: scope as Permission["scope"],
      },
    });
    if (!permission) throw new BadRequestException("权限目录不存在");
    return { key, permission };
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
