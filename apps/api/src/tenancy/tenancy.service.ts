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
import { In, IsNull, Repository } from "typeorm";
import {
  DEFAULT_ADMIN_MENUS,
  Menu,
  Organization,
  OrganizationStatus,
  Role,
  RolePermission,
  SYSTEM_ROLES,
  Tenant,
  TenantSetting,
  TenantStatus,
  User,
  UserOrganization,
  UserStatus,
  buildMenuPermissionKey,
  defaultPermissionsForRole,
} from "@hermes-swarm/core";
import {
  AdminContext,
  AdminLoginPayload,
  CreateMenuPayload,
  CreateOrganizationPayload,
  CreateTenantPayload,
  CreateUserPayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  UpdateMenuPayload,
  UpdateOrganizationPayload,
  UpdateTenantPayload,
  UpdateUserPayload,
} from "./tenancy.types.js";
import {
  createAdminSessionToken,
  parseAdminSessionToken,
} from "./admin-session.js";

const TENANT_STATUSES: TenantStatus[] = ["active", "suspended"];
const ORGANIZATION_STATUSES: OrganizationStatus[] = ["active", "suspended"];
const USER_STATUSES: UserStatus[] = ["active", "disabled"];
const DEFAULT_ADMIN_PASSWORD = "admin123456";
const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;

@Injectable()
export class TenancyService implements OnModuleInit {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserOrganization)
    private readonly userOrganizationRepository: Repository<UserOrganization>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(TenantSetting)
    private readonly tenantSettingRepository: Repository<TenantSetting>,
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
  ) {}

  async onModuleInit() {
    await this.ensureMenus();
    await this.ensureInfrastructureForExistingTenants();
  }

  async getPublicBootstrap() {
    const [tenantCount, userCount, tenants, organizations, menus] =
      await Promise.all([
        this.tenantRepository.count(),
        this.userRepository.count(),
        this.tenantRepository.find({ order: { createdAt: "ASC" } }),
        this.organizationRepository.find({ order: { createdAt: "ASC" } }),
        this.listMenus(),
      ]);

    return {
      onboardingRequired: tenantCount === 0 || userCount === 0,
      tenants: tenants.map(toTenantDto),
      organizations: organizations.map(toOrganizationDto),
      menus: menus.map(toMenuDto),
    };
  }

  async onboard(payload: OnboardingPayload) {
    const hasUsers = (await this.userRepository.count()) > 0;
    if (hasUsers) {
      throw new ConflictException("系统已经初始化，请使用登录入口");
    }

    const tenantName = requireText(payload.tenantName, "租户名称");
    const tenantSlug = normalizeSlug(payload.tenantSlug || tenantName, "tenant");
    await this.assertUniqueTenantSlug(tenantSlug);

    const tenant = await this.tenantRepository.save(
      this.tenantRepository.create({
        name: tenantName,
        slug: tenantSlug,
        status: "active",
        subdomain: tenantSlug,
      }),
    );

    await this.ensureTenantInfrastructure(tenant.id);

    const organization = await this.createOrReuseDefaultOrganization(
      tenant.id,
      payload.organizationName || `${tenantName} Organization`,
    );

    const ownerRole = await this.getSystemRoleOrThrow(tenant.id, "owner");
    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName: requireText(payload.adminName, "管理员名称"),
        email: normalizeEmail(payload.adminEmail),
        passwordHash: hashPassword(
          requirePassword(payload.adminPassword || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId: ownerRole.id,
        status: "active",
        tenantId: tenant.id,
        type: "user",
      }),
    );

    await this.userOrganizationRepository.save(
      this.userOrganizationRepository.create({
        isActive: true,
        isDefault: true,
        organizationId: organization.id,
        preferences: null,
        tenantId: tenant.id,
        userId: user.id,
      }),
    );

    return this.createLoginResponse(tenant.id, organization.id, user.id);
  }

  async login(payload: AdminLoginPayload) {
    const tenantId = requireText(payload.tenantId, "租户");
    const organizationId = requireText(payload.organizationId, "组织");
    const email = normalizeEmail(payload.email);
    const password = requireText(payload.password, "密码");

    const [tenant, organization, user] = await Promise.all([
      this.tenantRepository.findOne({ where: { id: tenantId } }),
      this.organizationRepository.findOne({
        where: { id: organizationId, tenantId },
      }),
      this.userRepository.findOne({
        where: { email, tenantId },
      }),
    ]);

    if (!tenant || tenant.status !== "active") {
      throw new UnauthorizedException("租户不可用");
    }
    if (!organization || organization.status !== "active") {
      throw new UnauthorizedException("组织不可用");
    }
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户名或密码不正确");
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException("用户名或密码不正确");
    }

    const membership = await this.userOrganizationRepository.findOne({
      where: { organizationId, tenantId, userId: user.id },
    });

    if (!membership?.isActive) {
      throw new UnauthorizedException("用户不属于该组织");
    }

    return this.createLoginResponse(tenant.id, organization.id, user.id);
  }

  async requireAdminContext(authorization: string | undefined) {
    const tokenPayload = parseAdminSessionToken(parseBearerToken(authorization));
    if (!tokenPayload) {
      throw new UnauthorizedException("登录已失效");
    }

    const [tenant, organization, user, membership] = await Promise.all([
      this.tenantRepository.findOne({ where: { id: tokenPayload.tenantId } }),
      this.organizationRepository.findOne({
        where: {
          id: tokenPayload.organizationId,
          tenantId: tokenPayload.tenantId,
        },
      }),
      this.userRepository.findOne({
        where: {
          id: tokenPayload.userId,
          tenantId: tokenPayload.tenantId,
        },
      }),
      this.userOrganizationRepository.findOne({
        where: {
          organizationId: tokenPayload.organizationId,
          tenantId: tokenPayload.tenantId,
          userId: tokenPayload.userId,
        },
      }),
    ]);

    if (!tenant || tenant.status !== "active") {
      throw new UnauthorizedException("租户不可用");
    }
    if (!organization || organization.status !== "active") {
      throw new UnauthorizedException("组织不可用");
    }
    if (!user || user.status !== "active" || !membership?.isActive) {
      throw new UnauthorizedException("用户不可用");
    }

    const permissions = await this.getEnabledPermissions(
      tokenPayload.tenantId,
      user.roleId,
    );

    return {
      organizationId: organization.id,
      permissions,
      roleId: user.roleId,
      tenantId: tenant.id,
      userId: user.id,
    } satisfies AdminContext;
  }

  async getSnapshot(context: AdminContext) {
    await this.ensureTenantInfrastructure(context.tenantId);

    const [
      tenant,
      organizations,
      users,
      userOrganizations,
      roles,
      rolePermissions,
      tenantSettings,
      menus,
    ] = await Promise.all([
      this.tenantRepository.findOne({ where: { id: context.tenantId } }),
      this.organizationRepository.find({
        where: { tenantId: context.tenantId },
        order: { createdAt: "ASC" },
      }),
      this.userRepository.find({
        where: { tenantId: context.tenantId },
        order: { createdAt: "ASC" },
      }),
      this.userOrganizationRepository.find({
        where: { tenantId: context.tenantId },
        order: { createdAt: "ASC" },
      }),
      this.roleRepository.find({
        where: { tenantId: context.tenantId },
        order: { createdAt: "ASC" },
      }),
      this.rolePermissionRepository.find({
        where: { tenantId: context.tenantId },
        order: { roleId: "ASC", permission: "ASC" },
      }),
      this.tenantSettingRepository.find({
        where: { tenantId: context.tenantId },
        order: { name: "ASC" },
      }),
      this.listMenus(),
    ]);

    if (!tenant) {
      throw new UnauthorizedException("租户不可用");
    }

    const currentOrganization = organizations.find(
      (organization) => organization.id === context.organizationId,
    );
    const currentUser = users.find((user) => user.id === context.userId);
    const currentMembership = userOrganizations.find(
      (membership) =>
        membership.organizationId === context.organizationId &&
        membership.userId === context.userId,
    );
    const currentRole = roles.find((role) => role.id === context.roleId) ?? null;

    if (!currentOrganization || !currentUser || !currentMembership) {
      throw new UnauthorizedException("登录已失效");
    }

    return {
      currentUser: {
        membership: toUserOrganizationDto(currentMembership),
        organization: toOrganizationDto(currentOrganization),
        permissions: context.permissions,
        role: currentRole ? toRoleDto(currentRole) : null,
        tenant: toTenantDto(tenant),
        user: toUserDto(currentUser),
      },
      menus: menus.map(toMenuDto),
      organizations: organizations.map(toOrganizationDto),
      rolePermissions: rolePermissions.map(toRolePermissionDto),
      roles: roles.map(toRoleDto),
      tenantSettings: tenantSettings.map(toTenantSettingDto),
      tenants: [toTenantDto(tenant)],
      userOrganizations: userOrganizations.map(toUserOrganizationDto),
      users: users.map(toUserDto),
    };
  }

  async listTenants(context: AdminContext) {
    this.assertPermission(context, "tenants", "view");
    const tenant = await this.tenantRepository.findOne({
      where: { id: context.tenantId },
    });
    return tenant ? [toTenantDto(tenant)] : [];
  }

  async createTenant(context: AdminContext, payload: CreateTenantPayload) {
    this.assertPermission(context, "tenants", "manage");
    const name = requireText(payload.name, "租户名称");
    const slug = normalizeSlug(payload.slug || name, "tenant");
    await this.assertUniqueTenantSlug(slug);
    const tenant = await this.tenantRepository.save(
      this.tenantRepository.create({
        name,
        slug,
        status: normalizeTenantStatus(payload.status),
        subdomain: payload.subdomain?.trim() || null,
      }),
    );
    await this.ensureTenantInfrastructure(tenant.id);
    return toTenantDto(tenant);
  }

  async updateTenant(
    context: AdminContext,
    tenantId: string,
    payload: UpdateTenantPayload,
  ) {
    this.assertPermission(context, "tenants", "manage");
    if (tenantId !== context.tenantId) {
      throw new ForbiddenException("不能修改其他租户");
    }

    const tenant = await this.getTenantOrThrow(tenantId);

    if (payload.name !== undefined) {
      tenant.name = requireText(payload.name, "租户名称");
    }
    if (payload.slug !== undefined) {
      const nextSlug = normalizeSlug(payload.slug, "tenant");
      if (nextSlug !== tenant.slug) {
        await this.assertUniqueTenantSlug(nextSlug);
      }
      tenant.slug = nextSlug;
    }
    if (payload.subdomain !== undefined) {
      tenant.subdomain = payload.subdomain?.trim() || null;
    }
    if (payload.status !== undefined) {
      tenant.status = normalizeTenantStatus(payload.status);
    }

    return toTenantDto(await this.tenantRepository.save(tenant));
  }

  async listOrganizations(context: AdminContext) {
    this.assertPermission(context, "organizations", "view");
    const organizations = await this.organizationRepository.find({
      where: { tenantId: context.tenantId },
      order: { createdAt: "ASC" },
    });
    return organizations.map(toOrganizationDto);
  }

  async createOrganization(
    context: AdminContext,
    payload: CreateOrganizationPayload,
  ) {
    this.assertPermission(context, "organizations", "manage");
    const name = requireText(payload.name, "组织名称");
    const slug = normalizeSlug(payload.slug || name, "organization");
    const status = normalizeOrganizationStatus(payload.status);

    await this.assertUniqueOrganizationSlug(context.tenantId, slug);

    const organization = await this.organizationRepository.save(
      this.organizationRepository.create({
        isDefault: false,
        name,
        slug,
        status,
        tenantId: context.tenantId,
      }),
    );

    return toOrganizationDto(organization);
  }

  async updateOrganization(
    context: AdminContext,
    organizationId: string,
    payload: UpdateOrganizationPayload,
  ) {
    this.assertPermission(context, "organizations", "manage");
    const organization = await this.getOrganizationOrThrow(
      context.tenantId,
      organizationId,
    );

    if (payload.name !== undefined) {
      organization.name = requireText(payload.name, "组织名称");
    }
    if (payload.slug !== undefined) {
      const nextSlug = normalizeSlug(payload.slug, "organization");
      if (nextSlug !== organization.slug) {
        await this.assertUniqueOrganizationSlug(context.tenantId, nextSlug);
      }
      organization.slug = nextSlug;
    }
    if (payload.status !== undefined) {
      organization.status = normalizeOrganizationStatus(payload.status);
    }

    return toOrganizationDto(
      await this.organizationRepository.save(organization),
    );
  }

  async listUsers(context: AdminContext, organizationId: string) {
    this.assertPermission(context, "users", "view");
    await this.getOrganizationOrThrow(context.tenantId, organizationId);
    const memberships = await this.userOrganizationRepository.find({
      where: { organizationId, tenantId: context.tenantId },
    });

    if (memberships.length === 0) {
      return [];
    }

    const users = await this.userRepository.find({
      where: {
        id: In(memberships.map((membership) => membership.userId)),
        tenantId: context.tenantId,
      },
      order: { createdAt: "ASC" },
    });

    return users.map(toUserDto);
  }

  async createUser(
    context: AdminContext,
    organizationId: string,
    payload: CreateUserPayload,
  ) {
    this.assertPermission(context, "users", "manage");
    await this.getOrganizationOrThrow(context.tenantId, organizationId);

    const displayName = requireText(payload.displayName, "用户名称");
    const email = normalizeEmail(payload.email);
    await this.assertUniqueUserEmail(context.tenantId, email);

    const roleId = await this.normalizeRoleId(context.tenantId, payload.roleId);
    const user = await this.userRepository.save(
      this.userRepository.create({
        displayName,
        email,
        passwordHash: hashPassword(
          requirePassword(payload.password || DEFAULT_ADMIN_PASSWORD),
        ),
        roleId,
        status: normalizeUserStatus(payload.status),
        tenantId: context.tenantId,
        type: "user",
      }),
    );

    await this.userOrganizationRepository.save(
      this.userOrganizationRepository.create({
        isActive: true,
        isDefault: true,
        organizationId,
        preferences: null,
        tenantId: context.tenantId,
        userId: user.id,
      }),
    );

    return toUserDto(user);
  }

  async updateUser(
    context: AdminContext,
    organizationId: string,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    this.assertPermission(context, "users", "manage");
    const user = await this.getUserInOrganizationOrThrow(
      context.tenantId,
      organizationId,
      userId,
    );

    if (payload.displayName !== undefined) {
      user.displayName = requireText(payload.displayName, "用户名称");
    }
    if (payload.email !== undefined) {
      const nextEmail = normalizeEmail(payload.email);
      if (nextEmail !== user.email) {
        await this.assertUniqueUserEmail(context.tenantId, nextEmail);
      }
      user.email = nextEmail;
    }
    if (payload.password !== undefined && payload.password.trim()) {
      user.passwordHash = hashPassword(requirePassword(payload.password));
    }
    if (payload.roleId !== undefined) {
      user.roleId = await this.normalizeRoleId(context.tenantId, payload.roleId);
    }
    if (payload.status !== undefined) {
      user.status = normalizeUserStatus(payload.status);
    }

    return toUserDto(await this.userRepository.save(user));
  }

  async listRoles(context: AdminContext) {
    this.assertPermission(context, "roles", "view");
    const roles = await this.roleRepository.find({
      where: { tenantId: context.tenantId },
      order: { createdAt: "ASC" },
    });
    return roles.map(toRoleDto);
  }

  async replaceRolePermissions(
    context: AdminContext,
    roleId: string,
    payload: ReplaceRolePermissionsPayload,
  ) {
    this.assertPermission(context, "permissions", "manage");
    const role = await this.getRoleOrThrow(context.tenantId, roleId);
    const normalized = normalizeRolePermissions(payload.permissions);
    const allowedPermissions = new Set(this.listKnownMenuPermissions());

    for (const permission of normalized) {
      if (!allowedPermissions.has(permission.permission)) {
        throw new BadRequestException("存在无效权限项");
      }
    }

    await this.rolePermissionRepository.delete({
      roleId: role.id,
      tenantId: context.tenantId,
    });

    const saved = await this.rolePermissionRepository.save(
      normalized.map((permission) =>
        this.rolePermissionRepository.create({
          enabled: permission.enabled,
          permission: permission.permission,
          roleId: role.id,
          tenantId: context.tenantId,
        }),
      ),
    );

    return saved.map(toRolePermissionDto);
  }

  listMenus() {
    return this.menuRepository.find({
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
  }

  async createMenu(context: AdminContext, payload: CreateMenuPayload) {
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

  async updateMenu(
    context: AdminContext,
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

  private async createLoginResponse(
    tenantId: string,
    organizationId: string,
    userId: string,
  ) {
    const context = await this.requireAdminContext(
      `Bearer ${createAdminSessionToken({ organizationId, tenantId, userId })}`,
    );
    const token = createAdminSessionToken({ organizationId, tenantId, userId });
    return {
      token,
      snapshot: await this.getSnapshot(context),
    };
  }

  private async ensureMenus() {
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

  private async ensureInfrastructureForExistingTenants() {
    const tenants = await this.tenantRepository.find();
    for (const tenant of tenants) {
      await this.ensureTenantInfrastructure(tenant.id);
    }
  }

  private async ensureTenantInfrastructure(tenantId: string) {
    const allMenuPermissions = this.listKnownMenuPermissions();

    for (const systemRole of SYSTEM_ROLES) {
      let role = await this.roleRepository.findOne({
        where: { name: systemRole.name, tenantId },
      });
      if (!role) {
        role = await this.roleRepository.save(
          this.roleRepository.create({
            isSystem: systemRole.isSystem,
            label: systemRole.label,
            name: systemRole.name,
            tenantId,
          }),
        );
      }

      const enabledDefaults = new Set(defaultPermissionsForRole(systemRole.name));
      const existingPermissions = await this.rolePermissionRepository.find({
        where: { roleId: role.id, tenantId },
      });
      const existingPermissionNames = new Set(
        existingPermissions.map((permission) => permission.permission),
      );
      const missingPermissions = allMenuPermissions.filter(
        (permission) => !existingPermissionNames.has(permission),
      );

      if (missingPermissions.length > 0) {
        await this.rolePermissionRepository.save(
          missingPermissions.map((permission) =>
            this.rolePermissionRepository.create({
              enabled: enabledDefaults.has(permission),
              permission,
              roleId: role.id,
              tenantId,
            }),
          ),
        );
      }
    }

    await this.ensureTenantSetting(
      tenantId,
      "auth.passwordPolicy.minLength",
      "8",
    );
  }

  private async ensureTenantSetting(
    tenantId: string,
    name: string,
    value: string,
  ) {
    const existing = await this.tenantSettingRepository.findOne({
      where: { name, tenantId },
    });
    if (!existing) {
      await this.tenantSettingRepository.save(
        this.tenantSettingRepository.create({ name, tenantId, value }),
      );
    }
  }

  private async createOrReuseDefaultOrganization(
    tenantId: string,
    organizationName: string,
  ) {
    const name = requireText(organizationName, "组织名称");
    const slug = normalizeSlug(name, "organization");
    let organization =
      (await this.organizationRepository.findOne({
        where: { slug, tenantId },
      })) ??
      (await this.organizationRepository.findOne({
        where: { slug, tenantId: IsNull() },
      }));

    if (!organization) {
      organization = this.organizationRepository.create({
        isDefault: true,
        name,
        slug,
        status: "active",
        tenantId,
      });
    } else {
      organization.isDefault = true;
      organization.name = organization.name || name;
      organization.status = "active";
      organization.tenantId = tenantId;
    }

    return this.organizationRepository.save(organization);
  }

  private async getEnabledPermissions(tenantId: string, roleId: string | null) {
    if (!roleId) {
      return [];
    }

    const permissions = await this.rolePermissionRepository.find({
      where: { enabled: true, roleId, tenantId },
    });

    return permissions.map((permission) => permission.permission);
  }

  private assertPermission(
    context: AdminContext,
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
      const enabledDefaults = new Set(defaultPermissionsForRole(role.name));
      for (const action of ["view", "manage"] as const) {
        const permission = buildMenuPermissionKey(menuCode, action);
        const existing = await this.rolePermissionRepository.findOne({
          where: { permission, roleId: role.id, tenantId: role.tenantId },
        });
        if (!existing) {
          await this.rolePermissionRepository.save(
            this.rolePermissionRepository.create({
              enabled: enabledDefaults.has(permission),
              permission,
              roleId: role.id,
              tenantId: role.tenantId,
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

    for (const permission of permissions) {
      permission.permission =
        permission.permission === previousView
          ? buildMenuPermissionKey(nextCode, "view")
          : buildMenuPermissionKey(nextCode, "manage");
    }

    if (permissions.length > 0) {
      await this.rolePermissionRepository.save(permissions);
    }
  }

  private async getTenantOrThrow(tenantId: string) {
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException("租户不存在");
    }
    return tenant;
  }

  private async getOrganizationOrThrow(tenantId: string, organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId, tenantId },
    });
    if (!organization) {
      throw new NotFoundException("组织不存在");
    }
    return organization;
  }

  private async getUserInOrganizationOrThrow(
    tenantId: string,
    organizationId: string,
    userId: string,
  ) {
    const membership = await this.userOrganizationRepository.findOne({
      where: { organizationId, tenantId, userId },
    });
    if (!membership) {
      throw new NotFoundException("用户不存在或不属于该组织");
    }

    const user = await this.userRepository.findOne({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    return user;
  }

  private async getRoleOrThrow(tenantId: string, roleId: string) {
    const role = await this.roleRepository.findOne({
      where: { id: roleId, tenantId },
    });
    if (!role) {
      throw new NotFoundException("角色不存在");
    }
    return role;
  }

  private async getSystemRoleOrThrow(tenantId: string, roleName: string) {
    const role = await this.roleRepository.findOne({
      where: { name: roleName, tenantId },
    });
    if (!role) {
      throw new NotFoundException("系统角色不存在");
    }
    return role;
  }

  private async normalizeRoleId(
    tenantId: string,
    roleId: string | null | undefined,
  ) {
    if (roleId === null) {
      return null;
    }
    if (roleId) {
      return (await this.getRoleOrThrow(tenantId, roleId)).id;
    }
    return (await this.getSystemRoleOrThrow(tenantId, "member")).id;
  }

  private async getMenuOrThrow(menuId: string) {
    const menu = await this.menuRepository.findOne({ where: { id: menuId } });
    if (!menu) {
      throw new NotFoundException("菜单不存在");
    }
    return menu;
  }

  private async normalizeParentId(parentId: string | null | undefined) {
    if (!parentId) {
      return null;
    }
    await this.getMenuOrThrow(parentId);
    return parentId;
  }

  private async assertUniqueTenantSlug(slug: string) {
    const existing = await this.tenantRepository.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException("租户标识已存在");
    }
  }

  private async assertUniqueOrganizationSlug(tenantId: string, slug: string) {
    const existing = await this.organizationRepository.findOne({
      where: { slug, tenantId },
    });
    if (existing) {
      throw new ConflictException("组织标识已存在");
    }
  }

  private async assertUniqueUserEmail(tenantId: string, email: string) {
    const existing = await this.userRepository.findOne({
      where: { email, tenantId },
    });
    if (existing) {
      throw new ConflictException("该租户下邮箱已存在");
    }
  }

  private async assertUniqueMenuCode(code: string) {
    const existing = await this.menuRepository.findOne({ where: { code } });
    if (existing) {
      throw new ConflictException("菜单编码已存在");
    }
  }
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return text;
}

function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) {
    throw new BadRequestException("密码至少需要 8 位");
  }
  return password;
}

function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${fallbackPrefix}-${randomBytes(3).toString("hex")}`;
}

function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function normalizeMenuCode(value: string | undefined) {
  const code = value?.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
  if (!code) {
    throw new BadRequestException("菜单编码不能为空");
  }
  return code;
}

function normalizeMenuPath(value: string | undefined) {
  const path = requireText(value, "菜单路径");
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeSortOrder(value: number | undefined) {
  if (value === undefined || Number.isNaN(Number(value))) {
    return 0;
  }
  return Number(value);
}

function normalizeTenantStatus(status: TenantStatus | undefined): TenantStatus {
  if (!status) {
    return "active";
  }
  if (!TENANT_STATUSES.includes(status)) {
    throw new BadRequestException("租户状态不合法");
  }
  return status;
}

function normalizeOrganizationStatus(
  status: OrganizationStatus | undefined,
): OrganizationStatus {
  if (!status) {
    return "active";
  }
  if (!ORGANIZATION_STATUSES.includes(status)) {
    throw new BadRequestException("组织状态不合法");
  }
  return status;
}

function normalizeUserStatus(status: UserStatus | undefined): UserStatus {
  if (!status) {
    return "active";
  }
  if (!USER_STATUSES.includes(status)) {
    throw new BadRequestException("用户状态不合法");
  }
  return status;
}

function normalizeRolePermissions(
  permissions: ReplaceRolePermissionsPayload["permissions"],
) {
  const unique = new Map<string, { enabled: boolean; permission: string }>();

  for (const permission of permissions ?? []) {
    const permissionName = permission.permission?.trim();
    if (!permissionName) {
      throw new BadRequestException("权限项不能为空");
    }
    unique.set(permissionName, {
      enabled: Boolean(permission.enabled),
      permission: permissionName,
    });
  }

  return [...unique.values()];
}

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

function verifyPassword(password: string, storedHash: string | null | undefined) {
  if (!storedHash) {
    return false;
  }

  const [prefix, iterationsValue, salt, hash] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !iterationsValue || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

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

function parseBearerToken(authorization: string | undefined) {
  const [scheme, token] = authorization?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }
  return token;
}

function toTenantDto(tenant: Tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    subdomain: tenant.subdomain,
  };
}

function toOrganizationDto(organization: Organization) {
  return {
    id: organization.id,
    isDefault: organization.isDefault,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    tenantId: organization.tenantId,
  };
}

function toUserDto(user: User) {
  return {
    displayName: user.displayName,
    email: user.email,
    firstName: user.firstName,
    id: user.id,
    lastName: user.lastName,
    roleId: user.roleId,
    status: user.status,
    tenantId: user.tenantId,
    type: user.type,
    username: user.username,
  };
}

function toUserOrganizationDto(membership: UserOrganization) {
  return {
    id: membership.id,
    isActive: membership.isActive,
    isDefault: membership.isDefault,
    organizationId: membership.organizationId,
    preferences: membership.preferences,
    tenantId: membership.tenantId,
    userId: membership.userId,
  };
}

function toRoleDto(role: Role) {
  return {
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
    tenantId: role.tenantId,
  };
}

function toRolePermissionDto(permission: RolePermission) {
  return {
    enabled: permission.enabled,
    id: permission.id,
    permission: permission.permission,
    roleId: permission.roleId,
    tenantId: permission.tenantId,
  };
}

function toTenantSettingDto(setting: TenantSetting) {
  return {
    id: setting.id,
    name: setting.name,
    tenantId: setting.tenantId,
    value: setting.value,
  };
}

function toMenuDto(menu: Menu) {
  return {
    code: menu.code,
    id: menu.id,
    isActive: menu.isActive,
    label: menu.label,
    parentId: menu.parentId,
    path: menu.path,
    sortOrder: menu.sortOrder,
  };
}
