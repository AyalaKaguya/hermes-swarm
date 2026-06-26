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
  User,
  UserStatus,
  buildMenuPermissionKey,
  defaultPermissionsForRole,
} from "@hermes-swarm/core";
import {
  AuthContext,
  CreateMenuPayload,
  CreateOrganizationPayload,
  CreateUserPayload,
  LoginPayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  SaveSettingsPayload,
  SearchUsersQuery,
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

const ORGANIZATION_STATUSES: OrganizationStatus[] = ["active", "suspended"];
const USER_STATUSES: UserStatus[] = ["active", "disabled"];
const PREFERRED_LANGUAGES = ["en", "zh-CN", "zh-Hans", "zh-Hant"] as const;
const DEFAULT_ADMIN_EMAIL = "admin@hermes.local";
const DEFAULT_ADMIN_PASSWORD = "admin123456";
const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;

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
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
  ) {}

  async onModuleInit() {
    await this.ensureMenus();
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
   * the owner account.
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

    const ownerRole = await this.getSystemRoleOrThrow(organization.id, "owner");
    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName: requireText(payload.adminName, "管理员名称"),
        email: normalizeEmail(payload.adminEmail),
        passwordHash: hashPassword(
          requirePassword(payload.adminPassword || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId: ownerRole.id,
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

    const permissions = await this.getEnabledPermissions(
      tokenPayload.organizationId,
      user.roleId,
    );

    return {
      organizationId: organization.id,
      permissions,
      roleId: user.roleId,
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
      menus,
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
      this.listMenus(),
    ]);

    if (!organization) {
      throw new UnauthorizedException("组织不可用");
    }

    const currentUser = users.find((u) => u.id === context.userId);
    const currentRole = roles.find((r) => r.id === context.roleId) ?? null;

    if (!currentUser) {
      throw new UnauthorizedException("登录已失效");
    }

    return {
      currentUser: {
        organization: toOrganizationDto(organization),
        permissions: context.permissions,
        role: currentRole ? toRoleDto(currentRole) : null,
        user: toUserDto(currentUser),
      },
      menus: menus.map(toMenuDto),
      organization: toOrganizationDto(organization),
      organizations: [toOrganizationDto(organization)],
      rolePermissions: rolePermissions.map(toRolePermissionDto),
      roles: roles.map(toRoleDto),
      settings: organizationSettings.map(toOrganizationSettingDto),
      users: users.map(toUserDto),
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
   * Lists all organizations after checking organization view permission.
   */
  async listOrganizations(context: AuthContext) {
    this.assertPermission(context, "organizations", "view");
    const organizations = await this.organizationRepository.find({
      order: { createdAt: "ASC" },
    });
    return organizations.map(toOrganizationDto);
  }

  /**
   * Creates an organization and provisions its default admin infrastructure.
   */
  async createOrganization(
    context: AuthContext,
    payload: CreateOrganizationPayload,
  ) {
    this.assertPermission(context, "organizations", "manage");

    const name = requireText(payload.name, "组织名称");
    const slug = normalizeSlug(payload.slug || name, "org");
    await this.assertUniqueOrganizationSlug(slug);

    const organization = this.organizationRepository.create({
      name,
      slug,
      status: normalizeOrganizationStatus(payload.status),
      subdomain: normalizeOptionalText(payload.subdomain),
    });
    await this.applyOrganizationPayload(organization, payload, {
      allowSlugChange: false,
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
    this.assertPermission(context, "organizations", "manage");
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
    this.assertPermission(context, "organizations", "manage");
    const org = await this.getOrganizationOrThrow(organizationId);
    await this.applyOrganizationPayload(org, payload, {
      allowSlugChange: true,
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
    return users.map(toUserDto);
  }

  /**
   * Creates a user in the current organization.
   */
  async createUser(context: AuthContext, payload: CreateUserPayload) {
    this.assertPermission(context, "users", "manage");

    const displayName = requireText(payload.displayName, "用户名称");
    const email = normalizeEmail(payload.email);
    await this.assertUniqueUserEmail(context.organizationId, email);

    const roleId = await this.normalizeRoleId(
      context.organizationId,
      payload.roleId,
    );

    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName,
        email,
        imageUrl: normalizeOptionalText(payload.imageUrl),
        passwordHash: hashPassword(
          requirePassword(payload.password || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId,
        status: normalizeUserStatus(payload.status),
        organizationId: context.organizationId,
        type: "user",
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
    this.assertPermission(context, "users", "manage");
    const user = await this.getUserOrThrow(context.organizationId, userId);

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
    if (payload.password !== undefined && payload.password.trim()) {
      user.passwordHash = hashPassword(requirePassword(payload.password));
    }
    if (payload.roleId !== undefined) {
      user.roleId = await this.normalizeRoleId(
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
   * Searches current-organization users by common identity fields.
   */
  async searchUsers(context: AuthContext, query: SearchUsersQuery) {
    this.assertPermission(context, "users", "view");
    const search = query.search?.trim().toLowerCase();
    const users = await this.userRepository.find({
      where: { organizationId: context.organizationId },
      order: { createdAt: "ASC" },
    });

    if (!search) {
      return users.map(toUserDto);
    }

    return users
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
    return roles.map(toRoleDto);
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
    const normalized = normalizeRolePermissions(payload.permissions);
    const allowedPermissions = new Set(this.listKnownMenuPermissions());

    for (const permission of normalized) {
      if (!allowedPermissions.has(permission.permission)) {
        throw new BadRequestException("存在无效权限项");
      }
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
    const settings = await this.organizationSettingRepository.find({
      where: { organizationId: context.organizationId },
      order: { name: "ASC" },
    });
    return settings.map(toOrganizationSettingDto);
  }

  /**
   * Saves organization-scoped settings from normalized input payloads.
   */
  async saveSettings(context: AuthContext, payload: SaveSettingsPayload) {
    this.assertPermission(context, "features", "manage");
    const entries = normalizeSettingsPayload(payload);
    const saved: OrganizationSetting[] = [];

    for (const entry of entries) {
      let setting = await this.organizationSettingRepository.findOne({
        where: {
          name: entry.name,
          organizationId: context.organizationId,
        },
      });
      if (!setting) {
        setting = this.organizationSettingRepository.create({
          name: entry.name,
          organizationId: context.organizationId,
          value: entry.value,
        });
      } else {
        setting.value = entry.value;
      }
      saved.push(await this.organizationSettingRepository.save(setting));
    }

    return saved.map(toOrganizationSettingDto);
  }

  /**
   * Lists admin menus in display order.
   */
  listMenus() {
    return this.menuRepository.find({
      where: { isActive: true },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
  }

  /**
   * Creates an admin menu and adds its permissions to existing roles.
   */
  async createMenu(context: AuthContext, payload: CreateMenuPayload) {
    this.assertPermission(context, "features", "manage");
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
    this.assertPermission(context, "features", "manage");
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
   * Applies mutable organization profile fields to an entity.
   */
  private async applyOrganizationPayload(
    org: Organization,
    payload: UpdateOrganizationPayload,
    options: { allowSlugChange: boolean },
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
      org.status = normalizeOrganizationStatus(payload.status);
    }
    if (payload.isDefault !== undefined) {
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
  private async createLoginResponse(organizationId: string, userId: string) {
    const token = createAuthSessionToken({ organizationId, userId });
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
    const allMenuPermissions = this.listKnownMenuPermissions();

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

    await this.ensureOrganizationSetting(
      organizationId,
      "auth.passwordPolicy.minLength",
      "8",
    );
  }

  private async ensureOrganizationSetting(
    organizationId: string,
    name: string,
    value: string,
  ) {
    const existing = await this.organizationSettingRepository.findOne({
      where: { name, organizationId },
    });
    if (!existing) {
      await this.organizationSettingRepository.save(
        this.organizationSettingRepository.create({
          name,
          organizationId,
          value,
        }),
      );
    }
  }

  private async getEnabledPermissions(organizationId: string, roleId: string | null) {
    if (!roleId) return [];
    const permissions = await this.rolePermissionRepository.find({
      where: { enabled: true, roleId, organizationId },
    });
    return permissions.map((p) => p.permission);
  }

  private assertPermission(
    context: AuthContext,
    menuCode: string,
    action: "manage" | "view",
  ) {
    const expected = buildMenuPermissionKey(menuCode, action);
    const managerPermission = buildMenuPermissionKey(menuCode, "manage");
    const allowed =
      context.permissions.includes(expected) ||
      (action === "view" && context.permissions.includes(managerPermission));

    if (!allowed) {
      throw new ForbiddenException("权限不足");
    }
  }

  private listKnownMenuPermissions() {
    return DEFAULT_ADMIN_MENUS.flatMap((menu) => [
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
   * Resolves a role id from explicit, null, or default member input.
   */
  private async normalizeRoleId(
    organizationId: string,
    roleId: string | null | undefined,
  ) {
    if (roleId === null) return null;
    if (roleId) return (await this.getRoleOrThrow(organizationId, roleId)).id;
    return (await this.getSystemRoleOrThrow(organizationId, "member")).id;
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
    if (!role || !["admin", "owner"].includes(role.name)) {
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
 * Normalizes settings input from xpert-style arrays or key-value maps.
 */
function normalizeSettingsPayload(payload: SaveSettingsPayload) {
  const entries = Array.isArray((payload as { settings?: unknown }).settings)
    ? (payload as {
        settings: Array<{
          name?: string;
          value?: string | number | boolean | null;
        }>;
      }).settings.map((item) => ({
        name: requireText(item.name, "设置名称"),
        value: stringifySettingValue(item.value),
      }))
    : Object.entries(payload)
        .filter(([key]) => key !== "settings")
        .map(([name, value]) => ({
          name: requireText(name, "设置名称"),
          value: stringifySettingValue(value),
        }));

  if (entries.length === 0) {
    throw new BadRequestException("设置不能为空");
  }

  return entries;
}

/**
 * Serializes primitive and structured setting values for text storage.
 */
function stringifySettingValue(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
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
 * Projects organization setting entities into admin responses.
 */
function toOrganizationSettingDto(setting: OrganizationSetting) {
  return {
    id: setting.id,
    name: setting.name,
    organizationId: setting.organizationId,
    value: setting.value,
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
