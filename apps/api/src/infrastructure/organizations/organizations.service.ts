import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  PlatformMember,
  Role,
  RolePermission,
  UserOrganization,
  type OrganizationStatus,
} from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import { Repository } from "typeorm";
import type {
  CreateOrganizationPayload,
  ReplaceRolePermissionsPayload,
  UpdateOrganizationPayload,
} from "../../common/admin-api.types.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { MailService } from "../mail/mail.service.js";
import { SettingsService } from "../settings/settings.service.js";
import type { OrganizationRolePayload } from "./organizations.controller.js";

const PLATFORM_ORGANIZATION_CONTROL_PERMISSIONS = [
  "organization.platform_organization.create:platform",
  "organization.platform_organization.delete:platform",
];

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
    @Inject(MailService)
    private readonly mailService: MailService,
  ) {}

  async list() {
    const organizations = await this.organizationRepository.find({
      order: { createdAt: "ASC" },
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
    await this.assertUniqueOrganizationSlug(slug);

    const organization = await this.organizationRepository.save(
      this.organizationRepository.create({
        banner: normalizeNullableText(payload.banner),
        brandColor: normalizeNullableText(payload.brandColor),
        clientFocus: normalizeNullableText(payload.clientFocus),
        createdByUserId: userId,
        currency: normalizeNullableText(payload.currency),
        dateFormat: normalizeNullableText(payload.dateFormat),
        imageUrl: normalizeNullableText(payload.imageUrl),
        isDefault: Boolean(payload.isDefault),
        logoUrl: normalizeNullableText(payload.imageUrl),
        name,
        officialName: normalizeNullableText(payload.officialName),
        overview: normalizeNullableText(payload.overview),
        preferredLanguage: normalizeNullableText(payload.preferredLanguage),
        profileLink: normalizeNullableText(payload.profileLink),
        regionCode: normalizeNullableText(payload.regionCode),
        shortDescription: normalizeNullableText(payload.shortDescription),
        slug,
        status: payload.status ?? "active",
        subdomain: normalizeNullableText(payload.subdomain),
        timeZone: normalizeNullableText(payload.timeZone),
        totalEmployees: normalizeOptionalInteger(payload.totalEmployees),
        website: normalizeNullableText(payload.website),
      }),
    );

    const ownerRole = await this.createDefaultOrganizationRoles(organization.id);
    await this.mailService.ensureDefaultTemplatesForOrganization(organization.id);
    await this.membershipRepository.save(
      this.membershipRepository.create({
        displayName: null,
        joinedAt: new Date(),
        organizationId: organization.id,
        roleId: ownerRole.id,
        status: "active",
        userId,
      }),
    );

    return toOrganizationDto(organization);
  }

  async update(
    authorization: string | undefined,
    organizationId: string,
    payload: UpdateOrganizationPayload,
  ) {
    const organization = await this.getOrganizationOrThrow(organizationId);
    const updatesPlatformControls =
      payload.isDefault !== undefined || payload.status !== undefined;

    if (updatesPlatformControls) {
      await this.assertCanUpdatePlatformOrganizationControls(authorization);
    }

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
    if (payload.status !== undefined) organization.status = payload.status;
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
    if (payload.isDefault !== undefined) {
      organization.isDefault = Boolean(payload.isDefault);
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

    return toOrganizationDto(
      await this.organizationRepository.save(organization),
    );
  }

  async delete(organizationId: string) {
    const organization = await this.getOrganizationOrThrow(organizationId);
    await this.organizationRepository.delete({ id: organization.id });
  }

  async listRoles(organizationId: string) {
    await this.getOrganizationOrThrow(organizationId);
    const roles = await this.roleRepository.find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: true },
      where: { organizationId, scope: "organization" },
    });
    return roles.map(toRoleDto);
  }

  async createRole(
    organizationId: string,
    payload: OrganizationRolePayload,
  ) {
    await this.getOrganizationOrThrow(organizationId);
    const displayName = requireText(
      payload.displayName ?? payload.name,
      "角色名称",
    );
    const name = normalizeSlug(payload.name ?? displayName, "role");
    await this.assertUniqueRoleName(organizationId, name);

    const role = await this.roleRepository.save(
      this.roleRepository.create({
        color: normalizeNullableText(payload.color),
        description: normalizeNullableText(payload.description),
        displayName,
        isSystem: false,
        label: displayName,
        name,
        organizationId,
        scope: "organization",
      }),
    );
    return toRoleDto(role);
  }

  async updateRole(
    organizationId: string,
    roleId: string,
    payload: Partial<OrganizationRolePayload>,
  ) {
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
    return toRoleDto(await this.roleRepository.save(role));
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
    const permissions = payload.permissions ?? [];

    await this.rolePermissionRepository.delete({ roleId: role.id });
    const records = await Promise.all(
      permissions
        .filter((item) => item.permission && item.enabled !== false)
        .map((item) => this.getPermissionOrThrow(item.permission, "organization")),
    );

    return this.rolePermissionRepository.save(
      records.map(({ key, permission }) =>
        this.rolePermissionRepository.create({
          enabled: true,
          organizationId,
          permission: key,
          permissionId: permission.id,
          roleId: role.id,
        }),
      ),
    );
  }

  async deleteRole(organizationId: string, roleId: string) {
    const role = await this.getOrganizationRoleOrThrow(organizationId, roleId);
    if (role.isSystem) throw new BadRequestException("系统角色不能删除");
    await this.roleRepository.delete({ id: role.id });
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
    return organization;
  }

  private async assertUniqueOrganizationSlug(
    slug: string,
    exceptOrganizationId?: string,
  ) {
    const existing = await this.organizationRepository.findOne({
      where: { slug },
    });
    if (existing && existing.id !== exceptOrganizationId) {
      throw new BadRequestException("组织标识已被使用");
    }
  }

  private async getOrganizationRoleOrThrow(
    organizationId: string,
    roleId: string,
  ) {
    const role = await this.roleRepository.findOne({
      relations: { rolePermissions: true },
      where: { id: roleId, organizationId, scope: "organization" },
    });
    if (!role) throw new NotFoundException("角色不存在");
    return role;
  }

  private async assertUniqueRoleName(
    organizationId: string,
    name: string,
    exceptRoleId?: string,
  ) {
    const existing = await this.roleRepository.findOne({
      where: { name, organizationId, scope: "organization" },
    });
    if (existing && existing.id !== exceptRoleId) {
      throw new BadRequestException("角色标识已被使用");
    }
  }

  private async createDefaultOrganizationRoles(organizationId: string) {
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

    const savedRoles = await Promise.all(
      roles.map((role) =>
        this.roleRepository.save(
          this.roleRepository.create({
            ...role,
            isSystem: true,
            label: role.displayName,
            organizationId,
            scope: "organization",
          }),
        ),
      ),
    );

    for (const role of savedRoles) {
      const records = (
        await this.permissionRepository.find({
          order: { code: "ASC" },
          where: [{ scope: "organization" }, { scope: "own" }],
        })
      ).filter((permission) =>
        permission.defaultRoles?.includes(role.name),
      );
      await this.rolePermissionRepository.save(
        records.map((permission) =>
          this.rolePermissionRepository.create({
            enabled: true,
            organizationId,
            permission: permission.code ?? "",
            permissionId: permission.id,
            roleId: role.id,
          }),
        ),
      );
    }

    const ownerRole = savedRoles.find((role) => role.name === "owner");
    if (!ownerRole) throw new BadRequestException("组织 Owner 角色初始化失败");
    return ownerRole;
  }

  private async getPermissionOrThrow(permissionKey: string | undefined, scope: string) {
    const key = requirePermissionCode(permissionKey);
    const acceptedScopes =
      scope === "organization" ? ["organization", "own"] : [scope];
    const permission = await this.permissionRepository.findOne({
      where: acceptedScopes.map((item) => ({
        code: key,
        scope: item as Permission["scope"],
      })),
    });
    if (!permission) throw new BadRequestException("权限目录不存在");
    return { key, permission };
  }

  private async assertCanUpdatePlatformOrganizationControls(
    authorization: string | undefined,
  ) {
    const userId = await this.requireSessionUserId(authorization);
    const platformMembership = await this.platformMemberRepository.findOne({
      where: { status: "active", userId },
    });
    if (!platformMembership?.roleId) {
      throw new ForbiddenException("缺少平台组织管理权限");
    }
    const roleId = platformMembership.roleId;

    const permission = await this.rolePermissionRepository.findOne({
      where: PLATFORM_ORGANIZATION_CONTROL_PERMISSIONS.map((permission) => ({
        enabled: true,
        permission,
        roleId,
      })),
    });
    if (!permission) {
      throw new ForbiddenException("缺少平台组织管理权限");
    }
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
}

function requireText(value: string | undefined | null, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function normalizeOptionalInteger(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new BadRequestException("人数必须是非负整数");
  }
  return value;
}

function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
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
