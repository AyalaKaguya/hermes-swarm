import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  PasswordReset,
  Role,
  RolePermission,
  Tenant,
  TenantApplication,
  User,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { IsNull, Repository, type EntityManager } from "typeorm";
import type {
  TenantApplicationPayload,
  TenantApplicationReviewPayload,
  TenantRolePayload,
  TenantRolePermissionsPayload,
  UpdateTenantPayload,
} from "./tenants.controller.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { createPasswordResetToken } from "../password-reset/password-reset-token.js";
import { PlatformEmailSendService } from "../mail/platform-email-send.service.js";

const RESERVED_TENANT_ROLE_NAMES = new Set([
  "tenant-owner",
  "tenant-admin",
  "tenant-member",
]);

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant, PLATFORM_DATA_SOURCE)
    private readonly platformTenantRepository: Repository<Tenant>,
    @InjectRepository(TenantApplication, PLATFORM_DATA_SOURCE)
    private readonly applicationRepository: Repository<TenantApplication>,
    @InjectRepository(Organization, PLATFORM_DATA_SOURCE)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(User, PLATFORM_DATA_SOURCE)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserOrganization, PLATFORM_DATA_SOURCE)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(Role, PLATFORM_DATA_SOURCE)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission, PLATFORM_DATA_SOURCE)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission, PLATFORM_DATA_SOURCE)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(PasswordReset, PLATFORM_DATA_SOURCE)
    private readonly passwordResetRepository: Repository<PasswordReset>,
    private readonly tenantContext: TenantContextService,
    private readonly platformEmailSendService: PlatformEmailSendService,
  ) {}

  async apply(payload: TenantApplicationPayload) {
    const requestedName = requireText(payload?.requestedName, "租户名称");
    const requestedSlug = normalizeSlug(payload?.requestedSlug ?? requestedName);
    const ownerEmail = normalizeEmail(payload?.ownerEmail);
    const ownerDisplayName = requireText(payload?.ownerDisplayName, "负责人名称");
    const requestedSubdomain = normalizeNullableSlug(payload?.requestedSubdomain);
    const preferredLanguage = normalizeApplicationLanguage(payload?.preferredLanguage);
    await this.assertTenantIdentityAvailable(requestedSlug, requestedSubdomain);

    const token = randomBytes(32).toString("base64url");
    const cancellationToken = randomBytes(32).toString("base64url");
    const application = await this.applicationRepository.save(
      this.applicationRepository.create({
        cancellationTokenHash: hashToken(cancellationToken),
        emailVerificationTokenHash: hashToken(token),
        emailVerifiedAt: null,
        ownerDisplayName,
        ownerEmail,
        preferredLanguage,
        requestedName,
        requestedSlug,
        requestedSubdomain,
        reviewedAt: null,
        reviewedByPlatformUserId: null,
        reviewNote: null,
        status: "pending_email_verification",
        tenantId: null,
      }),
    );
    const links = buildTenantApplicationLinks(
      application.id,
      token,
      cancellationToken,
    );
    const emailDelivery = await this.sendPlatformEmailSafely({
      email: ownerEmail,
      languageCode: preferredLanguage,
      locals: {
        ...links,
        ownerDisplayName,
        requestedName,
      },
      templateName: "tenant-application-verification",
    });
    return {
      applicationId: application.id,
      cancellationToken:
        process.env.NODE_ENV === "production" ? undefined : cancellationToken,
      // Development-only delivery contract until the tenant mail workflow is wired.
      verificationToken: process.env.NODE_ENV === "production" ? undefined : token,
      verificationEmailSent: emailDelivery.sent,
    };
  }

  async cancelApplication(applicationId: string, token: unknown) {
    const value = requireText(token, "取消令牌");
    return this.withLockedApplication(applicationId, async (application, manager) => {
      if (
        application.status !== "pending_email_verification" &&
        application.status !== "pending_review"
      ) {
        throw new BadRequestException("租户申请当前不能取消");
      }
      if (!tokenMatches(application.cancellationTokenHash, value)) {
        throw new BadRequestException("取消令牌无效");
      }
      application.cancellationTokenHash = null;
      application.emailVerificationTokenHash = null;
      application.status = "cancelled";
      return manager.save(TenantApplication, application);
    });
  }

  async verifyApplication(applicationId: string, token: unknown) {
    const value = requireText(token, "验证令牌");
    return this.withLockedApplication(applicationId, async (application, manager) => {
      if (application.status !== "pending_email_verification") {
        throw new BadRequestException("租户申请当前不能验证");
      }
      if (!tokenMatches(application.emailVerificationTokenHash, value)) {
        throw new BadRequestException("验证令牌无效");
      }
      application.emailVerifiedAt = new Date();
      application.emailVerificationTokenHash = null;
      application.status = "pending_review";
      return manager.save(TenantApplication, application);
    });
  }

  listApplications() {
    return this.applicationRepository.find({ order: { createdAt: "DESC" } });
  }

  listTenants() {
    return this.platformTenantRepository.find({ order: { createdAt: "DESC" } });
  }

  async updateTenantStatus(tenantId: string, status: unknown) {
    if (status !== "active" && status !== "suspended" && status !== "archived") {
      throw new BadRequestException("租户状态无效");
    }
    const id = requireText(tenantId, "租户");
    return this.platformTenantRepository.manager.transaction(async (manager) => {
      const tenant = await manager.findOne(Tenant, {
        lock: { mode: "pessimistic_write" },
        where: { id },
      });
      if (!tenant) throw new NotFoundException("租户不存在");
      if (tenant.status === status) return tenant;
      if (!isAllowedTenantStatusTransition(tenant.status, status)) {
        throw new BadRequestException(
          tenant.status === "provisioning"
            ? "租户必须由 Owner 完成激活后才能启用或挂起"
            : "租户状态转换无效",
        );
      }
      tenant.status = status;
      return manager.save(Tenant, tenant);
    });
  }

  async approveApplication(
    platformUserId: string,
    applicationId: string,
    payload: TenantApplicationReviewPayload,
  ) {
    const result = await this.platformTenantRepository.manager.transaction(async (manager) => {
      const application = await this.findLockedApplication(applicationId, manager);
      if (application.status !== "pending_review" || !application.emailVerifiedAt) {
        throw new BadRequestException("租户申请尚未完成验证或已经处理");
      }
      await this.assertTenantIdentityAvailable(
        application.requestedSlug,
        application.requestedSubdomain,
        manager,
      );
      const reviewerId = requireText(platformUserId, "平台用户");
      const tenant = await manager.save(
        Tenant,
        this.platformTenantRepository.create({
          name: application.requestedName,
          slug: application.requestedSlug,
          status: "provisioning",
          subdomain: application.requestedSubdomain,
        }),
      );
      const user = await manager.save(
        User,
        this.userRepository.create({
          displayName: application.ownerDisplayName,
          email: application.ownerEmail,
          emailVerified: true,
          nickname: application.ownerDisplayName,
          passwordHash: null,
          preferredLanguage: application.preferredLanguage,
          status: "active",
          tenantId: tenant.id,
          type: "user",
        }),
      );
      const ownerActivationToken = createPasswordResetToken({
        email: user.email,
        tenantId: tenant.id,
        userId: user.id,
      });
      const organization = await manager.save(
        Organization,
        this.organizationRepository.create({
          createdByUserId: user.id,
          isDefault: true,
          name: normalizeOptionalName(payload?.organizationName) ?? tenant.name,
          slug: normalizeSlug(payload?.organizationName ?? tenant.slug),
          status: "active",
          tenantId: tenant.id,
        }),
      );
      const tenantOwnerRole = await manager.save(
        Role,
        this.roleRepository.create({
          color: "#7c3aed",
          departmentId: null,
          description: "Tenant owner with tenant governance access.",
          displayName: "Tenant Owner",
          isSystem: true,
          label: "Tenant Owner",
          name: "tenant-owner",
          organizationId: null,
          scope: "tenant",
          tenantId: tenant.id,
        }),
      );
      const ownerRole = await manager.save(
        Role,
        this.roleRepository.create({
          color: "#2563eb",
          departmentId: null,
          description: "Tenant owner with organization administration access.",
          displayName: "Owner",
          isSystem: true,
          label: "Owner",
          name: "owner",
          organizationId: organization.id,
          scope: "organization",
          tenantId: tenant.id,
        }),
      );
      await this.assignOrganizationOwnerPermissions(
        tenant.id,
        organization.id,
        ownerRole,
        manager,
      );
      await this.assignTenantOwnerPermissions(
        tenant.id,
        tenantOwnerRole,
        manager,
      );
      const membership = await manager.save(
        UserOrganization,
        this.membershipRepository.create({
          displayName: user.displayName,
          isDefault: true,
          joinedAt: new Date(),
          organizationId: organization.id,
          roleId: ownerRole.id,
          status: "active",
          tenantId: tenant.id,
          userId: user.id,
        }),
      );
      await manager.save(UserTenantRole, {
        roleId: tenantOwnerRole.id,
        tenantId: tenant.id,
        userId: user.id,
      });
      await manager.save(UserOrganizationRole, {
        membershipId: membership.id,
        organizationId: organization.id,
        roleId: ownerRole.id,
        tenantId: tenant.id,
      });
      await manager.save(PasswordReset, {
        email: user.email,
        tenantId: tenant.id,
        token: ownerActivationToken,
      });

      application.status = "approved";
      application.reviewedAt = new Date();
      application.reviewedByPlatformUserId = reviewerId;
      application.reviewNote = normalizeNullableText(payload?.note);
      application.tenantId = tenant.id;
      await manager.save(TenantApplication, application);

      return {
        application,
        organization,
        ownerActivationToken,
        ownerUser: user,
        tenant,
      };
    });
    const activationLink = buildTenantOwnerActivationLink(
      result.ownerUser.email,
      result.ownerActivationToken,
    );
    const emailDelivery = await this.sendPlatformEmailSafely({
      email: result.ownerUser.email,
      languageCode: result.application.preferredLanguage,
      locals: {
        activationLink,
        expiresIn:
          result.application.preferredLanguage === "en"
            ? "10 minutes"
            : "10 分钟",
        ownerDisplayName: result.ownerUser.displayName,
        tenantName: result.tenant.name,
      },
      templateName: "tenant-owner-activation",
    });
    return {
      ...result,
      ownerActivationEmailSent: emailDelivery.sent,
      ownerActivationToken:
        process.env.NODE_ENV === "production"
          ? undefined
          : result.ownerActivationToken,
    };
  }

  async rejectApplication(
    platformUserId: string,
    applicationId: string,
    payload: TenantApplicationReviewPayload,
  ) {
    const reviewerId = requireText(platformUserId, "平台用户");
    return this.withLockedApplication(applicationId, async (application, manager) => {
      if (
        application.status !== "pending_email_verification" &&
        application.status !== "pending_review"
      ) {
        throw new BadRequestException("租户申请已经处理");
      }
      application.cancellationTokenHash = null;
      application.emailVerificationTokenHash = null;
      application.status = "rejected";
      application.reviewedAt = new Date();
      application.reviewedByPlatformUserId = reviewerId;
      application.reviewNote = normalizeNullableText(payload?.note);
      return manager.save(TenantApplication, application);
    });
  }

  async get(tenantId: string) {
    tenantId = this.requireTenantExecution(tenantId);
    const tenant = await this.tenantContext.repository(Tenant).findOne({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("租户不存在");
    return tenant;
  }

  async update(tenantId: string, payload: UpdateTenantPayload) {
    tenantId = this.requireTenantExecution(tenantId);
    const tenant = await this.get(tenantId);
    if (payload?.name !== undefined) {
      tenant.name = requireText(payload.name, "租户名称");
    }
    return this.tenantContext.repository(Tenant).save(tenant);
  }

  async listTenantRoles(tenantId: string) {
    tenantId = this.requireTenantExecution(tenantId);
    const roles = await this.tenantContext.repository(Role).find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: true },
      where: {
        departmentId: IsNull(),
        organizationId: IsNull(),
        scope: "tenant",
        tenantId,
      },
    });
    return roles.map(toTenantRoleDto);
  }

  async createTenantRole(tenantId: string, payload: TenantRolePayload) {
    tenantId = this.requireTenantExecution(tenantId);
    requireObject(payload, "角色");
    const displayName = requireText(payload.displayName ?? payload.name, "角色名称");
    const name = normalizeSlug(payload.name ?? displayName);
    assertCustomTenantRoleName(name);
    const roles = this.tenantContext.repository(Role);
    if (await roles.findOne({ where: { name, scope: "tenant", tenantId } })) {
      throw new BadRequestException("角色标识已被使用");
    }
    const role = await roles.save(
      roles.create({
        color: normalizeNullableText(payload.color),
        departmentId: null,
        description: normalizeNullableText(payload.description),
        displayName,
        isSystem: false,
        label: displayName,
        name,
        organizationId: null,
        scope: "tenant",
        tenantId,
      }),
    );
    return toTenantRoleDto(role);
  }

  async updateTenantRole(
    tenantId: string,
    roleId: string,
    payload: Partial<TenantRolePayload>,
  ) {
    tenantId = this.requireTenantExecution(tenantId);
    requireObject(payload, "角色");
    const role = await this.requireTenantRole(tenantId, roleId);
    if (payload.name !== undefined) {
      const name = normalizeSlug(payload.name);
      if (role.isSystem && name !== role.name) {
        throw new BadRequestException("系统租户角色标识不能修改");
      }
      if (!role.isSystem) assertCustomTenantRoleName(name);
      const duplicate = await this.tenantContext.repository(Role).findOne({
        where: { name, scope: "tenant", tenantId },
      });
      if (duplicate && duplicate.id !== role.id) {
        throw new BadRequestException("角色标识已被使用");
      }
      role.name = name;
    }
    if (payload.displayName !== undefined) {
      role.displayName = requireText(payload.displayName, "角色名称");
      role.label = role.displayName;
    }
    if (payload.color !== undefined) role.color = normalizeNullableText(payload.color);
    if (payload.description !== undefined) {
      role.description = normalizeNullableText(payload.description);
    }
    return toTenantRoleDto(await this.tenantContext.repository(Role).save(role));
  }

  async replaceTenantRolePermissions(
    tenantId: string,
    roleId: string,
    payload: TenantRolePermissionsPayload,
  ) {
    tenantId = this.requireTenantExecution(tenantId);
    const role = await this.requireTenantRole(tenantId, roleId);
    if (role.isSystem) throw new BadRequestException("系统租户角色权限不能替换");
    if (!payload || !Array.isArray(payload.permissions)) {
      throw new BadRequestException("权限列表格式不正确");
    }
    const requestedCodes = [
      ...new Set(
        payload.permissions
          .filter((item) => item?.enabled !== false)
          .map((item) => requireText(item?.permission, "权限")),
      ),
    ];
    const permissions: Permission[] = [];
    for (const code of requestedCodes) {
      const permission = await this.tenantContext.repository(Permission).findOne({
        where: { code, scope: "tenant" },
      });
      if (!permission) throw new BadRequestException(`租户权限不存在: ${code}`);
      permissions.push(permission);
    }
    const manager = this.tenantContext.current()!.manager;
    await manager.delete(RolePermission, { roleId, tenantId });
    if (permissions.length) {
      await manager.save(
        RolePermission,
        permissions.map((permission) => ({
          departmentId: null,
          enabled: true,
          organizationId: null,
          permission: permission.code ?? "",
          permissionId: permission.id,
          roleId,
          tenantId,
        })),
      );
    }
    return this.requireTenantRole(tenantId, roleId, true).then(toTenantRoleDto);
  }

  async deleteTenantRole(tenantId: string, roleId: string) {
    tenantId = this.requireTenantExecution(tenantId);
    const role = await this.requireTenantRole(tenantId, roleId);
    if (role.isSystem) throw new BadRequestException("系统租户角色不能删除");
    const manager = this.tenantContext.current()!.manager;
    await manager.delete(UserTenantRole, { roleId, tenantId });
    await manager.delete(RolePermission, { roleId, tenantId });
    await manager.delete(Role, { id: roleId, tenantId });
    return { success: true };
  }

  private async requireTenantRole(
    tenantId: string,
    roleId: string,
    withPermissions = false,
  ) {
    const role = await this.tenantContext.repository(Role).findOne({
      relations: withPermissions ? { rolePermissions: true } : undefined,
      where: {
        departmentId: IsNull(),
        id: requireText(roleId, "角色"),
        organizationId: IsNull(),
        scope: "tenant",
        tenantId,
      },
    });
    if (!role) throw new NotFoundException("租户角色不存在");
    return role;
  }

  private requireTenantExecution(tenantId: string) {
    const id = requireText(tenantId, "租户");
    if (this.tenantContext.current()!.tenantId !== id) {
      throw new NotFoundException("租户不存在");
    }
    return id;
  }

  private withLockedApplication<T>(
    applicationId: string,
    work: (application: TenantApplication, manager: EntityManager) => Promise<T>,
  ) {
    return this.applicationRepository.manager.transaction(async (manager) =>
      work(await this.findLockedApplication(applicationId, manager), manager),
    );
  }

  private async findLockedApplication(
    applicationId: string,
    manager: EntityManager,
  ) {
    const application = await manager.findOne(TenantApplication, {
      lock: { mode: "pessimistic_write" },
      where: { id: requireText(applicationId, "租户申请") },
    });
    if (!application) throw new NotFoundException("租户申请不存在");
    return application;
  }

  private async requireApplication(applicationId: string) {
    const application = await this.applicationRepository.findOne({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException("租户申请不存在");
    return application;
  }

  private async assertTenantIdentityAvailable(
    slug: string,
    subdomain: string | null,
    manager?: EntityManager,
  ) {
    const existing = await (manager ?? this.platformTenantRepository.manager).findOne(Tenant, {
      where: [{ slug }, ...(subdomain ? [{ subdomain }] : [])],
    });
    if (existing) throw new BadRequestException("租户标识或子域名已被使用");
  }

  private async assignOrganizationOwnerPermissions(
    tenantId: string,
    organizationId: string,
    role: Role,
    manager: import("typeorm").EntityManager,
  ) {
    const permissions = await manager.find(Permission, {
      where: [{ scope: "organization" }, { scope: "own" }],
    });
    const rows = permissions
      .filter((permission) => permission.defaultRoles?.includes("owner"))
      .map((permission) =>
        this.rolePermissionRepository.create({
          enabled: true,
          organizationId,
          permission: permission.code ?? "",
          permissionId: permission.id,
          roleId: role.id,
          tenantId,
        }),
      );
    if (rows.length) await manager.save(RolePermission, rows);
  }

  private async assignTenantOwnerPermissions(
    tenantId: string,
    role: Role,
    manager: import("typeorm").EntityManager,
  ) {
    const permissions = await manager.find(Permission, {
      where: { scope: "tenant" },
    });
    const rows = permissions
      .filter((permission) =>
        permission.defaultRoles?.includes("tenant-owner"),
      )
      .map((permission) =>
        this.rolePermissionRepository.create({
          departmentId: null,
          enabled: true,
          organizationId: null,
          permission: permission.code ?? "",
          permissionId: permission.id,
          roleId: role.id,
          tenantId,
        }),
      );
    if (rows.length) await manager.save(RolePermission, rows);
  }

  private async sendPlatformEmailSafely(
    input: Parameters<PlatformEmailSendService["send"]>[0],
  ) {
    try {
      return await this.platformEmailSendService.send(input);
    } catch {
      return { sent: false as const, reason: "send_failed" as const };
    }
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function normalizeEmail(value: unknown) {
  const email = requireText(value, "负责人邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("负责人邮箱格式不正确");
  }
  return email;
}

function normalizeSlug(value: unknown) {
  const slug = requireText(value, "租户标识")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new BadRequestException("租户标识格式不正确");
  return slug;
}

function normalizeNullableSlug(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeSlug(value);
}

function normalizeNullableText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("文本格式不正确");
  return value.trim() || null;
}

function normalizeOptionalName(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, "组织名称");
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeApplicationLanguage(value: unknown): "en" | "zh-CN" {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("en")
    ? "en"
    : "zh-CN";
}

export function buildTenantApplicationLinks(
  applicationId: string,
  verificationToken: string,
  cancellationToken: string,
) {
  const verification = new URL("/apply", resolvePublicBaseUrl());
  verification.searchParams.set("applicationId", applicationId);
  verification.searchParams.set("token", verificationToken);
  const cancellation = new URL("/apply", resolvePublicBaseUrl());
  cancellation.searchParams.set("applicationId", applicationId);
  cancellation.searchParams.set("cancelToken", cancellationToken);
  return {
    cancellationLink: cancellation.toString(),
    verificationLink: verification.toString(),
  };
}

export function buildTenantOwnerActivationLink(email: string, token: string) {
  const url = new URL("/reset-password", resolvePublicBaseUrl());
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

function resolvePublicBaseUrl() {
  return (
    process.env.WEB_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3100"
  );
}

function tokenMatches(actualHash: string | null | undefined, token: string) {
  if (!actualHash || !/^[a-f0-9]{64}$/i.test(actualHash)) return false;
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(hashToken(token), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isAllowedTenantStatusTransition(
  current: Tenant["status"],
  next: "active" | "archived" | "suspended",
) {
  if (current === "provisioning") return next === "archived";
  if (current === "active") return next === "suspended" || next === "archived";
  if (current === "suspended") return next === "active" || next === "archived";
  return false;
}

function assertCustomTenantRoleName(name: string) {
  if (RESERVED_TENANT_ROLE_NAMES.has(name)) {
    throw new BadRequestException("系统租户角色标识不能用于自定义角色");
  }
}

function requireObject(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label}内容无效`);
  }
}

function toTenantRoleDto(role: Role) {
  return {
    color: role.color,
    description: role.description,
    displayName: role.displayName ?? role.label,
    id: role.id,
    isSystem: role.isSystem,
    name: role.name,
    permissions: (role.rolePermissions ?? [])
      .filter((permission) => permission.enabled)
      .map((permission) => permission.permission),
    scope: role.scope,
    tenantId: role.tenantId,
  };
}
