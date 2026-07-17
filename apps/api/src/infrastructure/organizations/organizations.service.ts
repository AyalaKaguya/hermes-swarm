import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Organization,
  Ticket,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { IsNull } from "typeorm";
import type {
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
} from "../../common/admin-api.types.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { OrganizationRolesService } from "./organization-roles.service.js";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly organizationRoles: OrganizationRolesService,
  ) {}

  async list() {
    const { tenantId } = this.tenantContext.current()!;
    const organizations = await this.tenantContext.repository(Organization).find({
      order: { createdAt: "ASC" },
      where: { tenantId },
    });
    return organizations.map(toOrganizationDto);
  }

  async get(organizationId: string) {
    return toOrganizationDto(await this.requireOrganization(organizationId));
  }

  async create(createdByUserId: string, payload: CreateOrganizationPayload) {
    const context = this.tenantContext.current()!;
    const parentOrganizationId = requireText(
      payload?.parentOrganizationId,
      "父组织",
    );
    const parent = await this.requireOrganization(parentOrganizationId);
    if (parent.status !== "active") throw new BadRequestException("父组织不可用");

    const name = requireText(payload?.name, "组织名称");
    const slug = normalizeSlug(payload?.slug ?? name);
    await this.ensureSlugAvailable(slug);
    const organization = this.tenantContext.repository(Organization).create({
      createdByUserId,
      name,
      parentOrganizationId,
      slug,
      status: "active",
      tenantId: context.tenantId,
    });
    const saved = await this.tenantContext.repository(Organization).save(organization);
    const roles = await this.organizationRoles.bootstrap(saved.id);
    const ownerRole = roles.get("owner");
    if (!ownerRole) throw new Error("Organization Owner role was not provisioned.");
    const membership = await this.tenantContext.repository(UserOrganization).save(
      this.tenantContext.repository(UserOrganization).create({
        displayName: null,
        isDefault: false,
        joinedAt: new Date(),
        organizationId: saved.id,
        status: "active",
        tenantId: context.tenantId,
        userId: createdByUserId,
      }),
    );
    await context.manager.insert(UserOrganizationRole, {
      membershipId: membership.id,
      organizationId: saved.id,
      roleId: ownerRole.id,
      tenantId: context.tenantId,
    });
    return toOrganizationDto(saved);
  }

  async update(organizationId: string, payload: UpdateOrganizationPayload) {
    const organization = await this.requireOrganization(organizationId);
    const isRoot = organization.parentOrganizationId === null;
    if (payload?.name !== undefined) {
      organization.name = requireText(payload.name, "组织名称");
    }
    if (payload?.slug !== undefined) {
      const slug = normalizeSlug(payload.slug);
      if (slug !== organization.slug) await this.ensureSlugAvailable(slug, organization.id);
      organization.slug = slug;
    }
    if (payload?.status !== undefined) {
      if (payload.status !== "active" && payload.status !== "suspended") {
        throw new BadRequestException("组织状态无效");
      }
      if (isRoot && payload.status !== "active") {
        throw new BadRequestException("根组织不能停用");
      }
      organization.status = payload.status;
    }
    if (payload?.parentOrganizationId !== undefined) {
      const parentOrganizationId = payload.parentOrganizationId;
      if (isRoot && parentOrganizationId !== null) {
        throw new BadRequestException("根组织不能移动");
      }
      if (!isRoot) {
        const parentId = requireText(parentOrganizationId, "父组织");
        await this.assertValidParent(organization.id, parentId);
        organization.parentOrganizationId = parentId;
      }
    }
    return toOrganizationDto(
      await this.tenantContext.repository(Organization).save(organization),
    );
  }

  async delete(organizationId: string) {
    const organization = await this.requireOrganization(organizationId);
    if (!organization.parentOrganizationId) {
      throw new BadRequestException("根组织不能删除");
    }
    const context = this.tenantContext.current()!;
    const [children, memberships, tickets] = await Promise.all([
      this.tenantContext.repository(Organization).count({
        where: { parentOrganizationId: organization.id, tenantId: context.tenantId },
      }),
      this.tenantContext.repository(UserOrganization).count({
        where: { organizationId: organization.id, status: "active", tenantId: context.tenantId },
      }),
      this.tenantContext.repository(Ticket).count({
        where: { sourceOrganizationId: organization.id, tenantId: context.tenantId },
      }),
    ]);
    if (children || memberships || tickets) {
      throw new ConflictException("组织仍有子组织、有效成员或工单，不能删除");
    }
    await this.tenantContext.repository(Organization).softRemove(organization);
    return { deleted: true, id: organization.id };
  }

  private async assertValidParent(organizationId: string, parentId: string) {
    if (organizationId === parentId) throw new BadRequestException("组织不能作为自己的父级");
    const parent = await this.requireOrganization(parentId);
    if (parent.status !== "active") throw new BadRequestException("父组织不可用");
    const { manager, tenantId } = this.tenantContext.current()!;
    const rows = (await manager.query(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM organizations
        WHERE tenant_id = $1 AND parent_organization_id = $2 AND deleted_at IS NULL
        UNION ALL
        SELECT child.id FROM organizations child
        JOIN descendants parent ON child.parent_organization_id = parent.id
        WHERE child.tenant_id = $1 AND child.deleted_at IS NULL
      ) SELECT id FROM descendants WHERE id = $3 LIMIT 1`,
      [tenantId, organizationId, parentId],
    )) as Array<{ id: string }>;
    if (rows.length) throw new BadRequestException("组织层级不能形成循环");
  }

  private async requireOrganization(organizationId: string) {
    const id = requireText(organizationId, "组织");
    const { tenantId } = this.tenantContext.current()!;
    const organization = await this.tenantContext.repository(Organization).findOne({
      where: { id, tenantId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
    return organization;
  }

  private async ensureSlugAvailable(slug: string, excludingId?: string) {
    const { tenantId } = this.tenantContext.current()!;
    const existing = await this.tenantContext.repository(Organization).findOne({
      where: { deletedAt: IsNull(), slug, tenantId },
    });
    if (existing && existing.id !== excludingId) {
      throw new ConflictException("组织标识已存在");
    }
  }
}

function toOrganizationDto(organization: Organization) {
  return {
    createdAt: organization.createdAt,
    createdByUserId: organization.createdByUserId,
    id: organization.id,
    name: organization.name,
    parentOrganizationId: organization.parentOrganizationId,
    slug: organization.slug,
    status: organization.status,
    updatedAt: organization.updatedAt,
  };
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function normalizeSlug(value: unknown) {
  const slug = requireText(value, "组织标识")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new BadRequestException("组织标识无效");
  return slug;
}
