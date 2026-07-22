import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Account,
  PasswordReset,
  Permission,
  Role,
  RolePermission,
  Workspace,
  WorkspaceApplication,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import jwt from "jsonwebtoken";
import { Repository, type EntityManager } from "typeorm";
import type {
  WorkspaceApplicationPayload,
  WorkspaceApplicationReviewPayload,
  WorkspaceRolePayload,
  WorkspaceRolePermissionsPayload,
  UpdateWorkspacePayload,
} from "./workspaces.controller.js";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { PlatformEmailSendService } from "../mail/platform-email-send.service.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import { SettingsService } from "../settings/settings.service.js";

const RESERVED_WORKSPACE_ROLE_NAMES = new Set([
  "workspace-owner",
  "workspace-admin",
  "workspace-member",
]);

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly platformWorkspaceRepository: Repository<Workspace>,
    @InjectRepository(WorkspaceApplication)
    private readonly applicationRepository: Repository<WorkspaceApplication>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(WorkspaceMembership)
    private readonly workspaceMembershipRepository: Repository<WorkspaceMembership>,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly platformEmailSendService: PlatformEmailSendService,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
    @Optional()
    private readonly settingsService?: SettingsService,
  ) {}

  async apply(payload: WorkspaceApplicationPayload) {
    await this.assertWorkspaceApplicationsEnabled();
    const requestedName = requireText(payload?.requestedName, "工作空间名称");
    const requestedSlug = normalizeSlug(payload?.requestedSlug ?? requestedName);
    const ownerEmail = normalizeEmail(payload?.ownerEmail);
    const ownerDisplayName = requireText(payload?.ownerDisplayName, "负责人名称");
    const requestedSubdomain = normalizeNullableSlug(payload?.requestedSubdomain);
    const preferredLanguage = normalizeApplicationLanguage(payload?.preferredLanguage);
    await this.assertWorkspaceIdentityAvailable(requestedSlug, requestedSubdomain);

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
        reviewedByAccountId: null,
        reviewNote: null,
        status: "pending_email_verification",
        workspaceId: null,
      }),
    );
    const links = buildWorkspaceApplicationLinks(
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
      templateName: "workspace-application-verification",
    });
    return {
      applicationId: application.id,
      cancellationToken:
        process.env.NODE_ENV === "production" ? undefined : cancellationToken,
      // Development-only delivery contract until the workspace mail workflow is wired.
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
        throw new BadRequestException("工作空间申请当前不能取消");
      }
      if (!tokenMatches(application.cancellationTokenHash, value)) {
        throw new BadRequestException("取消令牌无效");
      }
      application.cancellationTokenHash = null;
      application.emailVerificationTokenHash = null;
      application.status = "cancelled";
      return manager.save(WorkspaceApplication, application);
    });
  }

  async verifyApplication(applicationId: string, token: unknown) {
    const value = requireText(token, "验证令牌");
    return this.withLockedApplication(applicationId, async (application, manager) => {
      if (application.status !== "pending_email_verification") {
        throw new BadRequestException("工作空间申请当前不能验证");
      }
      if (!tokenMatches(application.emailVerificationTokenHash, value)) {
        throw new BadRequestException("验证令牌无效");
      }
      application.emailVerifiedAt = new Date();
      application.emailVerificationTokenHash = null;
      application.status = "pending_review";
      return manager.save(WorkspaceApplication, application);
    });
  }

  listApplications() {
    return this.applicationRepository.find({ order: { createdAt: "DESC" } });
  }

  listWorkspaces() {
    return this.platformWorkspaceRepository.find({ order: { createdAt: "DESC" } });
  }

  async updateWorkspaceStatus(workspaceId: string, status: unknown) {
    if (status !== "active" && status !== "suspended" && status !== "archived") {
      throw new BadRequestException("工作空间状态无效");
    }
    const id = requireText(workspaceId, "工作空间");
    return this.platformWorkspaceRepository.manager.transaction(async (manager) => {
      const workspace = await manager.findOne(Workspace, {
        lock: { mode: "pessimistic_write" },
        where: { id },
      });
      if (!workspace) throw new NotFoundException("工作空间不存在");
      if (workspace.status === status) return workspace;
      if (!isAllowedWorkspaceStatusTransition(workspace.status, status)) {
        throw new BadRequestException(
          workspace.status === "provisioning"
            ? "工作空间必须由 Owner 完成激活后才能启用或挂起"
            : "工作空间状态转换无效",
        );
      }
      workspace.status = status;
      return manager.save(Workspace, workspace);
    });
  }

  async approveApplication(
    reviewerAccountId: string,
    applicationId: string,
    payload: WorkspaceApplicationReviewPayload,
  ) {
    const result = await this.platformWorkspaceRepository.manager.transaction(async (manager) => {
      const application = await this.findLockedApplication(applicationId, manager);
      if (application.status !== "pending_review" || !application.emailVerifiedAt) {
        throw new BadRequestException("工作空间申请尚未完成验证或已经处理");
      }
      await this.assertWorkspaceIdentityAvailable(
        application.requestedSlug,
        application.requestedSubdomain,
        manager,
      );
      const reviewerId = requireText(reviewerAccountId, "平台账号");
      const workspace = await manager.save(
        Workspace,
        this.platformWorkspaceRepository.create({
          name: application.requestedName,
          slug: application.requestedSlug,
          status: "provisioning",
          subdomain: application.requestedSubdomain,
        }),
      );
      const workspaceOwnerRole = await manager.save(
        Role,
        this.roleRepository.create({
          color: "#7c3aed",
          description: "Workspace owner with workspace governance access.",
          displayName: "Workspace Owner",
          isSystem: true,
          label: "Workspace Owner",
          name: "workspace-owner",
          scope: "workspace",
          workspaceId: workspace.id,
        }),
      );
      await this.assignWorkspaceOwnerPermissions(
        workspaceOwnerRole,
        manager,
      );
      const ownerActivationToken = createWorkspaceActivationToken({
        applicationId: application.id,
        email: application.ownerEmail,
        roleId: workspaceOwnerRole.id,
        workspaceId: workspace.id,
      });

      application.status = "approved";
      application.reviewedAt = new Date();
      application.reviewedByAccountId = reviewerId;
      application.reviewNote = normalizeNullableText(payload?.note);
      application.workspaceId = workspace.id;
      await manager.save(WorkspaceApplication, application);

      return {
        application,
        ownerActivationToken,
        workspace,
      };
    });
    const activationLink = buildWorkspaceOwnerActivationLink(
      result.application.ownerEmail,
      result.ownerActivationToken,
    );
    const emailDelivery = await this.sendPlatformEmailSafely({
      email: result.application.ownerEmail,
      languageCode: result.application.preferredLanguage,
      locals: {
        activationLink,
        expiresIn:
          result.application.preferredLanguage === "en"
            ? "24 hours"
            : "24 小时",
        ownerDisplayName: result.application.ownerDisplayName,
        workspaceName: result.workspace.name,
      },
      templateName: "workspace-owner-activation",
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

  async activateWorkspaceOwner(payload: {
    displayName?: string;
    password?: string;
    token?: string;
  }) {
    const token = requireText(payload?.token, "激活令牌");
    const decoded = verifyWorkspaceActivationToken(token);
    return this.platformWorkspaceRepository.manager.transaction(async (manager) => {
      const [application, workspace, role] = await Promise.all([
        manager.findOne(WorkspaceApplication, {
          lock: { mode: "pessimistic_write" },
          where: { id: decoded.applicationId },
        }),
        manager.findOne(Workspace, {
          lock: { mode: "pessimistic_write" },
          where: { id: decoded.workspaceId },
        }),
        manager.findOne(Role, {
          where: {
            id: decoded.roleId,
            name: "workspace-owner",
            scope: "workspace",
            workspaceId: decoded.workspaceId,
          },
        }),
      ]);
      if (
        !application ||
        application.status !== "approved" ||
        application.ownerEmail !== decoded.email ||
        application.workspaceId !== decoded.workspaceId ||
        !workspace ||
        workspace.status !== "provisioning" ||
        !role
      ) {
        throw new BadRequestException("激活令牌无效或工作空间已经激活");
      }

      let account = await manager.findOne(Account, {
        where: { email: decoded.email },
      });
      const existingAccount = Boolean(account);
      if (!account) {
        const displayName =
          normalizeNullableText(payload?.displayName) ??
          application.ownerDisplayName;
        account = await manager.save(
          Account,
          manager.create(Account, {
            displayName,
            email: decoded.email,
            emailVerified: true,
            nickname: displayName,
            passwordHash: await hashPassword(
              requireOwnerActivationPassword(payload?.password),
            ),
            preferredLanguage: application.preferredLanguage,
            status: "active",
            type: "user",
          }),
        );
      } else if (account.status !== "active") {
        throw new BadRequestException("已有账号不可用");
      }

      const membership =
        (await manager.findOne(WorkspaceMembership, {
          where: { accountId: account.id, workspaceId: workspace.id },
        })) ?? manager.create(WorkspaceMembership);
      Object.assign(membership, {
        accountId: account.id,
        removedAt: null,
        roleId: role.id,
        status: "active",
        workspaceId: workspace.id,
      });
      await manager.save(WorkspaceMembership, membership);
      workspace.status = "active";
      await manager.save(Workspace, workspace);
      return {
        account: {
          displayName: account.displayName,
          email: account.email,
          id: account.id,
        },
        existingAccount,
        membershipId: membership.id,
        workspace,
      };
    });
  }

  async rejectApplication(
    reviewerAccountId: string,
    applicationId: string,
    payload: WorkspaceApplicationReviewPayload,
  ) {
    const reviewerId = requireText(reviewerAccountId, "平台账号");
    return this.withLockedApplication(applicationId, async (application, manager) => {
      if (
        application.status !== "pending_email_verification" &&
        application.status !== "pending_review"
      ) {
        throw new BadRequestException("工作空间申请已经处理");
      }
      application.cancellationTokenHash = null;
      application.emailVerificationTokenHash = null;
      application.status = "rejected";
      application.reviewedAt = new Date();
      application.reviewedByAccountId = reviewerId;
      application.reviewNote = normalizeNullableText(payload?.note);
      return manager.save(WorkspaceApplication, application);
    });
  }

  async get(workspaceId: string) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    const workspace = await this.platformWorkspaceRepository.findOne({
      where: { id: workspaceId },
    });
    if (!workspace) throw new NotFoundException("工作空间不存在");
    return workspace;
  }

  async update(workspaceId: string, payload: UpdateWorkspacePayload) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    const workspace = await this.get(workspaceId);
    if (payload?.name !== undefined) {
      workspace.name = requireText(payload.name, "工作空间名称");
    }
    return this.platformWorkspaceRepository.save(workspace);
  }

  async listWorkspaceRoles(workspaceId: string) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    const roles = await this.roleRepository.find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: { permissionRecord: true } },
      where: { scope: "workspace", workspaceId },
    });
    return roles.map(toWorkspaceRoleDto);
  }

  async createWorkspaceRole(workspaceId: string, payload: WorkspaceRolePayload) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    requireObject(payload, "角色");
    const displayName = requireText(payload.displayName ?? payload.name, "角色名称");
    const name = normalizeSlug(payload.name ?? displayName);
    assertCustomWorkspaceRoleName(name);
    const roles = this.roleRepository;
    if (await roles.findOne({ where: { name, scope: "workspace", workspaceId } })) {
      throw new BadRequestException("角色标识已被使用");
    }
    const role = await roles.save(
      roles.create({
        color: normalizeNullableText(payload.color),
        description: normalizeNullableText(payload.description),
        displayName,
        isSystem: false,
        label: displayName,
        name,
        scope: "workspace",
        workspaceId,
      }),
    );
    return toWorkspaceRoleDto(role);
  }

  async updateWorkspaceRole(
    workspaceId: string,
    roleId: string,
    payload: Partial<WorkspaceRolePayload>,
  ) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    requireObject(payload, "角色");
    const role = await this.requireWorkspaceRole(workspaceId, roleId);
    if (payload.name !== undefined) {
      const name = normalizeSlug(payload.name);
      if (role.isSystem && name !== role.name) {
        throw new BadRequestException("系统工作空间角色标识不能修改");
      }
      if (!role.isSystem) assertCustomWorkspaceRoleName(name);
      const duplicate = await this.roleRepository.findOne({
        where: { name, scope: "workspace", workspaceId },
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
    return toWorkspaceRoleDto(await this.roleRepository.save(role));
  }

  async replaceWorkspaceRolePermissions(
    workspaceId: string,
    roleId: string,
    payload: WorkspaceRolePermissionsPayload,
    actorUserId?: string,
  ) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    const role = await this.requireWorkspaceRole(workspaceId, roleId);
    if (isProtectedWorkspaceRole(role)) {
      throw new BadRequestException("Workspace Owner 权限不能修改");
    }
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
      const permission = await this.permissionRepository.findOne({
        where: { code },
      });
      const allowed = permission && (permission.scope === "workspace" || permission.scope === "own");
      if (!allowed) throw new BadRequestException(`角色权限范围不匹配: ${code}`);
      permissions.push(permission);
    }
    if (actorUserId) {
      const assignments = await this.workspaceMembershipRepository.find({
        relations: { role: { rolePermissions: { permissionRecord: true } } },
        where: { accountId: actorUserId, status: "active", workspaceId },
      });
      this.grantPolicy.assertCanReplacePermissions(
        assignments.flatMap((assignment) =>
          (assignment.role?.rolePermissions ?? [])
            .filter((permission) => permission.enabled)
            .map((permission) => permission.permission),
        ),
        permissions.flatMap((permission) =>
          permission.code ? [permission.code] : [],
        ),
      );
    }
    await this.rolePermissionRepository.manager.transaction(async (manager) => {
      const lockedRole = await manager.findOne(Role, {
        lock: { mode: "pessimistic_write" },
        where: { id: roleId, scope: "workspace", workspaceId },
      });
      if (!lockedRole) throw new NotFoundException("工作空间角色不存在");
      await manager.delete(RolePermission, { roleId });
      if (permissions.length) {
        await manager.save(
          RolePermission,
          permissions.map((permission) => ({
            enabled: true,
            permissionId: permission.id,
            roleId,
          })),
        );
      }
    });
    return this.requireWorkspaceRole(workspaceId, roleId, true).then(toWorkspaceRoleDto);
  }

  async deleteWorkspaceRole(workspaceId: string, roleId: string) {
    workspaceId = this.requireWorkspaceExecution(workspaceId);
    const role = await this.requireWorkspaceRole(workspaceId, roleId);
    if (role.isSystem) throw new BadRequestException("系统工作空间角色不能删除");
    await this.roleRepository.manager.transaction(async (manager) => {
      if (await manager.exists(WorkspaceMembership, { where: { roleId, workspaceId } })) {
        throw new ConflictException("角色仍分配给工作空间用户，不能删除");
      }
      await manager.delete(RolePermission, { roleId });
      await manager.delete(Role, { id: roleId, workspaceId });
    });
    return { success: true };
  }

  private async requireWorkspaceRole(
    workspaceId: string,
    roleId: string,
    withPermissions = false,
  ) {
    const role = await this.roleRepository.findOne({
      relations: withPermissions
        ? { rolePermissions: { permissionRecord: true } }
        : undefined,
      where: {
        id: requireText(roleId, "角色"),
        scope: "workspace",
        workspaceId,
      },
    });
    if (!role) throw new NotFoundException("工作空间角色不存在");
    return role;
  }

  private requireWorkspaceExecution(workspaceId: string) {
    const id = requireText(workspaceId, "工作空间");
    if (this.workspaceContext.current()!.workspaceId !== id) {
      throw new NotFoundException("工作空间不存在");
    }
    return id;
  }

  private withLockedApplication<T>(
    applicationId: string,
    work: (application: WorkspaceApplication, manager: EntityManager) => Promise<T>,
  ) {
    return this.applicationRepository.manager.transaction(async (manager) =>
      work(await this.findLockedApplication(applicationId, manager), manager),
    );
  }

  private async findLockedApplication(
    applicationId: string,
    manager: EntityManager,
  ) {
    const application = await manager.findOne(WorkspaceApplication, {
      lock: { mode: "pessimistic_write" },
      where: { id: requireText(applicationId, "工作空间申请") },
    });
    if (!application) throw new NotFoundException("工作空间申请不存在");
    return application;
  }

  private async requireApplication(applicationId: string) {
    const application = await this.applicationRepository.findOne({
      where: { id: applicationId },
    });
    if (!application) throw new NotFoundException("工作空间申请不存在");
    return application;
  }

  private async assertWorkspaceApplicationsEnabled() {
    const enabled =
      (await this.settingsService?.getPlatformValue(
        PLATFORM_SETTING_KEYS.workspaceApplicationsEnabled,
        "true",
      )) ?? "true";
    if (enabled !== "true") {
      throw new ForbiddenException("平台当前未开放工作空间申请");
    }
  }

  private async assertWorkspaceIdentityAvailable(
    slug: string,
    subdomain: string | null,
    manager?: EntityManager,
  ) {
    const existing = await (manager ?? this.platformWorkspaceRepository.manager).findOne(Workspace, {
      where: [{ slug }, ...(subdomain ? [{ subdomain }] : [])],
    });
    if (existing) throw new BadRequestException("工作空间标识或子域名已被使用");
  }

  private async assignWorkspaceOwnerPermissions(
    role: Role,
    manager: import("typeorm").EntityManager,
  ) {
    const permissions = (await manager.find(Permission)).filter(
      (permission) => permission.scope !== "platform",
    );
    const rows = permissions
      .map((permission) =>
        manager.create(RolePermission, {
          enabled: true,
          permissionId: permission.id,
          roleId: role.id,
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
  const slug = requireText(value, "工作空间标识")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new BadRequestException("工作空间标识格式不正确");
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
  return requireText(value, "工作空间名称");
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeApplicationLanguage(value: unknown): "en" | "zh-Hans" {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("en")
    ? "en"
    : "zh-Hans";
}

export function buildWorkspaceApplicationLinks(
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

export function buildWorkspaceOwnerActivationLink(email: string, token: string) {
  const url = new URL("/signup", resolvePublicBaseUrl());
  url.searchParams.set("email", email);
  url.searchParams.set("token", token);
  return url.toString();
}

type WorkspaceActivationTokenPayload = {
  applicationId: string;
  email: string;
  roleId: string;
  workspaceId: string;
};

function createWorkspaceActivationToken(payload: WorkspaceActivationTokenPayload) {
  return jwt.sign(payload, workspaceActivationSecret(), { expiresIn: "24h" });
}

function verifyWorkspaceActivationToken(token: string) {
  try {
    return jwt.verify(
      token,
      workspaceActivationSecret(),
    ) as WorkspaceActivationTokenPayload;
  } catch {
    throw new BadRequestException("激活令牌无效或已过期");
  }
}

function workspaceActivationSecret() {
  const secret =
    process.env.WORKSPACE_ACTIVATION_TOKEN_SECRET ??
    process.env.AUTH_SESSION_SECRET ??
    process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("WORKSPACE_ACTIVATION_TOKEN_SECRET is required in production");
  }
  return secret ?? "hermes-workspace-activation-development-secret";
}

function requireOwnerActivationPassword(value: unknown) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
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

function isAllowedWorkspaceStatusTransition(
  current: Workspace["status"],
  next: "active" | "archived" | "suspended",
) {
  if (current === "provisioning") return next === "archived";
  if (current === "active") return next === "suspended" || next === "archived";
  if (current === "suspended") return next === "active" || next === "archived";
  return false;
}

function assertCustomWorkspaceRoleName(name: string) {
  if (RESERVED_WORKSPACE_ROLE_NAMES.has(name)) {
    throw new BadRequestException("系统工作空间角色标识不能用于自定义角色");
  }
}

function requireObject(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label}内容无效`);
  }
}

function isProtectedWorkspaceRole(role: Pick<Role, "name">) {
  return role.name === "workspace-owner";
}

function toWorkspaceRoleDto(role: Role) {
  return {
    color: role.color,
    description: role.description,
    displayName: role.displayName ?? role.label,
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
    permissions: (role.rolePermissions ?? []).map((permission) => ({
      enabled: permission.enabled,
      id: permission.id,
      permission: permission.permission,
      permissionId: permission.permissionId,
      roleId: permission.roleId,
    })),
    scope: role.scope,
    workspaceId: role.workspaceId,
  };
}
