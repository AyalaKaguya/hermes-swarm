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
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import type {
  CreateMembershipPayload,
  UpdateMembershipPayload,
} from "./memberships.controller.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";

const CREATE_MEMBERSHIP_KEYS = new Set(["roleId", "userId"]);
const UPDATE_MEMBERSHIP_KEYS = new Set([
  "displayName",
  "isDefault",
  "roleId",
  "status",
]);

@Injectable()
export class MembershipsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
  ) {}

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

  async listCandidates(organizationId: string) {
    const organization = await this.requireOrganization(organizationId);
    if (organization.status !== "active") {
      throw new BadRequestException("组织不可用");
    }
    const { tenantId } = this.tenantContext.current()!;
    const activeMemberships = await this.tenantContext
      .repository(UserOrganization)
      .find({
        select: { userId: true },
        where: { organizationId, status: "active", tenantId },
      });
    const activeMemberIds = new Set(
      activeMemberships.map((membership) => membership.userId),
    );
    const users = await this.tenantContext.repository(User).find({
      order: { displayName: "ASC", email: "ASC" },
      where: { status: "active", tenantId, type: "user" },
    });
    return users
      .filter((user) => !activeMemberIds.has(user.id))
      .map(toCandidateDto);
  }

  async create(
    organizationId: string,
    payload: CreateMembershipPayload,
    actorUserId?: string,
  ) {
    const input = requirePayload(payload);
    assertAllowedKeys(input, CREATE_MEMBERSHIP_KEYS);
    const organization = await this.requireOrganization(organizationId);
    if (organization.status !== "active") throw new BadRequestException("组织不可用");
    const { tenantId } = this.tenantContext.current()!;
    const user = await this.requireWorkspaceUser(input.userId, tenantId);
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
      displayName: user.displayName,
      isDefault: false,
      joinedAt: new Date(),
      status: "active",
    });
    membership = await this.tenantContext.repository(UserOrganization).save(membership);
    await this.replaceRole(
      organizationId,
      membership.id,
      requireText(input.roleId, "角色"),
      actorUserId,
    );
    return this.getMembership(organizationId, membership.id);
  }

  async update(
    organizationId: string,
    membershipId: string,
    payload: UpdateMembershipPayload,
    actorUserId?: string,
  ) {
    const input = requirePayload(payload);
    assertAllowedKeys(input, UPDATE_MEMBERSHIP_KEYS);
    const membership = await this.requireMembership(organizationId, membershipId);
    if (input.displayName !== undefined) {
      membership.displayName = nullableText(input.displayName);
    }
    if (input.status !== undefined) {
      if (!["active", "disabled", "invited"].includes(input.status)) {
        throw new BadRequestException("成员状态无效");
      }
      if (membership.status === "active" && input.status !== "active") {
        await this.assertOwnerContinuity(membership, null);
      }
      membership.status = input.status;
    }
    if (input.isDefault !== undefined) {
      membership.isDefault = Boolean(input.isDefault);
    }
    await this.tenantContext.repository(UserOrganization).save(membership);
    if (input.roleId !== undefined) {
      await this.replaceRole(
        organizationId,
        membership.id,
        input.roleId,
        actorUserId,
      );
    }
    return this.getMembership(organizationId, membership.id);
  }

  async replaceRole(
    organizationId: string,
    membershipId: string,
    roleId: string,
    actorUserId?: string,
  ) {
    const membership = await this.requireMembership(organizationId, membershipId);
    const { tenantId, manager } = this.tenantContext.current()!;
    roleId = requireText(roleId, "角色");
    const role = await this.tenantContext.repository(Role).findOne({
      relations: { rolePermissions: true },
      where: { id: roleId, organizationId, scope: "organization", tenantId },
    });
    if (!role) throw new BadRequestException("组织角色无效");
    if (actorUserId) {
      await this.assertCanGrantOrganizationRole(
        actorUserId,
        membership.userId,
        organizationId,
        role,
      );
    }
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
    const owners = (await this.tenantContext.current()!.manager.query(
      `SELECT uo.id
         FROM user_organizations uo
         JOIN users u
           ON u.tenant_id = uo.tenant_id AND u.id = uo.user_id
         JOIN user_organization_roles uor
           ON uor.tenant_id = uo.tenant_id
          AND uor.organization_id = uo.organization_id
          AND uor.membership_id = uo.id
        WHERE uo.tenant_id = $1
          AND uo.organization_id = $2
          AND uo.status = 'active'
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          AND uor.role_id = $3
        FOR UPDATE OF uo, u`,
      [membership.tenantId, membership.organizationId, ownerRole.id],
    )) as Array<{ id: string }>;
    if (
      owners.some((owner) => owner.id === membership.id) &&
      owners.filter((owner) => owner.id !== membership.id).length === 0
    ) {
      throw new BadRequestException({
        code: "OWNER_CONTINUITY_REQUIRED",
        message: "组织必须至少保留一个有效 Owner",
        statusCode: 400,
      });
    }
  }

  private async requireWorkspaceUser(userId: unknown, tenantId: string) {
    const id = requireText(userId, "工作空间用户");
    const user = await this.tenantContext.repository(User).findOne({
      where: { id, status: "active", tenantId, type: "user" },
    });
    if (!user) {
      throw new NotFoundException("工作空间用户不存在或不可用");
    }
    return user;
  }

  private async assertCanGrantOrganizationRole(
    actorUserId: string,
    targetUserId: string,
    organizationId: string,
    targetRole: Role,
  ) {
    const membership = await this.tenantContext.repository(UserOrganization).findOne({
      where: {
        organizationId,
        status: "active",
        tenantId: this.tenantContext.current()!.tenantId,
        userId: actorUserId,
      },
    });
    const assignment = membership
      ? await this.tenantContext.repository(UserOrganizationRole).findOne({
          relations: { role: { rolePermissions: true } },
          where: {
            membershipId: membership.id,
            tenantId: membership.tenantId,
          },
        })
      : null;
    const actorRole = assignment?.role;
    this.grantPolicy.assertCanGrant({
      actor: {
        principalType: "tenant",
        tenantId: this.tenantContext.current()!.tenantId,
        userId: actorUserId,
      },
      actorPermissionCodes: (actorRole?.rolePermissions ?? [])
        .filter((permission) => permission.enabled)
        .map((permission) => permission.permission),
      actorRoleNames: actorRole ? [actorRole.name] : [],
      scope: "organization",
      targetRole: {
        id: targetRole.id,
        name: targetRole.name,
        permissionCodes: (targetRole.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      },
      targetUserId,
    });
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

function toCandidateDto(user: User) {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    imageUrl: user.imageUrl,
  };
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

function requirePayload<T extends object>(value: T | null | undefined): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求参数无效");
  }
  return value;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
) {
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unsupported.length > 0) {
    throw new BadRequestException(`不支持的字段: ${unsupported.join(", ")}`);
  }
}
