import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Department,
  IntegrationToken,
  Organization,
  Permission,
  RolePermission,
  User,
  UserDepartment,
  UserDepartmentRole,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
  type IntegrationTokenScope,
} from "@hermes-swarm/core";
import { In, type Repository } from "typeorm";
import type { CreateIntegrationTokenPayload } from "../../common/admin-api.types.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import {
  INTEGRATION_SESSION_PREFIX,
  createAuthSessionToken,
} from "../auth/auth-session.js";
import { AuthSessionService } from "../auth/auth-session.service.js";

const MAX_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CREATE_PERMISSIONS: Record<IntegrationTokenScope, string> = {
  department: "integration_token.department_integration.create:department",
  organization: "integration_token.organization_integration.create:organization",
  tenant: "integration_token.tenant_integration.create:tenant",
};

@Injectable()
export class IntegrationTokensService {
  constructor(
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async capabilities(authorization: string | undefined, userId: string) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    return { scopes: await this.getScopeCapabilities(userId) };
  }

  async list(authorization: string | undefined, userId: string) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    return this.toIntegrationTokenDtos(
      await this.tokenRepository.find({
        order: { createdAt: "DESC" },
        where: { ownerUserId: userId, tenantId: this.tenantId },
      }),
    );
  }

  async listOrganization(
    authorization: string | undefined,
    organizationId: string,
  ) {
    await this.requireTenantSession(authorization);
    return this.toIntegrationTokenDtos(
      await this.tokenRepository.find({
        order: { createdAt: "DESC" },
        where: {
          organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        },
      }),
    );
  }

  async listDepartment(
    authorization: string | undefined,
    organizationId: string,
    departmentId: string,
  ) {
    await this.requireTenantSession(authorization);
    return this.toIntegrationTokenDtos(
      await this.tokenRepository.find({
        order: { createdAt: "DESC" },
        where: {
          departmentId,
          organizationId,
          scope: "department",
          tenantId: this.tenantId,
        },
      }),
    );
  }

  async create(
    authorization: string | undefined,
    userId: string,
    payload: CreateIntegrationTokenPayload,
  ) {
    const session = await this.requireInteractiveOwnerSession(
      authorization,
      userId,
    );
    const input = requireCreatePayload(payload);
    const scope = requireScope(input.scope);
    const target = normalizeScopeTarget(
      scope,
      input.organizationId,
      input.departmentId,
    );
    const capability = await this.getScopeCapability(userId, scope, target);
    if (!capability) {
      throw new ForbiddenException("当前账号没有该作用范围");
    }

    const permissions = normalizePermissions(input.permissions);
    const allowed = new Set(capability.permissions.map((item) => item.permission));
    const invalid = permissions.filter((permission) => !allowed.has(permission));
    if (invalid.length > 0) {
      throw new ForbiddenException("Token 权限不能超出当前账号拥有的权限");
    }

    const organization = target.organizationId
      ? await this.requireActiveOrganization(target.organizationId)
      : null;
    const department = target.departmentId
      ? await this.requireActiveDepartment(
          target.organizationId!,
          target.departmentId,
        )
      : null;
    const expiresAt = normalizeExpiresAt(input.expiresAt);
    const id = randomUUID();
    const token = createAuthSessionToken(
      {
        jti: randomUUID(),
        principalType: "integration",
        sessionId: `${INTEGRATION_SESSION_PREFIX}${id}`,
        tenantId: session.tenantId,
        userId,
      },
      {
        secret: this.sessionSecret,
        ttlSeconds: Math.max(
          1,
          Math.floor((expiresAt.getTime() - Date.now()) / 1000),
        ),
      },
    );
    const record = await this.tokenRepository.save(
      this.tokenRepository.create({
        departmentId: target.departmentId,
        expiresAt,
        id,
        note: normalizeNullableText(input.note),
        organizationId: target.organizationId,
        ownerUserId: userId,
        permissions,
        revokedAt: null,
        scope,
        tenantId: this.tenantId,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 24),
      }),
    );

    return {
      ...toIntegrationTokenDto(record, null, organization, department),
      token,
    };
  }

  async createForCurrentUserInOrganization(
    authorization: string | undefined,
    organizationId: string,
    payload: Omit<
      CreateIntegrationTokenPayload,
      "departmentId" | "organizationId" | "scope"
    >,
  ) {
    const session = await this.requireTenantSession(authorization);
    return this.create(authorization, session.userId, {
      ...payload,
      organizationId,
      scope: "organization",
    });
  }

  async createForCurrentUserInDepartment(
    authorization: string | undefined,
    organizationId: string,
    departmentId: string,
    payload: Omit<
      CreateIntegrationTokenPayload,
      "departmentId" | "organizationId" | "scope"
    >,
  ) {
    const session = await this.requireTenantSession(authorization);
    return this.create(authorization, session.userId, {
      ...payload,
      departmentId,
      organizationId,
      scope: "department",
    });
  }

  async revoke(
    authorization: string | undefined,
    userId: string,
    tokenId: string,
  ) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    await this.revokeMatching({
      id: tokenId,
      ownerUserId: userId,
      tenantId: this.tenantId,
    });
  }

  async revokeOrganization(
    authorization: string | undefined,
    organizationId: string,
    tokenId: string,
  ) {
    await this.requireTenantSession(authorization);
    await this.revokeMatching({
      id: tokenId,
      organizationId,
      scope: "organization",
      tenantId: this.tenantId,
    });
  }

  async revokeDepartment(
    authorization: string | undefined,
    organizationId: string,
    departmentId: string,
    tokenId: string,
  ) {
    await this.requireTenantSession(authorization);
    await this.revokeMatching({
      departmentId,
      id: tokenId,
      organizationId,
      scope: "department",
      tenantId: this.tenantId,
    });
  }

  private async revokeMatching(where: Record<string, unknown>) {
    const token = await this.tokenRepository.findOne({ where: where as never });
    if (!token) throw new NotFoundException("Token 不存在");
    token.revokedAt = token.revokedAt ?? new Date();
    await this.tokenRepository.save(token);
  }

  private async requireInteractiveOwnerSession(
    authorization: string | undefined,
    userId: string,
  ) {
    const session = await this.requireTenantSession(authorization);
    if (session.userId !== userId) {
      throw new ForbiddenException("只能管理自己的集成 Token");
    }
    return session;
  }

  private async requireTenantSession(authorization: string | undefined) {
    const session = await this.authSessionService.validateAccessToken(
      extractBearerToken(authorization),
    );
    if (session.tokenKind === "integration") {
      throw new ForbiddenException("集成 Token 不能管理集成 Token");
    }
    if (session.principalType !== "tenant" || !session.tenantId) {
      throw new ForbiddenException("平台账号不能管理租户集成 Token");
    }
    if (session.tenantId !== this.tenantId) {
      throw new ForbiddenException("登录租户与请求租户不一致");
    }
    return session;
  }

  private async getScopeCapabilities(userId: string) {
    const tenantId = this.tenantId;
    const tenantRoleIds = (
      await this.tenantRoleRepository.find({ where: { tenantId, userId } })
    ).map((item) => item.roleId);
    const scopes: IntegrationTokenScopeCapability[] = [];

    await this.addCapability(scopes, "tenant", tenantRoleIds, {
      departmentId: null,
      departmentName: null,
      organizationId: null,
      organizationName: null,
    });

    const memberships = await this.membershipRepository.find({
      relations: { organization: true },
      where: { status: "active", tenantId, userId },
    });
    if (memberships.length === 0) return scopes;
    const organizationRoleAssignments = await this.organizationRoleRepository.find({
      where: {
        membershipId: In(memberships.map((item) => item.id)),
        tenantId,
      },
    });
    const organizationRoles = groupRoleIds(
      organizationRoleAssignments,
      "membershipId",
    );

    for (const membership of memberships) {
      if (membership.organization?.status !== "active") continue;
      const roleIds = [
        ...tenantRoleIds,
        ...(organizationRoles.get(membership.id) ?? []),
      ];
      await this.addCapability(scopes, "organization", roleIds, {
        departmentId: null,
        departmentName: null,
        organizationId: membership.organizationId,
        organizationName:
          membership.organization?.name ?? membership.organizationId,
      });

      const departmentMemberships = await this.departmentMembershipRepository.find({
        relations: { department: true },
        where: { membershipId: membership.id, status: "active", tenantId },
      });
      if (departmentMemberships.length === 0) continue;
      const departmentRoleAssignments = await this.departmentRoleRepository.find({
        where: {
          tenantId,
          userDepartmentId: In(departmentMemberships.map((item) => item.id)),
        },
      });
      const departmentRoles = groupRoleIds(
        departmentRoleAssignments,
        "userDepartmentId",
      );
      for (const departmentMembership of departmentMemberships) {
        if (departmentMembership.department?.status !== "active") continue;
        await this.addCapability(
          scopes,
          "department",
          [
            ...roleIds,
            ...(departmentRoles.get(departmentMembership.id) ?? []),
          ],
          {
            departmentId: departmentMembership.departmentId,
            departmentName:
              departmentMembership.department?.name ??
              departmentMembership.departmentId,
            organizationId: membership.organizationId,
            organizationName:
              membership.organization?.name ?? membership.organizationId,
          },
        );
      }
    }
    return scopes;
  }

  private async addCapability(
    scopes: IntegrationTokenScopeCapability[],
    scope: IntegrationTokenScope,
    roleIds: string[],
    target: ScopeTargetLabel,
  ) {
    const uniqueRoleIds = [...new Set(roleIds)];
    if (
      uniqueRoleIds.length === 0 ||
      !(await this.rolesAllow(uniqueRoleIds, CREATE_PERMISSIONS[scope]))
    ) {
      return;
    }
    const permissions = await this.getRolePermissionOptions(uniqueRoleIds, scope);
    if (permissions.length > 0) scopes.push({ ...target, permissions, scope });
  }

  private async getScopeCapability(
    userId: string,
    scope: IntegrationTokenScope,
    target: ScopeTarget,
  ) {
    return (
      (await this.getScopeCapabilities(userId)).find(
        (item) =>
          item.scope === scope &&
          item.organizationId === target.organizationId &&
          item.departmentId === target.departmentId,
      ) ?? null
    );
  }

  private async rolesAllow(roleIds: string[], permission: string) {
    return Boolean(
      await this.rolePermissionRepository.findOne({
        where: {
          enabled: true,
          permission,
          roleId: In(roleIds),
          tenantId: this.tenantId,
        },
      }),
    );
  }

  private async getRolePermissionOptions(
    roleIds: string[],
    scope: IntegrationTokenScope,
  ) {
    const assignments = await this.rolePermissionRepository.find({
      where: {
        enabled: true,
        roleId: In(roleIds),
        tenantId: this.tenantId,
      },
    });
    const codes = [
      ...new Set(
        assignments
          .map((item) => item.permission)
          .filter((permission) => permission && isDelegablePermission(permission)),
      ),
    ];
    if (codes.length === 0) return [];
    const records = await this.permissionRepository.find({
      order: {
        code: "ASC",
        entityOrder: "ASC",
        operationOrder: "ASC",
        purposeOrder: "ASC",
      },
      where: { code: In(codes), scope },
    });
    return records
      .filter((permission) => permission.code)
      .map((permission) => ({
        description: permission.description,
        entity: permission.entity,
        entityLabel: permission.entityLabel ?? permission.entity,
        entityOrder: permission.entityOrder,
        isDangerous: permission.isDangerous,
        label: permission.operationLabel ?? permission.code ?? "",
        operation: permission.operation ?? permission.code ?? "",
        operationOrder: permission.operationOrder,
        permission: permission.code ?? "",
        purpose: permission.purpose ?? "default",
        purposeLabel: permission.purposeLabel ?? permission.purpose ?? "权限",
        purposeOrder: permission.purposeOrder,
      }));
  }

  private async requireActiveOrganization(organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId, tenantId: this.tenantId },
    });
    if (!organization || organization.status !== "active") {
      throw new ForbiddenException("组织不可用");
    }
    return organization;
  }

  private async requireActiveDepartment(
    organizationId: string,
    departmentId: string,
  ) {
    const department = await this.departmentRepository.findOne({
      where: {
        id: departmentId,
        organizationId,
        status: "active",
        tenantId: this.tenantId,
      },
    });
    if (!department) throw new ForbiddenException("部门不可用");
    return department;
  }

  private async toIntegrationTokenDtos(tokens: IntegrationToken[]) {
    const ownerIds = [...new Set(tokens.map((token) => token.ownerUserId))];
    const organizationIds = compactUnique(
      tokens.map((token) => token.organizationId),
    );
    const departmentIds = compactUnique(tokens.map((token) => token.departmentId));
    const [users, organizations, departments] = await Promise.all([
      ownerIds.length
        ? this.userRepository.find({ where: { id: In(ownerIds), tenantId: this.tenantId } })
        : Promise.resolve([]),
      organizationIds.length
        ? this.organizationRepository.find({
            where: { id: In(organizationIds), tenantId: this.tenantId },
          })
        : Promise.resolve([]),
      departmentIds.length
        ? this.departmentRepository.find({
            where: { id: In(departmentIds), tenantId: this.tenantId },
          })
        : Promise.resolve([]),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const organizationsById = new Map(
      organizations.map((organization) => [organization.id, organization]),
    );
    const departmentsById = new Map(
      departments.map((department) => [department.id, department]),
    );
    return tokens.map((token) =>
      toIntegrationTokenDto(
        token,
        usersById.get(token.ownerUserId) ?? null,
        token.organizationId
          ? organizationsById.get(token.organizationId) ?? null
          : null,
        token.departmentId
          ? departmentsById.get(token.departmentId) ?? null
          : null,
      ),
    );
  }

  private get tenantId() {
    return this.tenantContext.current()!.tenantId;
  }

  private get tokenRepository() {
    return this.tenantContext.repository(IntegrationToken);
  }

  private get userRepository() {
    return this.tenantContext.repository(User);
  }

  private get organizationRepository() {
    return this.tenantContext.repository(Organization);
  }

  private get departmentRepository() {
    return this.tenantContext.repository(Department);
  }

  private get permissionRepository() {
    return this.tenantContext.repository(Permission);
  }

  private get rolePermissionRepository() {
    return this.tenantContext.repository(RolePermission);
  }

  private get tenantRoleRepository() {
    return this.tenantContext.repository(UserTenantRole);
  }

  private get membershipRepository() {
    return this.tenantContext.repository(UserOrganization);
  }

  private get organizationRoleRepository() {
    return this.tenantContext.repository(UserOrganizationRole);
  }

  private get departmentMembershipRepository() {
    return this.tenantContext.repository(UserDepartment);
  }

  private get departmentRoleRepository() {
    return this.tenantContext.repository(UserDepartmentRole);
  }

  private get sessionSecret() {
    return this.configService.getOrThrow<string>("auth.sessionSecret");
  }
}

type PermissionOption = {
  description: string | null;
  entity: string;
  entityLabel: string;
  entityOrder: number | null;
  isDangerous: boolean;
  label: string;
  operation: string;
  operationOrder: number | null;
  permission: string;
  purpose: string;
  purposeLabel: string;
  purposeOrder: number | null;
};

type ScopeTarget = {
  departmentId: string | null;
  organizationId: string | null;
};

type ScopeTargetLabel = ScopeTarget & {
  departmentName: string | null;
  organizationName: string | null;
};

type IntegrationTokenScopeCapability = ScopeTargetLabel & {
  permissions: PermissionOption[];
  scope: IntegrationTokenScope;
};

function toIntegrationTokenDto(
  token: IntegrationToken,
  owner: User | null = null,
  organization: Organization | null = null,
  department: Department | null = null,
) {
  return {
    createdAt: token.createdAt,
    departmentId: token.departmentId,
    departmentName: department?.name ?? null,
    expiresAt: token.expiresAt,
    id: token.id,
    isExpired: token.expiresAt.getTime() <= Date.now(),
    lastUsedAt: token.lastUsedAt,
    note: token.note,
    organizationId: token.organizationId,
    organizationName: organization?.name ?? null,
    owner: owner
      ? {
          avatarUrl: owner.avatarUrl,
          displayName: owner.displayName,
          email: owner.email,
          id: owner.id,
          imageUrl: owner.imageUrl,
          username: owner.username,
        }
      : null,
    ownerUserId: token.ownerUserId,
    permissions: token.permissions ?? [],
    revokedAt: token.revokedAt,
    scope: token.scope,
    tenantId: token.tenantId,
    tokenPrefix: token.tokenPrefix,
    updatedAt: token.updatedAt,
  };
}

function groupRoleIds<
  T extends { roleId: string },
  K extends keyof T,
>(records: T[], key: K) {
  const grouped = new Map<string, string[]>();
  for (const record of records) {
    const id = record[key];
    if (typeof id !== "string") continue;
    grouped.set(id, [...(grouped.get(id) ?? []), record.roleId]);
  }
  return grouped;
}

function compactUnique(values: Array<string | null>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function extractBearerToken(authorization: string | undefined) {
  return authorization?.replace(/^Bearer\s+/i, "").trim();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isDelegablePermission(permission: string) {
  return !permission.startsWith("integration_token.");
}

function requireCreatePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Token 请求内容无效");
  }
  return value as Record<string, unknown>;
}

function normalizeExpiresAt(value: unknown) {
  const now = Date.now();
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new BadRequestException("有效期无效");
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  const expiresAt = normalized
    ? new Date(normalized)
    : new Date(now + DEFAULT_TOKEN_TTL_MS);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    throw new BadRequestException("有效期无效");
  }
  if (expiresAt.getTime() - now > MAX_TOKEN_TTL_MS) {
    throw new BadRequestException("Token 最长有效期为 1 年");
  }
  return expiresAt;
}

function normalizeNullableText(value: unknown) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new BadRequestException("备注无效");
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 160) {
    throw new BadRequestException("备注最多 160 个字符");
  }
  return text || null;
}

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BadRequestException("Token 至少需要选择一个权限");
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new BadRequestException("Token 权限无效");
    }
  }
  const permissions = [
    ...new Set(value.map((item) => item.trim()).filter(Boolean)),
  ];
  if (permissions.length === 0) {
    throw new BadRequestException("Token 至少需要选择一个权限");
  }
  return permissions;
}

function requireScope(value: unknown): IntegrationTokenScope {
  if (
    value === "tenant" ||
    value === "organization" ||
    value === "department"
  ) {
    return value;
  }
  throw new BadRequestException("Token 作用范围无效");
}

function normalizeScopeTarget(
  scope: IntegrationTokenScope,
  organizationIdValue: unknown,
  departmentIdValue: unknown,
): ScopeTarget {
  const organizationId = normalizeOptionalTargetId(
    organizationIdValue,
    "组织",
  );
  const departmentId = normalizeOptionalTargetId(departmentIdValue, "部门");
  if (scope === "tenant") {
    if (organizationId || departmentId) {
      throw new BadRequestException("租户作用范围不能指定组织或部门");
    }
    return { departmentId: null, organizationId: null };
  }
  if (!organizationId) throw new BadRequestException("组织不能为空");
  if (scope === "organization") {
    if (departmentId) {
      throw new BadRequestException("组织作用范围不能指定部门");
    }
    return { departmentId: null, organizationId };
  }
  if (!departmentId) throw new BadRequestException("部门不能为空");
  return { departmentId, organizationId };
}

function normalizeOptionalTargetId(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}无效`);
  }
  return value.trim();
}
