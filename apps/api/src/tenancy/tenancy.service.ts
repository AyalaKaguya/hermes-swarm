import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { Repository } from "typeorm";
import {
  DEFAULT_ADMIN_MENUS,
  DEPRECATED_ADMIN_MENU_CODES,
  Menu,
  Organization,
  OrganizationSetting,
  OrganizationStatus,
  Role,
  RolePermission,
  SYSTEM_ROLES,
  SystemSetting,
  User,
  UserStatus,
  buildMenuPermissionKey,
  defaultPermissionsForRole,
  getRoleRank,
  isPlatformAdminRoleName,
  isPlatformMenuCode,
  maskSettingValue,
  mergeEffectiveOrganizationSettings,
  PLATFORM_ORGANIZATION_SETTING_DEFAULTS,
  resolveSettingValueOptions,
  resolveSettingValueType,
} from "@hermes-swarm/core";
import {
  AuthContext,
  CreateMenuPayload,
  ListMenusOptions,
  CreateOrganizationPayload,
  CreateUserPayload,
  LoginPayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  RequestScopeLevel,
  SaveSettingsPayload,
  SearchUsersQuery,
  SwitchOrganizationPayload,
  UpdateMenuPayload,
  UpdateOrganizationPayload,
  UpdatePreferredLanguagePayload,
  UpdateUserPasswordPayload,
  UpdateUserPayload,
} from "./tenancy.types.js";
import {
  createAuthSessionToken,
  parseAuthSessionToken,
} from "./admin-session.js";
import {
  normalizeSettingEntry,
  parseSettingsPayload,
} from "../settings/settings-value-normalizer.js";

const ORGANIZATION_STATUSES: OrganizationStatus[] = ["active", "suspended"];
const USER_STATUSES: UserStatus[] = ["active", "disabled"];
const PREFERRED_LANGUAGES = ["en", "zh-CN", "zh-Hans", "zh-Hant"] as const;
const DEFAULT_ADMIN_EMAIL = "admin@hermes.local";
const DEFAULT_ADMIN_PASSWORD = "admin123456";
const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;
const PLATFORM_ALLOW_ORGANIZATION_CREATION_KEY =
  "platform.allowOrganizationCreation";
const PLATFORM_DEFAULT_ORGANIZATION_STATUS_KEY =
  "platform.defaultOrganizationStatus";
@Injectable()
/**
 * Central application service for migrated admin tenancy capabilities:
 * onboarding, auth context, users, organizations, roles, menus, and settings.
 */
export class TenancyService implements OnModuleInit {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(OrganizationSetting)
    private readonly organizationSettingRepository: Repository<OrganizationSetting>,
    @InjectRepository(SystemSetting)
    private readonly systemSettingRepository: Repository<SystemSetting>,
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
  ) {}

  async onModuleInit() {
    await this.ensureMenus();
    await this.ensureSystemDefaultSettings();
    await this.ensureInfrastructureForExistingOrganizations();
  }

  /**
   * Returns unauthenticated startup data for onboarding and menu discovery.
   */
  async getPublicBootstrap() {
    const [orgCount, userCount, organizations, menus] =
      await Promise.all([
        this.organizationRepository.count(),
        this.userRepository.count(),
        this.organizationRepository.find({ order: { createdAt: "ASC" } }),
        this.listMenus(),
      ]);

    return {
      onboardingRequired: orgCount === 0 || userCount === 0,
      organizations: organizations.map(toOrganizationDto),
      menus: menus.map(toMenuDto),
    };
  }

  /**
   * Creates the first active organization, provisions its roles, and creates
   * the initial platform administrator account.
   */
  async onboard(payload: OnboardingPayload) {
    const hasUsers = (await this.userRepository.count()) > 0;
    if (hasUsers) {
      throw new ConflictException("系统已经初始化，请使用登录入口");
    }

    const orgName = requireText(payload.organizationName, "组织名称");
    const orgSlug = normalizeSlug(payload.organizationSlug || orgName, "org");

    await this.assertUniqueOrganizationSlug(orgSlug);

    const organization = await this.organizationRepository.save(
      this.organizationRepository.create({
        name: orgName,
        slug: orgSlug,
        status: "active",
        subdomain: orgSlug,
      }),
    );

    await this.ensureOrganizationInfrastructure(organization.id);

    const platformAdminRole = await this.getSystemRoleOrThrow(
      organization.id,
      "platform-admin",
    );
    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName: requireText(payload.adminName, "管理员名称"),
        email: normalizeEmail(payload.adminEmail),
        passwordHash: hashPassword(
          requirePassword(payload.adminPassword || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId: platformAdminRole.id,
        status: "active",
        organizationId: organization.id,
        type: "user",
        preferredLanguage: "zh-CN",
      }),
    );

    return this.createLoginResponse(organization.id, user.id);
  }

  /**
   * Authenticates an active user by email and password.
   */
  async login(payload: LoginPayload) {
    const email = normalizeEmail(payload.email);
    const password = requireText(payload.password, "密码");

    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户名或密码不正确");
    }
    if (
      !verifyPassword(password, user.passwordHash) &&
      !(await this.recoverDefaultAdminPassword(user, password))
    ) {
      throw new UnauthorizedException("用户名或密码不正确");
    }
    if (!user.organizationId) {
      throw new UnauthorizedException("用户未关联任何组织");
    }

    const organization = await this.organizationRepository.findOne({
      where: { id: user.organizationId },
    });

    if (!organization || organization.status !== "active") {
      throw new UnauthorizedException("组织不可用");
    }

    return this.createLoginResponse(organization.id, user.id);
  }

  /**
   * Parses and verifies a bearer session token into a reusable auth context.
   */
  async requireAuthContext(authorization: string | undefined): Promise<AuthContext> {
    const tokenPayload = parseAuthSessionToken(parseBearerToken(authorization));
    if (!tokenPayload) {
      throw new UnauthorizedException("登录已失效");
    }

    const [organization, user] = await Promise.all([
      this.organizationRepository.findOne({
        where: { id: tokenPayload.organizationId },
      }),
      this.userRepository.findOne({
        where: {
          id: tokenPayload.userId,
          organizationId: tokenPayload.organizationId,
        },
      }),
    ]);

    if (!organization || organization.status !== "active") {
      throw new UnauthorizedException("组织不可用");
    }
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户不可用");
    }

    const role = user.roleId
      ? await this.roleRepository.findOne({
          where: { id: user.roleId, organizationId: tokenPayload.organizationId },
        })
      : null;
    const scopeLevel = normalizeScopeLevel(tokenPayload.scopeLevel);
    const isPlatformAdmin = isPlatformAdminRole(role?.name ?? null);
    if (scopeLevel === "platform" && !isPlatformAdmin) {
      throw new ForbiddenException("只有平台管理员可以切换到平台范围");
    }

    const permissions = await this.getEnabledPermissions(
      tokenPayload.organizationId,
      user.roleId,
      role?.name ?? null,
    );

    return {
      isPlatformAdmin,
      organizationId: organization.id,
      permissions,
      roleId: user.roleId,
      roleName: role?.name ?? null,
      scopeLevel,
      userId: user.id,
    };
  }

  /**
   * Returns a boolean auth check suitable for lightweight health-style calls.
   */
  async isAuthenticated(authorization: string | undefined) {
    try {
      await this.requireAuthContext(authorization);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Enforces a menu permission against an already-resolved auth context.
   */
  ensurePermission(
    context: AuthContext,
    menuCode: string,
    action: "manage" | "view",
  ) {
    this.assertPermission(context, menuCode, action);
  }

  /**
   * Checks a menu permission without throwing, for endpoints shared by menus.
   */
  hasPermission(
    context: AuthContext,
    menuCode: string,
    action: "manage" | "view",
  ) {
    if (context.isPlatformAdmin) return true;

    const expected = buildMenuPermissionKey(menuCode, action);
    const managerPermission = buildMenuPermissionKey(menuCode, "manage");
    return (
      context.permissions.includes(expected) ||
      (action === "view" && context.permissions.includes(managerPermission))
    );
  }

  /**
   * Requires the authenticated user to be a platform admin with menu access.
   */
  ensurePlatformScope(
    context: AuthContext,
    menuCode: string,
    action: "manage" | "view",
  ) {
    this.ensurePlatformAdministrator(context);
    this.assertPermission(context, menuCode, action);
  }

  /**
   * Requires access to an explicit organization under the active scope.
   */
  ensureOrganizationAccess(
    context: AuthContext,
    organizationId: string,
    action: "manage" | "view",
  ) {
    if (context.isPlatformAdmin) return;

    if (context.scopeLevel === "platform") {
      this.ensurePlatformScope(context, "organizations", action);
      return;
    }

    if (context.organizationId !== organizationId) {
      throw new ForbiddenException("只能访问当前组织范围内的配置");
    }

    this.assertAnyPermission(context, action, ["organization", "organizations"]);
  }

  /**
   * Returns the current user, role, permissions, and organization.
   */
  async getMe(context: AuthContext) {
    const [organization, user, role] = await Promise.all([
      this.organizationRepository.findOne({
        where: { id: context.organizationId },
      }),
      this.userRepository.findOne({
        where: { id: context.userId, organizationId: context.organizationId },
      }),
      context.roleId
        ? this.roleRepository.findOne({
            where: { id: context.roleId, organizationId: context.organizationId },
          })
        : Promise.resolve(null),
    ]);

    if (!organization || !user) {
      throw new UnauthorizedException("登录已失效");
    }

    return {
      organization: toOrganizationDto(organization),
      permissions: context.permissions,
      role: role ? toRoleDto(role) : null,
      user: toUserDto(user),
    };
  }

  /**
   * Loads the full admin snapshot consumed by the management frontend.
   */
  async getSnapshot(context: AuthContext) {
    await this.ensureOrganizationInfrastructure(context.organizationId);

    const [
      organization,
      users,
      roles,
      rolePermissions,
      organizationSettings,
      systemSettings,
      menus,
      switchableOrganizations,
    ] = await Promise.all([
      this.organizationRepository.findOne({
        where: { id: context.organizationId },
      }),
      this.userRepository.find({
        where: { organizationId: context.organizationId },
        order: { createdAt: "ASC" },
      }),
      this.roleRepository.find({
        where: { organizationId: context.organizationId },
        order: { createdAt: "ASC" },
      }),
      this.rolePermissionRepository.find({
        where: { organizationId: context.organizationId },
        order: { roleId: "ASC", permission: "ASC" },
      }),
      this.organizationSettingRepository.find({
        where: { organizationId: context.organizationId },
        order: { name: "ASC" },
      }),
      this.systemSettingRepository.find({
        order: { name: "ASC" },
      }),
      this.listMenus(),
      this.listSwitchableOrganizations(context),
    ]);

    if (!organization) {
      throw new UnauthorizedException("组织不可用");
    }

    const currentUser = users.find((u) => u.id === context.userId);
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const currentRole = context.roleId
      ? (roleById.get(context.roleId) ?? null)
      : null;
    const visibleRoles = roles.filter((role) => this.canViewRole(context, role));
    const visibleRoleById = new Map(visibleRoles.map((role) => [role.id, role]));
    const visibleUsers = users.filter((user) =>
      this.canViewUser(
        context,
        user.roleId ? (roleById.get(user.roleId) ?? null) : null,
      ),
    );
    const visibleRolePermissions = rolePermissions.filter((permission) =>
      this.canViewRolePermission(
        context,
        visibleRoleById.get(permission.roleId) ?? null,
        permission.permission,
      ),
    );

    if (!currentUser) {
      throw new UnauthorizedException("登录已失效");
    }

    return {
      currentUser: {
        isPlatformAdmin: context.isPlatformAdmin,
        organization: toOrganizationDto(organization),
        permissions: context.permissions,
        role: currentRole ? toRoleDto(currentRole) : null,
        user: toUserDto(currentUser),
      },
      isPlatformAdmin: context.isPlatformAdmin,
      menus: menus.map(toMenuDto),
      organization: toOrganizationDto(organization),
      organizations: switchableOrganizations.map(toOrganizationDto),
      rolePermissions: visibleRolePermissions.map(toRolePermissionDto),
      roles: visibleRoles.map(toRoleDto),
      scope: {
        level: context.scopeLevel,
        organizationId:
          context.scopeLevel === "organization" ? context.organizationId : null,
      },
      settings: mergeEffectiveOrganizationSettings(
        organizationSettings,
        systemSettings,
        context.organizationId,
      ),
      systemSettings: systemSettings.map(toSystemSettingDto),
      users: visibleUsers.map(toUserDto),
    };
  }

  /**
   * Returns the active organization for the current auth context.
   */
  async getCurrentOrganization(context: AuthContext) {
    const org = await this.organizationRepository.findOne({
      where: { id: context.organizationId },
    });
    return org ? toOrganizationDto(org) : null;
  }

  /**
   * Switches organization scope when the same user identity exists in the
   */
  async switchOrganization(
    context: AuthContext,
    payload: SwitchOrganizationPayload,
  ) {
    const organizationId = requireText(payload.organizationId, "组织 ID");
    const targetOrganization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!targetOrganization || targetOrganization.status !== "active") {
      throw new NotFoundException("组织不存在或不可用");
    }

    const currentUser = await this.getUserOrThrow(context.organizationId, context.userId);
    const targetUser = await this.userRepository.findOne({
      where: {
        email: currentUser.email,
        organizationId,
        status: "active",
      },
    });
    if (!targetUser) {
      throw new ForbiddenException("当前用户未加入该组织");
    }

    return this.createLoginResponse(organizationId, targetUser.id, "organization");
  }

  /**
   * Switches into platform scope for platform administrators.
   */
  async switchPlatform(context: AuthContext) {
    this.ensurePlatformAdministrator(context);
    const user = await this.getUserOrThrow(context.organizationId, context.userId);
    return this.createLoginResponse(
      context.organizationId,
      user.id,
      "platform",
    );
  }

  /**
   * Lists all organizations after checking organization view permission.
   */
  async listOrganizations(context: AuthContext) {
    this.ensurePlatformScope(context, "organizations", "view");
    const organizations = await this.organizationRepository.find({
      order: { createdAt: "ASC" },
    });
    return organizations.map(toOrganizationDto);
  }

  /**
   * Loads an organization selected explicitly by id.
   */
  async getOrganizationById(context: AuthContext, organizationId: string) {
    this.ensureOrganizationAccess(context, organizationId, "view");
    return toOrganizationDto(await this.getOrganizationOrThrow(organizationId));
  }

  /**
   * Creates an organization and provisions its default admin infrastructure.
   */
  async createOrganization(
    context: AuthContext,
    payload: CreateOrganizationPayload,
  ) {
    this.ensurePlatformScope(context, "organizations", "manage");
    const allowCreation = await this.getSystemSettingBoolean(
      PLATFORM_ALLOW_ORGANIZATION_CREATION_KEY,
      true,
    );
    if (!allowCreation) {
      throw new ForbiddenException("当前平台不允许创建组织");
    }

    const name = requireText(payload.name, "组织名称");
    const slug = normalizeSlug(payload.slug || name, "org");
    await this.assertUniqueOrganizationSlug(slug);
    const defaultStatusSetting = await this.getSystemSettingValue(
      PLATFORM_DEFAULT_ORGANIZATION_STATUS_KEY,
    );
    const defaultStatus: OrganizationStatus =
      defaultStatusSetting === "suspended" ? "suspended" : "active";

    const organization = this.organizationRepository.create({
      name,
      slug,
      status: payload.status ? normalizeOrganizationStatus(payload.status) : defaultStatus,
      subdomain: normalizeOptionalText(payload.subdomain),
    });
    await this.applyOrganizationPayload(organization, payload, {
      allowSlugChange: false,
      allowTenantControlChange: true,
    });

    const saved = await this.organizationRepository.save(organization);
    await this.ensureOrganizationInfrastructure(saved.id);
    return toOrganizationDto(saved);
  }

  /**
   * Updates the organization attached to the current session.
   */
  async updateOrganization(
    context: AuthContext,
    payload: UpdateOrganizationPayload,
  ) {
    this.ensureOrganizationAccess(context, context.organizationId, "manage");
    return this.updateOrganizationById(context, context.organizationId, payload);
  }

  /**
   * Updates an organization selected explicitly by id.
   */
  async updateOrganizationById(
    context: AuthContext,
    organizationId: string,
    payload: UpdateOrganizationPayload,
  ) {
    this.ensureOrganizationAccess(context, organizationId, "manage");
    const org = await this.getOrganizationOrThrow(organizationId);
    await this.applyOrganizationPayload(org, payload, {
      allowSlugChange: true,
      allowTenantControlChange: context.isPlatformAdmin,
    });

    return toOrganizationDto(await this.organizationRepository.save(org));
  }

  /**
   * Lists users in the current organization.
   */
  async listUsers(context: AuthContext) {
    this.assertPermission(context, "users", "view");
    const users = await this.userRepository.find({
      where: { organizationId: context.organizationId },
      order: { createdAt: "ASC" },
    });
    const visibleUsers = await this.filterVisibleUsers(
      context,
      context.organizationId,
      users,
    );
    return visibleUsers.map(toUserDto);
  }

  /**
   * Lists users for an explicitly selected organization.
   */
  async listUsersForOrganization(context: AuthContext, organizationId: string) {
    this.ensureOrganizationAccess(context, organizationId, "view");
    await this.getOrganizationOrThrow(organizationId);
    const users = await this.userRepository.find({
      where: { organizationId },
      order: { createdAt: "ASC" },
    });
    const visibleUsers = await this.filterVisibleUsers(
      context,
      organizationId,
      users,
    );
    return visibleUsers.map(toUserDto);
  }

  /**
   * Creates a user in the current organization.
   */
  async createUser(context: AuthContext, payload: CreateUserPayload) {
    this.assertPermission(context, "users", "manage");

    const displayName = requireText(payload.displayName, "用户名称");
    const email = normalizeEmail(payload.email);
    await this.assertUniqueUserEmail(context.organizationId, email);

    const roleId = await this.resolveAssignableRoleId(
      context,
      context.organizationId,
      payload.roleId,
    );

    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName,
        email,
        firstName: normalizeOptionalText(payload.firstName),
        imageUrl: normalizeOptionalText(payload.imageUrl),
        lastName: normalizeOptionalText(payload.lastName),
        mobile: normalizeOptionalText(payload.mobile),
        passwordHash: hashPassword(
          requirePassword(payload.password || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId,
        status: normalizeUserStatus(payload.status),
        organizationId: context.organizationId,
        type: "user",
        username: normalizeOptionalText(payload.username),
        preferredLanguage: "zh-CN",
      }),
    );

    return toUserDto(user);
  }

  /**
   * Creates a user for an explicitly selected organization.
   */
  async createUserForOrganization(
    context: AuthContext,
    organizationId: string,
    payload: CreateUserPayload,
  ) {
    this.ensureOrganizationAccess(context, organizationId, "manage");
    await this.getOrganizationOrThrow(organizationId);

    const displayName = requireText(payload.displayName, "用户名称");
    const email = normalizeEmail(payload.email);
    await this.assertUniqueUserEmail(organizationId, email);

    const roleId = await this.resolveAssignableRoleId(
      context,
      organizationId,
      payload.roleId,
    );
    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName,
        email,
        firstName: normalizeOptionalText(payload.firstName),
        imageUrl: normalizeOptionalText(payload.imageUrl),
        lastName: normalizeOptionalText(payload.lastName),
        mobile: normalizeOptionalText(payload.mobile),
        passwordHash: hashPassword(
          requirePassword(payload.password || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId,
        status: normalizeUserStatus(payload.status),
        organizationId,
        type: "user",
        username: normalizeOptionalText(payload.username),
        preferredLanguage: "zh-CN",
      }),
    );

    return toUserDto(user);
  }

  /**
   * Updates user profile, role, status, and optional password fields.
   */
  async updateUser(
    context: AuthContext,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const isSelf = context.userId === userId;
    const updatesAdministrativeFields =
      payload.password !== undefined ||
      payload.roleId !== undefined ||
      payload.status !== undefined;
    if (!isSelf || updatesAdministrativeFields) {
      this.assertPermission(context, "users", "manage");
    }

    const user = await this.getUserOrThrow(context.organizationId, userId);
    if (!isSelf || updatesAdministrativeFields) {
      await this.assertCanManageUser(context, user);
    }

    if (payload.displayName !== undefined) {
      user.displayName = requireText(payload.displayName, "用户名称");
    }
    if (payload.email !== undefined) {
      const nextEmail = normalizeEmail(payload.email);
      if (nextEmail !== user.email) {
        await this.assertUniqueUserEmail(context.organizationId, nextEmail);
      }
      user.email = nextEmail;
    }
    if (payload.imageUrl !== undefined) {
      user.imageUrl = normalizeOptionalText(payload.imageUrl);
    }
    if (payload.firstName !== undefined) {
      user.firstName = normalizeOptionalText(payload.firstName);
    }
    if (payload.lastName !== undefined) {
      user.lastName = normalizeOptionalText(payload.lastName);
    }
    if (payload.username !== undefined) {
      user.username = normalizeOptionalText(payload.username);
    }
    if (payload.mobile !== undefined) {
      user.mobile = normalizeOptionalText(payload.mobile);
    }
    if (payload.password !== undefined && payload.password.trim()) {
      user.passwordHash = hashPassword(requirePassword(payload.password));
    }
    if (payload.roleId !== undefined) {
      if (user.id === context.userId) {
        throw new ForbiddenException("不能修改自己的角色");
      }
      user.roleId = await this.resolveAssignableRoleId(
        context,
        context.organizationId,
        payload.roleId,
      );
    }
    if (payload.status !== undefined) {
      user.status = normalizeUserStatus(payload.status);
    }

    return toUserDto(await this.userRepository.save(user));
  }

  /**
   * Updates a user inside an explicitly selected organization.
   */
  async updateUserForOrganization(
    context: AuthContext,
    organizationId: string,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    this.ensureOrganizationAccess(context, organizationId, "manage");
    await this.getOrganizationOrThrow(organizationId);
    const user = await this.getUserOrThrow(organizationId, userId);
    await this.assertCanManageUser(context, user);

    if (payload.displayName !== undefined) {
      user.displayName = requireText(payload.displayName, "用户名称");
    }
    if (payload.email !== undefined) {
      const nextEmail = normalizeEmail(payload.email);
      if (nextEmail !== user.email) {
        await this.assertUniqueUserEmail(organizationId, nextEmail);
      }
      user.email = nextEmail;
    }
    if (payload.firstName !== undefined) {
      user.firstName = normalizeOptionalText(payload.firstName);
    }
    if (payload.lastName !== undefined) {
      user.lastName = normalizeOptionalText(payload.lastName);
    }
    if (payload.username !== undefined) {
      user.username = normalizeOptionalText(payload.username);
    }
    if (payload.mobile !== undefined) {
      user.mobile = normalizeOptionalText(payload.mobile);
    }
    if (payload.password !== undefined && payload.password.trim()) {
      user.passwordHash = hashPassword(requirePassword(payload.password));
    }
    if (payload.roleId !== undefined) {
      if (user.id === context.userId) {
        throw new ForbiddenException("不能修改自己的角色");
      }
      user.roleId = await this.resolveAssignableRoleId(
        context,
        organizationId,
        payload.roleId,
      );
    }
    if (payload.status !== undefined) {
      user.status = normalizeUserStatus(payload.status);
    }

    return toUserDto(await this.userRepository.save(user));
  }

  /**
   * Searches current-organization users by common identity fields.
   */
  async searchUsers(context: AuthContext, query: SearchUsersQuery) {
    this.assertPermission(context, "users", "view");
    const search = query.search?.trim().toLowerCase();
    const users = await this.userRepository.find({
      where: { organizationId: context.organizationId },
      order: { createdAt: "ASC" },
    });

    const visibleUsers = await this.filterVisibleUsers(
      context,
      context.organizationId,
      users,
    );

    if (!search) {
      return visibleUsers.map(toUserDto);
    }

    return visibleUsers
      .filter((user) =>
        [
          user.displayName,
          user.email,
          user.firstName,
          user.lastName,
          user.username,
          user.mobile,
        ].some((value) => value?.toLowerCase().includes(search)),
      )
      .map(toUserDto);
  }

  /**
   * Updates a user password with admin or self-service authorization rules.
   */
  async updateUserPassword(
    context: AuthContext,
    userId: string,
    payload: UpdateUserPasswordPayload,
  ) {
    const user = await this.getUserOrThrow(context.organizationId, userId);
    const isSelf = context.userId === user.id;

    if (!isSelf) {
      this.assertPermission(context, "users", "manage");
    } else if (
      payload.currentPassword &&
      !verifyPassword(payload.currentPassword, user.passwordHash)
    ) {
      throw new ForbiddenException("当前密码不正确");
    }

    user.passwordHash = hashPassword(requirePassword(payload.password));
    return toUserDto(await this.userRepository.save(user));
  }

  /**
   * Updates a user's preferred language.
   */
  async updatePreferredLanguage(
    context: AuthContext,
    userId: string,
    payload: UpdatePreferredLanguagePayload,
  ) {
    const user = await this.getUserOrThrow(context.organizationId, userId);
    if (context.userId !== user.id) {
      this.assertPermission(context, "users", "manage");
    }

    const preferredLanguage = normalizePreferredLanguage(
      payload.preferredLanguage,
    );
    user.preferredLanguage = preferredLanguage;
    return toUserDto(await this.userRepository.save(user));
  }

  /**
   * Lists roles available in the current organization.
   */
  async listRoles(context: AuthContext) {
    this.assertPermission(context, "roles", "view");
    const roles = await this.roleRepository.find({
      where: { organizationId: context.organizationId },
      order: { createdAt: "ASC" },
    });
    return roles.filter((role) => this.canViewRole(context, role)).map(toRoleDto);
  }

  /**
   * Lists roles for an explicitly selected organization.
   */
  async listRolesForOrganization(context: AuthContext, organizationId: string) {
    this.ensureOrganizationAccess(context, organizationId, "view");
    await this.getOrganizationOrThrow(organizationId);
    const roles = await this.roleRepository.find({
      where: { organizationId },
      order: { createdAt: "ASC" },
    });
    return roles.filter((role) => this.canViewRole(context, role)).map(toRoleDto);
  }

  /**
   * Replaces enabled permissions for a role after validating menu keys.
   */
  async replaceRolePermissions(
    context: AuthContext,
    roleId: string,
    payload: ReplaceRolePermissionsPayload,
  ) {
    this.assertPermission(context, "roles", "manage");
    const role = await this.getRoleOrThrow(context.organizationId, roleId);
    this.assertCanManageRole(context, role);
    const normalized = normalizeRolePermissions(payload.permissions);
    const allowedPermissions = new Set(await this.listKnownMenuPermissions());

    for (const permission of normalized) {
      if (!allowedPermissions.has(permission.permission)) {
        throw new BadRequestException("存在无效权限项");
      }
      this.assertCanGrantPermission(context, role, permission.permission);
    }

    await this.rolePermissionRepository.delete({
      roleId: role.id,
      organizationId: context.organizationId,
    });

    const saved = await this.rolePermissionRepository.save(
      normalized.map((permission) =>
        this.rolePermissionRepository.create({
          enabled: permission.enabled,
          permission: permission.permission,
          roleId: role.id,
          organizationId: context.organizationId,
        }),
      ),
    );

    return saved.map(toRolePermissionDto);
  }

  /**
   * Lists organization-scoped settings.
   */
  async listSettings(context: AuthContext) {
    this.assertPermission(context, "features", "view");
    return this.listEffectiveOrganizationSettings(context.organizationId);
  }

  /**
   * Lists settings for an explicitly selected organization.
   */
  async listSettingsForOrganization(
    context: AuthContext,
    organizationId: string,
  ) {
    this.ensureOrganizationAccess(context, organizationId, "view");
    await this.getOrganizationOrThrow(organizationId);
    return this.listEffectiveOrganizationSettings(organizationId);
  }

  /**
   * Saves organization-scoped settings from normalized input payloads.
   */
  async saveSettings(context: AuthContext, payload: SaveSettingsPayload) {
    this.assertPermission(context, "features", "manage");
    return this.saveOrganizationSettingOverrides(context.organizationId, payload);
  }

  /**
   * Saves settings for an explicitly selected organization.
   */
  async saveSettingsForOrganization(
    context: AuthContext,
    organizationId: string,
    payload: SaveSettingsPayload,
  ) {
    this.ensureOrganizationAccess(context, organizationId, "manage");
    await this.getOrganizationOrThrow(organizationId);
    return this.saveOrganizationSettingOverrides(organizationId, payload);
  }

  private async listEffectiveOrganizationSettings(organizationId: string) {
    const [organizationSettings, systemSettings] = await Promise.all([
      this.organizationSettingRepository.find({
        where: { organizationId },
        order: { name: "ASC" },
      }),
      this.systemSettingRepository.find({
        order: { name: "ASC" },
      }),
    ]);

    return mergeEffectiveOrganizationSettings(
      organizationSettings,
      systemSettings,
      organizationId,
    );
  }

  private async saveOrganizationSettingOverrides(
    organizationId: string,
    payload: SaveSettingsPayload,
  ) {
    const entries = parseSettingsPayload(payload);

    for (const entry of entries) {
      if (entry.value === null || entry.value === undefined) {
        await this.organizationSettingRepository.delete({
          name: entry.name,
          organizationId,
        });
        continue;
      }

      let setting = await this.organizationSettingRepository.findOne({
        where: {
          name: entry.name,
          organizationId,
        },
      });
      const systemSetting = await this.systemSettingRepository.findOne({
        where: { name: entry.name },
      });
      const normalized = normalizeSettingEntry(entry, [setting, systemSetting]);
      if (!setting) {
        setting = this.organizationSettingRepository.create({
          name: entry.name,
          organizationId,
          value: normalized.value,
          valueOptions: normalized.valueOptions,
          valueType: normalized.valueType,
        });
      } else {
        setting.value = normalized.value;
        setting.valueOptions = normalized.valueOptions;
        setting.valueType = normalized.valueType;
      }
      await this.organizationSettingRepository.save(setting);
    }

    return this.listEffectiveOrganizationSettings(organizationId);
  }

  /**
   * Lists admin menus in display order.
   */
  listMenus(options: ListMenusOptions = {}) {
    return this.menuRepository.find({
      where: options.includeInactive ? {} : { isActive: true },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
  }

  /**
   * Creates an admin menu and adds its permissions to existing roles.
   */
  async createMenu(context: AuthContext, payload: CreateMenuPayload) {
    this.assertPermission(context, "menus", "manage");
    const code = normalizeMenuCode(payload.code);
    const label = requireText(payload.label, "菜单名称");
    const path = normalizeMenuPath(payload.path);
    const parentId = await this.normalizeParentId(payload.parentId);
    await this.assertUniqueMenuCode(code);

    const menu = await this.menuRepository.save(
      this.menuRepository.create({
        code,
        isActive: payload.isActive ?? true,
        label,
        parentId,
        path,
        sortOrder: normalizeSortOrder(payload.sortOrder),
      }),
    );

    await this.addMenuPermissionsForExistingRoles(menu.code);
    return toMenuDto(menu);
  }

  /**
   * Updates an admin menu and keeps permission keys synchronized.
   */
  async updateMenu(
    context: AuthContext,
    menuId: string,
    payload: UpdateMenuPayload,
  ) {
    this.assertPermission(context, "menus", "manage");
    const menu = await this.getMenuOrThrow(menuId);
    const previousCode = menu.code;

    if (payload.code !== undefined) {
      const nextCode = normalizeMenuCode(payload.code);
      if (nextCode !== menu.code) {
        await this.assertUniqueMenuCode(nextCode);
      }
      menu.code = nextCode;
    }
    if (payload.label !== undefined) {
      menu.label = requireText(payload.label, "菜单名称");
    }
    if (payload.path !== undefined) {
      menu.path = normalizeMenuPath(payload.path);
    }
    if (payload.parentId !== undefined) {
      if (payload.parentId === menu.id) {
        throw new BadRequestException("菜单不能选择自身作为父级");
      }
      menu.parentId = await this.normalizeParentId(payload.parentId);
    }
    if (payload.sortOrder !== undefined) {
      menu.sortOrder = normalizeSortOrder(payload.sortOrder);
    }
    if (payload.isActive !== undefined) {
      menu.isActive = Boolean(payload.isActive);
    }

    const saved = await this.menuRepository.save(menu);
    if (previousCode !== saved.code) {
      await this.replaceMenuPermissionCode(previousCode, saved.code);
    }

    return toMenuDto(saved);
  }

  /**
   * Deactivates an admin menu without deleting permission history.
   */
  async deleteMenu(context: AuthContext, menuId: string) {
    this.assertPermission(context, "menus", "manage");
    const menu = await this.getMenuOrThrow(menuId);
    menu.isActive = false;
    return toMenuDto(await this.menuRepository.save(menu));
  }

  /**
   * Applies mutable organization profile fields to an entity.
   */
  private async applyOrganizationPayload(
    org: Organization,
    payload: UpdateOrganizationPayload,
    options: { allowSlugChange: boolean; allowTenantControlChange: boolean },
  ) {
    if (payload.name !== undefined) {
      org.name = requireText(payload.name, "组织名称");
    }
    if (payload.slug !== undefined && options.allowSlugChange) {
      const nextSlug = normalizeSlug(payload.slug, "org");
      if (nextSlug !== org.slug) {
        await this.assertUniqueOrganizationSlug(nextSlug);
      }
      org.slug = nextSlug;
    }
    if (payload.subdomain !== undefined) {
      org.subdomain = normalizeOptionalText(payload.subdomain);
    }
    if (payload.status !== undefined) {
      if (!options.allowTenantControlChange) {
        throw new ForbiddenException("只有平台管理员可以修改组织启用状态");
      }
      org.status = normalizeOrganizationStatus(payload.status);
    }
    if (payload.isDefault !== undefined) {
      if (!options.allowTenantControlChange) {
        throw new ForbiddenException("只有平台管理员可以修改默认组织");
      }
      org.isDefault = Boolean(payload.isDefault);
    }

    org.profileLink = normalizeOptionalTextPayload(
      payload.profileLink,
      org.profileLink,
    );
    org.banner = normalizeOptionalTextPayload(payload.banner, org.banner);
    org.shortDescription = normalizeOptionalTextPayload(
      payload.shortDescription,
      org.shortDescription,
    );
    org.clientFocus = normalizeOptionalTextPayload(
      payload.clientFocus,
      org.clientFocus,
    );
    org.overview = normalizeOptionalTextPayload(payload.overview, org.overview);
    org.imageUrl = normalizeOptionalTextPayload(payload.imageUrl, org.imageUrl);
    org.currency = normalizeOptionalTextPayload(payload.currency, org.currency);
    org.timeZone = normalizeOptionalTextPayload(payload.timeZone, org.timeZone);
    org.regionCode = normalizeOptionalTextPayload(
      payload.regionCode,
      org.regionCode,
    );
    org.brandColor = normalizeOptionalTextPayload(
      payload.brandColor,
      org.brandColor,
    );
    org.dateFormat = normalizeOptionalTextPayload(
      payload.dateFormat,
      org.dateFormat,
    );
    org.officialName = normalizeOptionalTextPayload(
      payload.officialName,
      org.officialName,
    );
    org.website = normalizeOptionalTextPayload(payload.website, org.website);
    org.preferredLanguage = normalizeOptionalTextPayload(
      payload.preferredLanguage,
      org.preferredLanguage,
    );

    if (payload.totalEmployees !== undefined) {
      org.totalEmployees = normalizeOptionalNumber(payload.totalEmployees);
    }
  }

  /**
   * Creates a session token and returns the authenticated admin snapshot.
   */
  private async createLoginResponse(
    organizationId: string,
    userId: string,
    scopeLevel: RequestScopeLevel = "organization",
  ) {
    const token = createAuthSessionToken({ organizationId, scopeLevel, userId });
    const context = await this.requireAuthContext(`Bearer ${token}`);
    return {
      token,
      snapshot: await this.getSnapshot(context),
    };
  }

  private async ensureMenus() {
    await this.deactivateDeprecatedMenus();

    for (const menu of DEFAULT_ADMIN_MENUS) {
      const existing = await this.menuRepository.findOne({
        where: { code: menu.code },
      });
      if (!existing) {
        await this.menuRepository.save(
          this.menuRepository.create({
            ...menu,
            isActive: true,
            parentId: null,
          }),
        );
      } else {
        existing.isActive = true;
        existing.label = menu.label;
        existing.sortOrder = menu.sortOrder;
        existing.path = menu.path;
        await this.menuRepository.save(existing);
      }
    }
  }

  private async deactivateDeprecatedMenus() {
    const deprecatedMenus = await this.menuRepository.find({
      where: DEPRECATED_ADMIN_MENU_CODES.map((code) => ({ code })),
    });

    const nextMenuCodes = new Set<string>(
      DEFAULT_ADMIN_MENUS.map((menu) => menu.code),
    );
    const menusToDisable = deprecatedMenus.filter(
      (menu) => !nextMenuCodes.has(menu.code) && menu.isActive,
    );

    if (menusToDisable.length > 0) {
      for (const menu of menusToDisable) {
        menu.isActive = false;
      }
      await this.menuRepository.save(menusToDisable);
    }
  }

  private async ensureInfrastructureForExistingOrganizations() {
    const organizations = await this.organizationRepository.find();
    for (const org of organizations) {
      await this.ensureOrganizationInfrastructure(org.id);
    }
  }

  private async ensureOrganizationInfrastructure(organizationId: string) {
    const allMenuPermissions = await this.listKnownMenuPermissions();

    for (const systemRole of SYSTEM_ROLES) {
      let role = await this.roleRepository.findOne({
        where: { name: systemRole.name, organizationId },
      });
      if (!role) {
        role = await this.roleRepository.save(
          this.roleRepository.create({
            isSystem: systemRole.isSystem,
            label: systemRole.label,
            name: systemRole.name,
            organizationId,
          }),
        );
      }

      const enabledDefaults = new Set(defaultPermissionsForRole(systemRole.name));
      const existingPermissions = await this.rolePermissionRepository.find({
        where: { roleId: role.id, organizationId },
      });
      const existingPermissionNames = new Set(
        existingPermissions.map((p) => p.permission),
      );
      const missingPermissions = allMenuPermissions.filter(
        (p) => !existingPermissionNames.has(p),
      );

      if (missingPermissions.length > 0) {
        await this.rolePermissionRepository.save(
          missingPermissions.map((permission) =>
            this.rolePermissionRepository.create({
              enabled: enabledDefaults.has(permission),
              permission,
              roleId: role.id,
              organizationId,
            }),
          ),
        );
      }
    }

  }

  private async ensureSystemDefaultSettings() {
    for (const defaultSetting of PLATFORM_ORGANIZATION_SETTING_DEFAULTS) {
      const existing = await this.systemSettingRepository.findOne({
        where: { name: defaultSetting.name },
      });
      if (!existing) {
        await this.systemSettingRepository.save(
          this.systemSettingRepository.create({
            name: defaultSetting.name,
            scope: "global",
            value: defaultSetting.value,
            valueOptions: defaultSetting.valueOptions
              ? [...defaultSetting.valueOptions]
              : null,
            valueType: defaultSetting.valueType,
          }),
        );
      } else {
        existing.valueOptions = defaultSetting.valueOptions
          ? [...defaultSetting.valueOptions]
          : (existing.valueOptions ?? null);
        existing.valueType = defaultSetting.valueType;
        await this.systemSettingRepository.save(existing);
      }
    }
  }

  private async getSystemSettingValue(name: string) {
    const setting = await this.systemSettingRepository.findOne({ where: { name } });
    return setting?.value ?? null;
  }

  private async getSystemSettingBoolean(name: string, fallback: boolean) {
    const value = await this.getSystemSettingValue(name);
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  private async getEnabledPermissions(
    organizationId: string,
    roleId: string | null,
    roleName: string | null,
  ) {
    if (!roleId) return [];
    if (isPlatformAdminRoleName(roleName)) {
      return this.listKnownMenuPermissions();
    }

    const permissions = await this.rolePermissionRepository.find({
      where: { enabled: true, roleId, organizationId },
    });
    return permissions
      .map((p) => p.permission)
      .filter((permission) => {
        if (isPlatformAdminRoleName(roleName)) return true;
        const parsed = parseMenuPermissionKey(permission);
        return parsed ? !isPlatformMenuCode(parsed.menuCode) : true;
      });
  }

  private async listSwitchableOrganizations(context: AuthContext) {
    const user = await this.getUserOrThrow(context.organizationId, context.userId);
    const memberships = await this.userRepository.find({
      where: { email: user.email, status: "active" },
    });
    const organizationIds = [...new Set(memberships.map((item) => item.organizationId).filter(Boolean))] as string[];
    if (!organizationIds.length) return [];
    const organizations = await this.organizationRepository
      .createQueryBuilder("organization")
      .where("organization.id IN (:...organizationIds)", { organizationIds })
      .andWhere("organization.status = :status", { status: "active" })
      .orderBy("organization.createdAt", "ASC")
      .getMany();
    return organizations;
  }

  private assertPermission(
    context: AuthContext,
    menuCode: string,
    action: "manage" | "view",
  ) {
    if (!this.hasPermission(context, menuCode, action)) {
      throw new ForbiddenException("权限不足");
    }
  }

  private assertAnyPermission(
    context: AuthContext,
    action: "manage" | "view",
    menuCodes: string[],
  ) {
    if (menuCodes.some((menuCode) => this.hasPermission(context, menuCode, action))) {
      return;
    }

    throw new ForbiddenException("权限不足");
  }

  private ensurePlatformAdministrator(context: AuthContext) {
    if (!context.isPlatformAdmin) {
      throw new ForbiddenException("只有平台管理员可以访问该功能");
    }
  }

  private async listKnownMenuPermissions(options: ListMenusOptions = {}) {
    const menus = await this.menuRepository.find({
      where: options.includeInactive ? {} : { isActive: true },
    });
    const source = menus.length > 0 ? menus : DEFAULT_ADMIN_MENUS;
    return source.flatMap((menu) => [
      buildMenuPermissionKey(menu.code, "view"),
      buildMenuPermissionKey(menu.code, "manage"),
    ]);
  }

  private async addMenuPermissionsForExistingRoles(menuCode: string) {
    const roles = await this.roleRepository.find();
    for (const role of roles) {
      if (!role.organizationId) continue;
      const enabledDefaults = new Set(defaultPermissionsForRole(role.name));
      for (const action of ["view", "manage"] as const) {
        const permission = buildMenuPermissionKey(menuCode, action);
        const existing = await this.rolePermissionRepository.findOne({
          where: {
            permission,
            roleId: role.id,
            organizationId: role.organizationId,
          },
        });
        if (!existing) {
          await this.rolePermissionRepository.save(
            this.rolePermissionRepository.create({
              enabled: enabledDefaults.has(permission),
              permission,
              roleId: role.id,
              organizationId: role.organizationId,
            }),
          );
        }
      }
    }
  }

  private async replaceMenuPermissionCode(previousCode: string, nextCode: string) {
    const previousView = buildMenuPermissionKey(previousCode, "view");
    const previousManage = buildMenuPermissionKey(previousCode, "manage");
    const permissions = await this.rolePermissionRepository.find({
      where: [{ permission: previousView }, { permission: previousManage }],
    });

    for (const p of permissions) {
      p.permission =
        p.permission === previousView
          ? buildMenuPermissionKey(nextCode, "view")
          : buildMenuPermissionKey(nextCode, "manage");
    }

    if (permissions.length > 0) {
      await this.rolePermissionRepository.save(permissions);
    }
  }

  /**
   * Loads an organization or raises a not-found response.
   */
  private async getOrganizationOrThrow(organizationId: string) {
    const org = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException("组织不存在");
    return org;
  }

  /**
   * Loads a user scoped to an organization or raises a not-found response.
   */
  private async getUserOrThrow(organizationId: string, userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException("用户不存在");
    return user;
  }

  /**
   * Loads a role scoped to an organization or raises a not-found response.
   */
  private async getRoleOrThrow(organizationId: string, roleId: string) {
    const role = await this.roleRepository.findOne({
      where: { id: roleId, organizationId },
    });
    if (!role) throw new NotFoundException("角色不存在");
    return role;
  }

  /**
   * Loads a named system role for an organization.
   */
  private async getSystemRoleOrThrow(organizationId: string, roleName: string) {
    const role = await this.roleRepository.findOne({
      where: { name: roleName, organizationId },
    });
    if (!role) throw new NotFoundException("系统角色不存在");
    return role;
  }

  /**
   * Resolves a role id from explicit, null, or default member input, then
   * verifies the current actor is allowed to assign it.
   */
  async resolveAssignableRoleId(
    context: AuthContext,
    organizationId: string,
    roleId: string | null | undefined,
  ) {
    if (roleId === null) return null;
    const role = roleId
      ? await this.getRoleOrThrow(organizationId, roleId)
      : await this.getSystemRoleOrThrow(organizationId, "member");
    this.assertCanAssignRole(context, role);
    return role.id;
  }

  private canViewRole(context: AuthContext, role: Role) {
    if (context.isPlatformAdmin) return true;
    if (this.hasPermission(context, "organizations", "view")) {
      return !isPlatformAdminRoleName(role.name);
    }
    if (isPlatformAdminRoleName(role.name)) return false;
    return getRoleRank(role.name) <= getRoleRank(context.roleName);
  }

  private canViewRolePermission(
    context: AuthContext,
    role: Role | null,
    permission: string,
  ) {
    if (!role) return false;
    const parsed = parseMenuPermissionKey(permission);
    if (!parsed) return true;
    if (!isPlatformAdminRoleName(role.name) && isPlatformMenuCode(parsed.menuCode)) {
      return false;
    }
    return context.isPlatformAdmin || !isPlatformMenuCode(parsed.menuCode);
  }

  private canViewUser(context: AuthContext, role: Role | null) {
    if (context.isPlatformAdmin) return true;
    if (!role) return true;
    if (this.hasPermission(context, "organizations", "view")) {
      return !isPlatformAdminRoleName(role.name);
    }
    return !isPlatformAdminRoleName(role.name);
  }

  private canManageRole(context: AuthContext, role: Role) {
    if (isPlatformAdminRoleName(role.name)) return false;
    return getRoleRank(role.name) < getRoleRank(context.roleName);
  }

  private assertCanAssignRole(context: AuthContext, role: Role) {
    if (context.isPlatformAdmin) return;
    if (isPlatformAdminRoleName(role.name)) {
      throw new ForbiddenException("不能分配平台管理员角色");
    }
    if (this.hasPermission(context, "organizations", "manage")) return;
    if (getRoleRank(role.name) >= getRoleRank(context.roleName)) {
      throw new ForbiddenException("不能分配同级或上级角色");
    }
  }

  private async assertCanManageUser(context: AuthContext, user: User) {
    if (user.id === context.userId) {
      throw new ForbiddenException("不能修改自己的管理权限");
    }
    if (context.isPlatformAdmin) return;
    if (!user.roleId || !user.organizationId) return;

    const role = await this.roleRepository.findOne({
      where: { id: user.roleId, organizationId: user.organizationId },
    });
    if (!role) return;
    if (isPlatformAdminRoleName(role.name)) {
      throw new ForbiddenException("不能修改平台管理员用户");
    }
    if (this.hasPermission(context, "organizations", "manage")) return;
    if (getRoleRank(role.name) >= getRoleRank(context.roleName)) {
      throw new ForbiddenException("不能修改同级或上级用户");
    }
  }

  private async filterVisibleUsers(
    context: AuthContext,
    organizationId: string,
    users: User[],
  ) {
    if (context.isPlatformAdmin || users.length === 0) return users;

    const roles = await this.roleRepository.find({
      where: { organizationId },
      order: { createdAt: "ASC" },
    });
    const roleById = new Map(roles.map((role) => [role.id, role]));
    return users.filter((user) =>
      this.canViewUser(
        context,
        user.roleId ? (roleById.get(user.roleId) ?? null) : null,
      ),
    );
  }

  private assertCanManageRole(context: AuthContext, role: Role) {
    if (!this.canManageRole(context, role)) {
      throw new ForbiddenException("不能修改同级或上级角色权限");
    }
  }

  private assertCanGrantPermission(
    context: AuthContext,
    role: Role,
    permission: string,
  ) {
    const parsed = parseMenuPermissionKey(permission);
    if (!parsed) return;

    if (!isPlatformAdminRoleName(role.name) && isPlatformMenuCode(parsed.menuCode)) {
      throw new ForbiddenException("组织角色不能授予平台范围权限");
    }

    if (context.isPlatformAdmin) return;
    if (isPlatformMenuCode(parsed.menuCode)) {
      throw new ForbiddenException("组织管理员不能授予平台范围权限");
    }

    if (!hasPermissionKey(context.permissions, parsed.menuCode, parsed.action)) {
      throw new ForbiddenException("不能授予当前角色不具备的权限");
    }
  }

  /**
   * Loads a menu by id or raises a not-found response.
   */
  private async getMenuOrThrow(menuId: string) {
    const menu = await this.menuRepository.findOne({ where: { id: menuId } });
    if (!menu) throw new NotFoundException("菜单不存在");
    return menu;
  }

  /**
   * Validates and normalizes an optional parent menu id.
   */
  private async normalizeParentId(parentId: string | null | undefined) {
    if (!parentId) return null;
    await this.getMenuOrThrow(parentId);
    return parentId;
  }

  /**
   * Ensures an organization slug is not already in use.
   */
  private async assertUniqueOrganizationSlug(slug: string) {
    const existing = await this.organizationRepository.findOne({
      where: { slug },
    });
    if (existing) throw new ConflictException("组织标识已存在");
  }

  /**
   * Ensures an email is unique inside an organization.
   */
  private async assertUniqueUserEmail(organizationId: string, email: string) {
    const existing = await this.userRepository.findOne({
      where: { email, organizationId },
    });
    if (existing) throw new ConflictException("该组织下邮箱已存在");
  }

  /**
   * Ensures a menu code is globally unique.
   */
  private async assertUniqueMenuCode(code: string) {
    const existing = await this.menuRepository.findOne({ where: { code } });
    if (existing) throw new ConflictException("菜单编码已存在");
  }

  /**
   * Allows a development-only default admin password recovery path.
   */
  private async recoverDefaultAdminPassword(user: User, password: string) {
    if (!isDefaultAdminRecoveryEnabled()) {
      return false;
    }
    if (user.email !== DEFAULT_ADMIN_EMAIL || password !== DEFAULT_ADMIN_PASSWORD) {
      return false;
    }
    if (!user.organizationId || !user.roleId) {
      return false;
    }

    const role = await this.roleRepository.findOne({
      where: { id: user.roleId, organizationId: user.organizationId },
    });
    if (!role || !["platform-admin", "owner", "admin"].includes(role.name)) {
      return false;
    }

    user.passwordHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
    await this.userRepository.save(user);
    return true;
  }
}

/**
 * Validates required text input and returns its trimmed value.
 */
function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

/**
 * Validates password input against the admin minimum policy.
 */
function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

/**
 * Converts arbitrary organization text into a URL-safe slug.
 */
function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${fallbackPrefix}-${randomBytes(3).toString("hex")}`;
}

/**
 * Normalizes and validates email addresses for login and user management.
 */
function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

/**
 * Normalizes a menu code for permission key generation.
 */
function normalizeMenuCode(value: string | undefined) {
  const code = value?.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
  if (!code) throw new BadRequestException("菜单编码不能为空");
  return code;
}

/**
 * Normalizes menu paths to leading-slash absolute paths.
 */
function normalizeMenuPath(value: string | undefined) {
  const path = requireText(value, "菜单路径");
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeScopeLevel(value: RequestScopeLevel | undefined) {
  return value === "platform" ? "platform" : "organization";
}

function isPlatformAdminRole(roleName: string | null) {
  return isPlatformAdminRoleName(roleName);
}

function parseMenuPermissionKey(
  permission: string,
): { action: "manage" | "view"; menuCode: string } | null {
  const [prefix, menuCode, action] = permission.split(":");
  if (prefix !== "menu" || !menuCode) return null;
  if (action !== "view" && action !== "manage") return null;
  return { action, menuCode };
}

function hasPermissionKey(
  permissions: string[],
  menuCode: string,
  action: "manage" | "view",
) {
  const expected = buildMenuPermissionKey(menuCode, action);
  const managePermission = buildMenuPermissionKey(menuCode, "manage");
  return (
    permissions.includes(expected) ||
    (action === "view" && permissions.includes(managePermission))
  );
}

/**
 * Trims optional text and stores empty values as null.
 */
function normalizeOptionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

/**
 * Applies optional text payload values without overwriting omitted fields.
 */
function normalizeOptionalTextPayload(
  value: string | null | undefined,
  currentValue: string | null,
) {
  if (value === undefined) return currentValue;
  return normalizeOptionalText(value);
}

/**
 * Converts optional numeric input to a nullable number.
 */
function normalizeOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new BadRequestException("数值格式不正确");
  }
  return numeric;
}

/**
 * Normalizes menu sort order values.
 */
function normalizeSortOrder(value: number | undefined) {
  if (value === undefined || Number.isNaN(Number(value))) return 0;
  return Number(value);
}

/**
 * Validates organization lifecycle status.
 */
function normalizeOrganizationStatus(
  status: OrganizationStatus | undefined,
): OrganizationStatus {
  if (!status) return "active";
  if (!ORGANIZATION_STATUSES.includes(status)) {
    throw new BadRequestException("组织状态不合法");
  }
  return status;
}

/**
 * Validates user lifecycle status.
 */
function normalizeUserStatus(status: UserStatus | undefined): UserStatus {
  if (!status) return "active";
  if (!USER_STATUSES.includes(status)) {
    throw new BadRequestException("用户状态不合法");
  }
  return status;
}

/**
 * Validates preferred language against supported admin language codes.
 */
function normalizePreferredLanguage(value: string | undefined) {
  const preferredLanguage = requireText(value, "偏好语言");
  if (
    !PREFERRED_LANGUAGES.includes(
      preferredLanguage as (typeof PREFERRED_LANGUAGES)[number],
    )
  ) {
    throw new BadRequestException("偏好语言不合法");
  }
  return preferredLanguage as (typeof PREFERRED_LANGUAGES)[number];
}

/**
 * Deduplicates and validates role permission payload entries.
 */
function normalizeRolePermissions(
  permissions: ReplaceRolePermissionsPayload["permissions"],
) {
  const unique = new Map<string, { enabled: boolean; permission: string }>();
  for (const p of permissions ?? []) {
    const name = p.permission?.trim();
    if (!name) throw new BadRequestException("权限项不能为空");
    unique.set(name, { enabled: Boolean(p.enabled), permission: name });
  }
  return [...unique.values()];
}

/**
 * Extracts a bearer token from an authorization header.
 */
function parseBearerToken(authorization: string | undefined) {
  const [scheme, token] = authorization?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}

/**
 * Indicates whether default admin recovery can run in this environment.
 */
function isDefaultAdminRecoveryEnabled() {
  if (process.env.ALLOW_DEFAULT_ADMIN_RECOVERY !== undefined) {
    return process.env.ALLOW_DEFAULT_ADMIN_RECOVERY === "true";
  }
  return process.env.NODE_ENV !== "production";
}

/**
 * Projects organization entities into admin API DTOs.
 */
function toOrganizationDto(org: Organization) {
  return {
    id: org.id,
    banner: org.banner,
    brandColor: org.brandColor,
    clientFocus: org.clientFocus,
    currency: org.currency,
    dateFormat: org.dateFormat,
    imageUrl: org.imageUrl,
    isDefault: org.isDefault,
    name: org.name,
    officialName: org.officialName,
    overview: org.overview,
    preferredLanguage: org.preferredLanguage,
    profileLink: org.profileLink,
    regionCode: org.regionCode,
    shortDescription: org.shortDescription,
    slug: org.slug,
    status: org.status,
    subdomain: org.subdomain,
    timeZone: org.timeZone,
    totalEmployees: org.totalEmployees,
    website: org.website,
  };
}

/**
 * Projects user entities into the admin snapshot and user management response.
 */
function toUserDto(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    mobile: user.mobile,
    imageUrl: user.imageUrl,
    preferredLanguage: user.preferredLanguage,
    emailVerified: user.emailVerified,
    timeZone: user.timeZone,
    roleId: user.roleId,
    status: user.status,
    organizationId: user.organizationId,
    type: user.type,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Projects role entities into admin responses.
 */
function toRoleDto(role: Role) {
  return {
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
    organizationId: role.organizationId,
  };
}

/**
 * Projects role permission entities into admin responses.
 */
function toRolePermissionDto(permission: RolePermission) {
  return {
    id: permission.id,
    enabled: permission.enabled,
    permission: permission.permission,
    roleId: permission.roleId,
    organizationId: permission.organizationId,
  };
}

/**
 * Projects global system setting entities into admin responses.
 */
function toSystemSettingDto(setting: SystemSetting) {
  const valueType = resolveSettingValueType(setting.name, setting.valueType);
  const valueOptions = resolveSettingValueOptions(
    setting.name,
    setting.valueOptions,
  );
  return {
    id: setting.id,
    name: setting.name,
    scope: setting.scope,
    value: maskSettingValue(setting.value, valueType),
    valueOptions,
    valueType,
  };
}

/**
 * Projects menu entities into admin responses.
 */
function toMenuDto(menu: Menu) {
  return {
    id: menu.id,
    code: menu.code,
    label: menu.label,
    path: menu.path,
    parentId: menu.parentId,
    sortOrder: menu.sortOrder,
    isActive: menu.isActive,
  };
}

/**
 * Hashes a password with PBKDF2 for the lightweight admin session model.
 */
function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    "sha256",
  ).toString("base64url");
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

/**
 * Verifies a PBKDF2 password hash created by this module.
 */
function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) return false;

  const [prefix, iterationsValue, salt, hash] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !iterationsValue || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    "sha256",
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
