import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Department,
  DepartmentDispatchRelation,
  Organization,
  UserDepartment,
  UserOrganization,
  type DepartmentDispatchType,
  type DepartmentStatus,
} from "@hermes-swarm/core";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import type {
  DepartmentDispatchPayload,
  DepartmentMemberPayload,
  DepartmentPayload,
} from "./departments.controller.js";

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(tenantId: string, organizationId: string) {
    await this.requireOrganization(tenantId, organizationId);
    return this.departments.find({
      order: { name: "ASC" },
      where: { organizationId, tenantId },
    });
  }

  async create(
    tenantId: string,
    organizationId: string,
    payload: DepartmentPayload,
  ) {
    await this.requireOrganization(tenantId, organizationId);
    const name = requireText(payload?.name, "部门名称");
    const slug = normalizeSlug(payload?.slug ?? name);
    const parentDepartmentId = normalizeNullableId(payload?.parentDepartmentId);
    if (parentDepartmentId) {
      await this.requireDepartment(tenantId, organizationId, parentDepartmentId);
    }
    await this.assertUniqueSlug(tenantId, organizationId, slug);

    return this.departments.save(
      this.departments.create({
        code: normalizeNullableText(payload?.code),
        description: normalizeNullableText(payload?.description),
        name,
        organizationId,
        parentDepartmentId,
        slug,
        status: normalizeStatus(payload?.status),
        tenantId,
      }),
    );
  }

  async update(
    tenantId: string,
    organizationId: string,
    departmentId: string,
    payload: Partial<DepartmentPayload>,
  ) {
    const department = await this.requireDepartment(
      tenantId,
      organizationId,
      departmentId,
    );
    if (payload.name !== undefined) {
      department.name = requireText(payload.name, "部门名称");
    }
    if (payload.slug !== undefined) {
      const slug = normalizeSlug(payload.slug);
      await this.assertUniqueSlug(
        tenantId,
        organizationId,
        slug,
        department.id,
      );
      department.slug = slug;
    }
    if (payload.parentDepartmentId !== undefined) {
      const parentId = normalizeNullableId(payload.parentDepartmentId);
      await this.assertValidParent(
        tenantId,
        organizationId,
        department.id,
        parentId,
      );
      department.parentDepartmentId = parentId;
    }
    if (payload.code !== undefined) {
      department.code = normalizeNullableText(payload.code);
    }
    if (payload.description !== undefined) {
      department.description = normalizeNullableText(payload.description);
    }
    if (payload.status !== undefined) {
      department.status = normalizeStatus(payload.status);
    }
    return this.departments.save(department);
  }

  async remove(tenantId: string, organizationId: string, departmentId: string) {
    const department = await this.requireDepartment(
      tenantId,
      organizationId,
      departmentId,
    );
    const child = await this.departments.findOne({
      where: { parentDepartmentId: departmentId, tenantId },
    });
    if (child) throw new BadRequestException("请先移动或删除下级部门");
    await this.departments.softDelete({ id: department.id, tenantId });
    return { id: department.id };
  }

  async listMembers(
    tenantId: string,
    organizationId: string,
    departmentId: string,
  ) {
    await this.requireDepartment(tenantId, organizationId, departmentId);
    return this.userDepartments.find({
      order: { createdAt: "ASC" },
      relations: { membership: { user: true } },
      where: { departmentId, tenantId },
    });
  }

  async addMember(
    tenantId: string,
    organizationId: string,
    departmentId: string,
    payload: DepartmentMemberPayload,
  ) {
    await this.requireDepartment(tenantId, organizationId, departmentId);
    const membershipId = requireText(payload?.membershipId, "组织成员");
    const membership = await this.memberships.findOne({
      where: { id: membershipId, organizationId, status: "active", tenantId },
    });
    if (!membership) throw new BadRequestException("组织成员不存在或不可用");

    const existing = await this.userDepartments.findOne({
      where: { departmentId, membershipId, tenantId },
    });
    if (existing) return existing;

    return this.tenantContext.current()!.manager.transaction(async (manager) => {
      if (payload?.isDefault === true) {
        await manager.update(
          UserDepartment,
          { isDefault: true, membershipId, tenantId },
          { isDefault: false },
        );
      }
      return manager.save(
        UserDepartment,
        this.userDepartments.create({
          departmentId,
          isDefault: payload?.isDefault === true,
          joinedAt: new Date(),
          membershipId,
          status: "active",
          tenantId,
        }),
      );
    });
  }

  async removeMember(
    tenantId: string,
    organizationId: string,
    departmentId: string,
    memberId: string,
  ) {
    await this.requireDepartment(tenantId, organizationId, departmentId);
    const result = await this.userDepartments.delete({
      departmentId,
      id: memberId,
      tenantId,
    });
    if (!result.affected) throw new NotFoundException("部门成员不存在");
    return { id: memberId };
  }

  async listDispatchRelations(
    tenantId: string,
    organizationId: string,
    departmentId: string,
  ) {
    await this.requireDepartment(tenantId, organizationId, departmentId);
    return this.dispatchRelations.find({
      order: { priority: "ASC", createdAt: "ASC" },
      relations: { targetDepartment: true },
      where: { sourceDepartmentId: departmentId, tenantId },
    });
  }

  async createDispatchRelation(
    tenantId: string,
    organizationId: string,
    departmentId: string,
    payload: DepartmentDispatchPayload,
  ) {
    await this.requireDepartment(tenantId, organizationId, departmentId);
    const targetDepartmentId = requireText(
      payload?.targetDepartmentId,
      "目标部门",
    );
    if (targetDepartmentId === departmentId) {
      throw new BadRequestException("不能调度到同一部门");
    }
    const target = await this.departments.findOne({
      where: { id: targetDepartmentId, status: "active", tenantId },
    });
    if (!target) throw new BadRequestException("目标部门不存在或不可用");
    const type = normalizeDispatchType(payload?.type);
    const priority = normalizePriority(payload?.priority);
    const policy = normalizePolicy(payload?.policy);
    const existing = await this.dispatchRelations.findOne({
      where: {
        sourceDepartmentId: departmentId,
        targetDepartmentId,
        tenantId,
        type,
      },
    });
    if (existing) throw new BadRequestException("调度关系已经存在");

    return this.dispatchRelations.save(
      this.dispatchRelations.create({
        isEnabled: payload?.isEnabled !== false,
        policy,
        priority,
        sourceDepartmentId: departmentId,
        targetDepartmentId,
        tenantId,
        type,
      }),
    );
  }

  async removeDispatchRelation(
    tenantId: string,
    organizationId: string,
    departmentId: string,
    relationId: string,
  ) {
    await this.requireDepartment(tenantId, organizationId, departmentId);
    const result = await this.dispatchRelations.delete({
      id: relationId,
      sourceDepartmentId: departmentId,
      tenantId,
    });
    if (!result.affected) throw new NotFoundException("调度关系不存在");
    return { id: relationId };
  }

  private async requireOrganization(tenantId: string, organizationId: string) {
    const organization = await this.organizations.findOne({
      where: { id: organizationId, status: "active", tenantId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
    return organization;
  }

  private async requireDepartment(
    tenantId: string,
    organizationId: string,
    departmentId: string,
  ) {
    const department = await this.departments.findOne({
      where: { id: departmentId, organizationId, tenantId },
    });
    if (!department) throw new NotFoundException("部门不存在");
    return department;
  }

  private async assertUniqueSlug(
    tenantId: string,
    organizationId: string,
    slug: string,
    exceptId?: string,
  ) {
    const existing = await this.departments.findOne({
      where: { organizationId, slug, tenantId },
    });
    if (existing && existing.id !== exceptId) {
      throw new BadRequestException("部门标识已被使用");
    }
  }

  private async assertValidParent(
    tenantId: string,
    organizationId: string,
    departmentId: string,
    parentDepartmentId: string | null,
  ) {
    if (!parentDepartmentId) return;
    if (parentDepartmentId === departmentId) {
      throw new BadRequestException("部门不能作为自己的上级");
    }
    let cursor: string | null = parentDepartmentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === departmentId || visited.has(cursor)) {
        throw new BadRequestException("部门层级不能形成循环");
      }
      visited.add(cursor);
      const parent = await this.requireDepartment(
        tenantId,
        organizationId,
        cursor,
      );
      cursor = parent.parentDepartmentId;
    }
  }

  private get departments() {
    return this.tenantContext.repository(Department);
  }

  private get dispatchRelations() {
    return this.tenantContext.repository(DepartmentDispatchRelation);
  }

  private get memberships() {
    return this.tenantContext.repository(UserOrganization);
  }

  private get organizations() {
    return this.tenantContext.repository(Organization);
  }

  private get userDepartments() {
    return this.tenantContext.repository(UserDepartment);
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function normalizeNullableText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("文本格式不正确");
  return value.trim() || null;
}

function normalizeNullableId(value: unknown) {
  return normalizeNullableText(value);
}

function normalizeSlug(value: unknown) {
  const slug = requireText(value, "部门标识")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new BadRequestException("部门标识格式不正确");
  return slug;
}

function normalizeStatus(value: unknown): DepartmentStatus {
  if (value === undefined || value === null || value === "active") return "active";
  if (value === "disabled") return value;
  throw new BadRequestException("部门状态无效");
}

function normalizeDispatchType(value: unknown): DepartmentDispatchType {
  if (
    value === "handoff" ||
    value === "escalation" ||
    value === "collaboration" ||
    value === "fallback"
  ) {
    return value;
  }
  throw new BadRequestException("调度关系类型无效");
}

function normalizePriority(value: unknown) {
  if (value === undefined || value === null) return 100;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10000) {
    throw new BadRequestException("调度优先级必须是 0 到 10000 的整数");
  }
  return Number(value);
}

function normalizePolicy(value: unknown) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("调度策略格式不正确");
  }
  return value as Record<string, unknown>;
}
