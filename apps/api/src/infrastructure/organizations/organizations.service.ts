import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  Organization,
  IntegrationToken,
  Permission,
  Role,
  RolePermission,
  UserOrganization,
  type OrganizationStatus,
} from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import { In, IsNull, type EntityManager } from "typeorm";
import type {
  CreateOrganizationPayload,
  ReplaceRolePermissionsPayload,
  UpdateOrganizationPayload,
} from "../../common/admin-api.types.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { MailService } from "../mail/mail.service.js";
import { SettingsService } from "../settings/settings.service.js";
import type { OrganizationRolePayload } from "./organizations.controller.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
    @Inject(MailService)
    private readonly mailService: MailService,
  ) {}

  async list() {
    const organizations = await this.organizations.find({
      order: { createdAt: "ASC" },
      where: { tenantId: this.tenantId },
    });
    return organizations.map(toOrganizationDto);
  }

  async get(organizationId: string) {
    return toOrganizationDto(await this.getOrganizationOrThrow(organizationId));
  }

  async create(
    authorization: string | undefined,
    payload: CreateOrganizationPayload,
  ) {
    requireObjectPayload(payload);
    const userId = await this.requireSessionUserId(authorization);
    const creationEnabled = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.allowOrganizationCreation,
      "true",
    );
    if (creationEnabled !== "true") {
      throw new BadRequestException("平台当前不允许创建组织");
    }

    const name = requireText(payload.name, "组织名称");
    const slug = normalizeSlug(payload.slug || name, "org");
    const isDefault = normalizeBoolean(payload.isDefault, "默认组织");
    const status = normalizeOrganizationStatus(payload.status) ?? "active";
    await this.assertUniqueOrganizationSlug(slug);

    let organization: Organization;
    try {
      organization = await (async (manager) => {
          if (isDefault) {
            await manager.update(
              Organization,
              { deletedAt: IsNull(), isDefault: true, tenantId: this.tenantId },
              { isDefault: false },
            );
          }
          const organization = await manager.save(
            Organization,
            this.organizations.create({
              banner: normalizeNullableText(payload.banner),
              brandColor: normalizeNullableText(payload.brandColor),
              clientFocus: normalizeNullableText(payload.clientFocus),
              createdByUserId: userId,
              currency: normalizeNullableText(payload.currency),
              dateFormat: normalizeNullableText(payload.dateFormat),
              imageUrl: normalizeNullableText(payload.imageUrl),
              isDefault,
              logoUrl: normalizeNullableText(payload.imageUrl),
              name,
              officialName: normalizeNullableText(payload.officialName),
              overview: normalizeNullableText(payload.overview),
              preferredLanguage: normalizeNullableText(payload.preferredLanguage),
              profileLink: normalizeNullableText(payload.profileLink),
              regionCode: normalizeNullableText(payload.regionCode),
              shortDescription: normalizeNullableText(payload.shortDescription),
              slug,
              status,
              subdomain: normalizeNullableText(payload.subdomain),
              tenantId: this.tenantId,
              timeZone: normalizeNullableText(payload.timeZone),
              totalEmployees: normalizeOptionalInteger(payload.totalEmployees),
              website: normalizeNullableText(payload.website),
            }),
          );

          const ownerRole = await this.createDefaultOrganizationRoles(
            organization.id,
            manager,
          );
          await manager.save(
            UserOrganization,
            this.memberships.create({
              displayName: null,
              joinedAt: new Date(),
              organizationId: organization.id,
              roleId: ownerRole.id,
              status: "active",
              tenantId: this.tenantId,
              userId,
            }),
          );
          await this.mailService.ensureDefaultTemplatesForOrganization(
            organization.id,
            manager,
          );
          return organization;
        })(this.manager);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("组织标识或子域名已被使用");
      }
      throw error;
    }

    return toOrganizationDto(organization);
  }

  async update(
    authorization: string | undefined,
    organizationId: string,
    payload: UpdateOrganizationPayload,
  ) {
    requireObjectPayload(payload);
    const organization = await this.getOrganizationOrThrow(organizationId);
    const nextIsDefault =
      payload.isDefault !== undefined
        ? normalizeBoolean(payload.isDefault, "默认组织")
        : undefined;
    const nextStatus =
      payload.status !== undefined
        ? normalizeOrganizationStatus(payload.status)
        : undefined;
    void authorization;

    if (payload.name !== undefined) {
      organization.name = requireText(payload.name, "组织名称");
    }
    if (payload.slug !== undefined) {
      const slug = normalizeSlug(payload.slug, "org");
      if (slug !== organization.slug) {
        await this.assertUniqueOrganizationSlug(slug, organization.id);
      }
      organization.slug = slug;
    }
    if (nextStatus !== undefined) organization.status = nextStatus;
    if (payload.website !== undefined) {
      organization.website = normalizeNullableText(payload.website);
    }
    if (payload.imageUrl !== undefined) {
      organization.imageUrl = normalizeNullableText(payload.imageUrl);
      organization.logoUrl = organization.imageUrl;
    }
    if (payload.banner !== undefined) {
      organization.banner = normalizeNullableText(payload.banner);
    }
    if (payload.brandColor !== undefined) {
      organization.brandColor = normalizeNullableText(payload.brandColor);
    }
    if (payload.clientFocus !== undefined) {
      organization.clientFocus = normalizeNullableText(payload.clientFocus);
    }
    if (payload.currency !== undefined) {
      organization.currency = normalizeNullableText(payload.currency);
    }
    if (payload.dateFormat !== undefined) {
      organization.dateFormat = normalizeNullableText(payload.dateFormat);
    }
    if (nextIsDefault !== undefined) {
      organization.isDefault = nextIsDefault;
    }
    if (payload.officialName !== undefined) {
      organization.officialName = normalizeNullableText(payload.officialName);
    }
    if (payload.overview !== undefined) {
      organization.overview = normalizeNullableText(payload.overview);
    }
    if (payload.preferredLanguage !== undefined) {
      organization.preferredLanguage = normalizeNullableText(
        payload.preferredLanguage,
      );
    }
    if (payload.profileLink !== undefined) {
      organization.profileLink = normalizeNullableText(payload.profileLink);
    }
    if (payload.regionCode !== undefined) {
      organization.regionCode = normalizeNullableText(payload.regionCode);
    }
    if (payload.shortDescription !== undefined) {
      organization.shortDescription = normalizeNullableText(
        payload.shortDescription,
      );
    }
    if (payload.subdomain !== undefined) {
      organization.subdomain = normalizeNullableText(payload.subdomain);
    }
    if (payload.timeZone !== undefined) {
      organization.timeZone = normalizeNullableText(payload.timeZone);
    }
    if (payload.totalEmployees !== undefined) {
      organization.totalEmployees = normalizeOptionalInteger(
        payload.totalEmployees,
      );
    }

    if (nextIsDefault === true) {
      try {
        const saved = await (async (manager) => {
            await manager.update(
              Organization,
              { deletedAt: IsNull(), isDefault: true, tenantId: this.tenantId },
              { isDefault: false },
            );
            return manager.save(Organization, organization);
          })(this.manager);
        return toOrganizationDto(saved);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new BadRequestException("组织标识或子域名已被使用");
        }
        throw error;
      }
    }

    try {
      return toOrganizationDto(await this.organizations.save(organization));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("组织标识或子域名已被使用");
      }
      throw error;
    }
  }

  async delete(organizationId: string) {
    const organization = await this.getOrganizationOrThrow(organizationId);
    const revokedAt = new Date();
    await this.manager.update(
      IntegrationToken,
      {
        organizationId: organization.id,
        revokedAt: IsNull(),
        scope: "organization",
        tenantId: this.tenantId,
      },
      { revokedAt, revokedReason: "organization_deleted" },
    );
    await this.manager.softDelete(Organization, {
      id: organization.id,
      tenantId: this.tenantId,
    });
  }

  async listRoles(organizationId: string) {
    await this.getOrganizationOrThrow(organizationId);
    const roles = await this.roles.find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: true },
      where: { organizationId, scope: "organization", tenantId: this.tenantId },
    });
    return roles.map(toRoleDto);
  }

  async createRole(
    organizationId: string,
    payload: OrganizationRolePayload,
  ) {
    requireObjectPayload(payload);
    await this.getOrganizationOrThrow(organizationId);
    const displayName = requireText(
      payload.displayName ?? payload.name,
      "角色名称",
    );
    const name = normalizeSlug(payload.name ?? displayName, "role");
    await this.assertUniqueRoleName(organizationId, name);

    let role: Role;
    try {
      role = await this.roles.save(
        this.roles.create({
          color: normalizeNullableText(payload.color),
          description: normalizeNullableText(payload.description),
          displayName,
          isSystem: false,
          label: displayName,
          name,
          organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        }),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("角色标识已被使用");
      }
      throw error;
    }
    return toRoleDto(role);
  }

  async updateRole(
    organizationId: string,
    roleId: string,
    payload: Partial<OrganizationRolePayload>,
  ) {
    requireObjectPayload(payload);
    const role = await this.getOrganizationRoleOrThrow(organizationId, roleId);
    if (payload.displayName !== undefined) {
      role.displayName = requireText(payload.displayName, "角色名称");
      role.label = role.displayName;
    }
    if (payload.name !== undefined) {
      const name = normalizeSlug(payload.name, "role");
      if (role.isSystem && name !== role.name) {
        throw new BadRequestException("系统角色标识不能修改");
      }
      if (name !== role.name) {
        await this.assertUniqueRoleName(organizationId, name, role.id);
      }
      role.name = name;
    }
    if (payload.color !== undefined) {
      role.color = normalizeNullableText(payload.color);
    }
    if (payload.description !== undefined) {
      role.description = normalizeNullableText(payload.description);
    }
    try {
      return toRoleDto(await this.roles.save(role));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("角色标识已被使用");
      }
      throw error;
    }
  }

  async replaceRolePermissions(
    organizationId: string,
    roleId: string,
    payload: ReplaceRolePermissionsPayload,
  ) {
    const role = await this.getOrganizationRoleOrThrow(organizationId, roleId);
    if (role.isSystem) {
      throw new BadRequestException("系统角色权限不能替换");
    }
    const permissions = requireReplaceRolePermissionsPayload(payload);
    const records = await Promise.all(
      permissions
        .filter((item) => item.enabled !== false)
        .map((item) => this.getPermissionOrThrow(item.permission, "organization")),
    );

    let saved: RolePermission[] = [];
    {
      const manager = this.manager;
      await revokeOrganizationIntegrationTokensForRole(
        manager,
        this.tenantId,
        organizationId,
        role.id,
      );
      await manager.delete(RolePermission, {
        roleId: role.id,
        tenantId: this.tenantId,
      });
      const nextRows = records.map(({ key, permission }) =>
        this.rolePermissions.create({
          enabled: true,
          organizationId,
          permission: key,
          permissionId: permission.id,
          roleId: role.id,
          tenantId: this.tenantId,
        }),
      );
      saved =
        nextRows.length > 0
          ? await manager.save(RolePermission, nextRows)
          : [];
    }
    return saved;
  }

  async deleteRole(organizationId: string, roleId: string) {
    const role = await this.getOrganizationRoleOrThrow(organizationId, roleId);
    if (role.isSystem) throw new BadRequestException("系统角色不能删除");
    {
      const manager = this.manager;
      await revokeOrganizationIntegrationTokensForRole(
        manager,
        this.tenantId,
        organizationId,
        role.id,
      );
      await manager.update(
        UserOrganization,
        { organizationId, roleId: role.id, tenantId: this.tenantId },
        { roleId: null },
      );
      await manager.delete(RolePermission, {
        roleId: role.id,
        tenantId: this.tenantId,
      });
      await manager.delete(Role, { id: role.id, tenantId: this.tenantId });
    }
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const organization = await this.organizations.findOne({
      where: { id: organizationId, tenantId: this.tenantId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
    return organization;
  }

  private async assertUniqueOrganizationSlug(
    slug: string,
    exceptOrganizationId?: string,
  ) {
    const existing = await this.organizations.findOne({
      where: { slug, tenantId: this.tenantId },
    });
    if (existing && existing.id !== exceptOrganizationId) {
      throw new BadRequestException("组织标识已被使用");
    }
  }

  private async getOrganizationRoleOrThrow(
    organizationId: string,
    roleId: string,
  ) {
    const role = await this.roles.findOne({
      relations: { rolePermissions: true },
      where: {
        id: roleId,
        organizationId,
        scope: "organization",
        tenantId: this.tenantId,
      },
    });
    if (!role) throw new NotFoundException("角色不存在");
    return role;
  }

  private async assertUniqueRoleName(
    organizationId: string,
    name: string,
    exceptRoleId?: string,
  ) {
    const existing = await this.roles.findOne({
      where: {
        name,
        organizationId,
        scope: "organization",
        tenantId: this.tenantId,
      },
    });
    if (existing && existing.id !== exceptRoleId) {
      throw new BadRequestException("角色标识已被使用");
    }
  }

  private async createDefaultOrganizationRoles(
    organizationId: string,
    manager: EntityManager = this.manager,
  ) {
    const roles = [
      {
        color: "#2563eb",
        description: "Organization owner with all organization permissions.",
        displayName: "Owner",
        name: "owner",
      },
      {
        color: "#16a34a",
        description: "Organization admin with management permissions.",
        displayName: "Admin",
        name: "admin",
      },
      {
        color: "#64748b",
        description: "Organization member with standard permissions.",
        displayName: "Member",
        name: "member",
      },
      {
        color: "#94a3b8",
        description: "Read-only organization viewer.",
        displayName: "Viewer",
        name: "viewer",
      },
    ];

    const savedRoles = await manager.save(
      Role,
      roles.map((role) =>
        this.roles.create({
          ...role,
          isSystem: true,
          label: role.displayName,
          organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        }),
      ),
    );

    const defaultPermissions = await manager.find(Permission, {
      order: { code: "ASC" },
      where: [{ scope: "organization" }, { scope: "own" }],
    });
    for (const role of savedRoles) {
      const records = defaultPermissions.filter((permission) =>
        permission.defaultRoles?.includes(role.name),
      );
      const rows = records.map((permission) =>
        this.rolePermissions.create({
          enabled: true,
          organizationId,
          permission: permission.code ?? "",
          permissionId: permission.id,
          roleId: role.id,
          tenantId: this.tenantId,
        }),
      );
      if (rows.length > 0) {
        await manager.save(RolePermission, rows);
      }
    }

    const ownerRole = savedRoles.find((role) => role.name === "owner");
    if (!ownerRole) throw new BadRequestException("组织 Owner 角色初始化失败");
    return ownerRole;
  }

  private async getPermissionOrThrow(permissionKey: string | undefined, scope: string) {
    const key = requirePermissionCode(permissionKey);
    const acceptedScopes =
      scope === "organization" ? ["organization", "own"] : [scope];
    const permission = await this.permissions.findOne({
      where: acceptedScopes.map((item) => ({
        code: key,
        scope: item as Permission["scope"],
      })),
    });
    if (!permission) throw new BadRequestException("权限目录不存在");
    return { key, permission };
  }

  private async requireSessionUserId(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    try {
      const session = await this.authSessionService.validateAccessToken(token);
      return session.userId;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }

  private get tenantId() {
    return this.tenantContext.current()!.tenantId;
  }

  private get manager() {
    return this.tenantContext.current()!.manager;
  }

  private get organizations() {
    return this.tenantContext.repository(Organization);
  }

  private get permissions() {
    return this.tenantContext.repository(Permission);
  }

  private get roles() {
    return this.tenantContext.repository(Role);
  }

  private get rolePermissions() {
    return this.tenantContext.repository(RolePermission);
  }

  private get memberships() {
    return this.tenantContext.repository(UserOrganization);
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  const text = value.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function requireObjectPayload(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
}

function normalizeNullableText(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("文本格式不正确");
  }
  const text = value.trim();
  return text || null;
}

function normalizeOptionalInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException("人数必须是非负整数");
  }
  return value;
}

function normalizeBoolean(value: unknown, label: string, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  return value;
}

function normalizeOrganizationStatus(value: unknown): OrganizationStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "active" || value === "suspended") return value;
  throw new BadRequestException("组织状态无效");
}

function normalizeSlug(value: unknown, fallbackPrefix: string) {
  if (value !== undefined && typeof value !== "string") {
    throw new BadRequestException("标识格式不正确");
  }
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

function requirePermissionCode(permission: string | undefined) {
  const value = requireText(permission, "权限");
  return value;
}

function requireReplaceRolePermissionsPayload(
  value: ReplaceRolePermissionsPayload,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  if (value.permissions === undefined || value.permissions === null) {
    return [];
  }
  if (!Array.isArray(value.permissions)) {
    throw new BadRequestException("权限列表格式不正确");
  }

  return value.permissions.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BadRequestException("权限项格式不正确");
    }
    if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
      throw new BadRequestException("权限启用状态格式不正确");
    }
    if (item.enabled !== false) {
      requirePermissionCode(item.permission);
    }
    return item;
  });
}

async function revokeOrganizationIntegrationTokensForRole(
  manager: EntityManager,
  tenantId: string,
  organizationId: string,
  roleId: string,
) {
  const memberships = await manager.find(UserOrganization, {
    select: { userId: true },
    where: { organizationId, roleId, tenantId },
  });
  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  if (userIds.length === 0) return;

  await manager.update(
    IntegrationToken,
    {
      organizationId,
      ownerUserId: In(userIds),
      revokedAt: IsNull(),
      scope: "organization",
      tenantId,
    },
    { revokedAt: new Date() },
  );
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}

function toOrganizationDto(organization: Organization) {
  return {
    banner: organization.banner,
    brandColor: organization.brandColor,
    clientFocus: organization.clientFocus,
    createdAt: organization.createdAt,
    createdByUserId: organization.createdByUserId,
    currency: organization.currency,
    dateFormat: organization.dateFormat,
    id: organization.id,
    imageUrl: organization.imageUrl,
    isDefault: organization.isDefault,
    logoUrl: organization.logoUrl,
    name: organization.name,
    officialName: organization.officialName,
    overview: organization.overview,
    preferredLanguage: organization.preferredLanguage,
    profileLink: organization.profileLink,
    regionCode: organization.regionCode,
    shortDescription: organization.shortDescription,
    slug: organization.slug,
    status: organization.status as OrganizationStatus,
    subdomain: organization.subdomain,
    timeZone: organization.timeZone,
    totalEmployees: organization.totalEmployees,
    updatedAt: organization.updatedAt,
    website: organization.website,
  };
}

function toRoleDto(role: Role) {
  return {
    color: role.color,
    description: role.description,
    displayName: role.displayName ?? role.label,
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
    organizationId: role.organizationId,
    permissions:
      role.rolePermissions?.map((permission) => ({
        enabled: permission.enabled,
        id: permission.id,
        organizationId: permission.organizationId,
        permission: permission.permission,
        permissionId: permission.permissionId,
        roleId: permission.roleId,
      })) ?? [],
    scope: role.scope,
  };
}
