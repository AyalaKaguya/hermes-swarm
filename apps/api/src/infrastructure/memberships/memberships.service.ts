import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Organization,
  Role,
  User,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { In } from "typeorm";
import { hashPassword } from "../../common/security/password-hash.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import type { MembershipPayload } from "./memberships.controller.js";

@Injectable()
export class MembershipsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async list(organizationId: string) {
    const organization = await this.requireOrganization(organizationId);
    const { tenantId } = this.tenantContext.current()!;
    const memberships = await this.tenantContext.repository(UserOrganization).find({
      order: { createdAt: "ASC" },
      relations: { user: true },
      where: { organizationId: organization.id, tenantId },
    });
    const assignments = memberships.length
      ? await this.tenantContext.repository(UserOrganizationRole).find({
          relations: { role: true },
          where: { membershipId: In(memberships.map((item) => item.id)), tenantId },
        })
      : [];
    return memberships.map((membership) =>
      toMembershipDto(
        membership,
        assignments.find((assignment) => assignment.membershipId === membership.id)?.role ?? null,
      ),
    );
  }

  async create(organizationId: string, payload: MembershipPayload) {
    const organization = await this.requireOrganization(organizationId);
    if (organization.status !== "active") throw new BadRequestException("组织不可用");
    const { tenantId } = this.tenantContext.current()!;
    const user = await this.resolveUser(payload, tenantId);
    let membership = await this.tenantContext.repository(UserOrganization).findOne({
      where: { organizationId, tenantId, userId: user.id },
    });
    if (membership?.status === "active") throw new ConflictException("用户已经是组织成员");
    membership ??= this.tenantContext.repository(UserOrganization).create({
      organizationId,
      tenantId,
      userId: user.id,
    });
    Object.assign(membership, {
      displayName: payload.displayName ?? user.displayName,
      isDefault: Boolean(payload.isDefault),
      joinedAt: membership.joinedAt ?? new Date(),
      status: payload.status ?? "active",
    });
    membership = await this.tenantContext.repository(UserOrganization).save(membership);
    await this.replaceRole(organizationId, membership.id, requireText(payload.roleId, "角色"));
    return this.getMembership(organizationId, membership.id);
  }

  async update(
    organizationId: string,
    membershipId: string,
    payload: Partial<MembershipPayload>,
  ) {
    const membership = await this.requireMembership(organizationId, membershipId);
    if (payload.displayName !== undefined) membership.displayName = nullableText(payload.displayName);
    if (payload.status !== undefined) {
      if (!["active", "disabled", "invited"].includes(payload.status)) {
        throw new BadRequestException("成员状态无效");
      }
      membership.status = payload.status;
    }
    if (payload.isDefault !== undefined) membership.isDefault = Boolean(payload.isDefault);
    await this.tenantContext.repository(UserOrganization).save(membership);
    if (payload.roleId !== undefined) {
      await this.replaceRole(organizationId, membership.id, payload.roleId);
    }
    return this.getMembership(organizationId, membership.id);
  }

  async replaceRole(organizationId: string, membershipId: string, roleId: string) {
    const membership = await this.requireMembership(organizationId, membershipId);
    const { tenantId, manager } = this.tenantContext.current()!;
    roleId = requireText(roleId, "角色");
    const role = await this.tenantContext.repository(Role).findOne({
      where: { id: roleId, organizationId, scope: "organization", tenantId },
    });
    if (!role) throw new BadRequestException("组织角色无效");
    await this.assertOwnerContinuity(membership, role.name);
    await manager.delete(UserOrganizationRole, { membershipId: membership.id, tenantId });
    await manager.save(UserOrganizationRole, {
      membershipId: membership.id,
      organizationId,
      roleId: role.id,
      tenantId,
    });
    return this.getMembership(organizationId, membership.id);
  }

  async remove(organizationId: string, membershipId: string) {
    const membership = await this.requireMembership(organizationId, membershipId);
    await this.assertOwnerContinuity(membership, null);
    const organization = await this.requireOrganization(organizationId);
    if (!organization.parentOrganizationId) {
      const ownerCount = await this.tenantContext.repository(UserOrganization).count({
        where: { organizationId, status: "active", tenantId: membership.tenantId },
      });
      if (ownerCount <= 1) throw new BadRequestException("根组织必须至少保留一个有效成员");
    }
    await this.tenantContext.repository(UserOrganization).remove(membership);
    return { deleted: true, id: membership.id };
  }

  private async getMembership(organizationId: string, membershipId: string) {
    const membership = await this.requireMembership(organizationId, membershipId, true);
    const assignment = await this.tenantContext.repository(UserOrganizationRole).findOne({
      relations: { role: true },
      where: { membershipId, tenantId: membership.tenantId },
    });
    return toMembershipDto(membership, assignment?.role ?? null);
  }

  private async assertOwnerContinuity(
    membership: UserOrganization,
    nextRoleName: string | null,
  ) {
    const assignment = await this.tenantContext.repository(UserOrganizationRole).findOne({
      relations: { role: true },
      where: { membershipId: membership.id, tenantId: membership.tenantId },
    });
    if (assignment?.role?.name !== "owner" || nextRoleName === "owner") return;
    const ownerRole = await this.tenantContext.repository(Role).findOne({
      where: {
        name: "owner",
        organizationId: membership.organizationId,
        scope: "organization",
        tenantId: membership.tenantId,
      },
    });
    if (!ownerRole) throw new BadRequestException("组织 Owner 角色不存在");
    const owners = await this.tenantContext.repository(UserOrganizationRole).count({
      where: {
        organizationId: membership.organizationId,
        roleId: ownerRole.id,
        tenantId: membership.tenantId,
      },
    });
    if (owners <= 1) throw new BadRequestException("组织必须至少保留一个 Owner");
  }

  private async resolveUser(payload: MembershipPayload, tenantId: string) {
    if (payload.userId) {
      const user = await this.tenantContext.repository(User).findOne({
        where: { id: payload.userId, tenantId },
      });
      if (!user) throw new NotFoundException("用户不存在");
      return user;
    }
    const email = normalizeEmail(payload.email);
    let user = await this.tenantContext.repository(User).findOne({ where: { email, tenantId } });
    if (user) return user;
    const password = requireText(payload.password, "密码");
    user = this.tenantContext.repository(User).create({
      displayName: nullableText(payload.displayName) ?? email,
      email,
      emailVerified: false,
      passwordHash: hashPassword(password),
      preferredLanguage: null,
      status: "active",
      tenantId,
      type: "user",
    });
    return this.tenantContext.repository(User).save(user);
  }

  private async requireMembership(
    organizationId: string,
    membershipId: string,
    withUser = false,
  ) {
    const { tenantId } = this.tenantContext.current()!;
    const membership = await this.tenantContext.repository(UserOrganization).findOne({
      relations: withUser ? { user: true } : undefined,
      where: { id: membershipId, organizationId, tenantId },
    });
    if (!membership) throw new NotFoundException("组织成员不存在");
    return membership;
  }

  private async requireOrganization(organizationId: string) {
    const { tenantId } = this.tenantContext.current()!;
    const organization = await this.tenantContext.repository(Organization).findOne({
      where: { id: organizationId, tenantId },
    });
    if (!organization) throw new NotFoundException("组织不存在");
    return organization;
  }
}

function toMembershipDto(membership: UserOrganization, role: Role | null) {
  return {
    displayName: membership.displayName,
    id: membership.id,
    isDefault: membership.isDefault,
    joinedAt: membership.joinedAt,
    organizationId: membership.organizationId,
    role,
    status: membership.status,
    user: membership.user,
    userId: membership.userId,
  };
}

function normalizeEmail(value: unknown) {
  return requireText(value, "邮箱").toLowerCase();
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function nullableText(value: unknown) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}
