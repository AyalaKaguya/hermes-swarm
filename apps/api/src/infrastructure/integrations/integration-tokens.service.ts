import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Organization,
  Permission,
  PlatformMember,
  RolePermission,
  User,
  UserOrganization,
  type IntegrationTokenScope,
} from "@hermes-swarm/core";
import { In, IsNull, Repository } from "typeorm";
import type { CreateIntegrationTokenPayload } from "../../common/admin-api.types.js";
import {
  INTEGRATION_SESSION_PREFIX,
  createAuthSessionToken,
} from "../auth/auth-session.js";
import { AuthSessionService } from "../auth/auth-session.service.js";

const MAX_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class IntegrationTokensService {
  constructor(
    @InjectRepository(IntegrationToken)
    private readonly tokenRepository: Repository<IntegrationToken>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    private readonly configService: ConfigService,
  ) {}

  async capabilities(authorization: string | undefined, userId: string) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    return {
      scopes: await this.getScopeCapabilities(userId),
    };
  }

  async list(authorization: string | undefined, userId: string) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    const tokens = await this.tokenRepository.find({
      order: { createdAt: "DESC" },
      where: { ownerUserId: userId },
    });
    return this.toIntegrationTokenDtos(tokens);
  }

  async listOrganization(
    authorization: string | undefined,
    organizationId: string,
  ) {
    await this.requireInteractiveSession(authorization);
    const tokens = await this.tokenRepository.find({
      order: { createdAt: "DESC" },
      where: { organizationId, scope: "organization" },
    });
    return this.toIntegrationTokenDtos(tokens);
  }

  async listPlatform(authorization: string | undefined) {
    await this.requireInteractiveSession(authorization);
    const tokens = await this.tokenRepository.find({
      order: { createdAt: "DESC" },
      where: { organizationId: IsNull(), scope: "platform" },
    });
    return this.toIntegrationTokenDtos(tokens);
  }

  async create(
    authorization: string | undefined,
    userId: string,
    payload: CreateIntegrationTokenPayload,
  ) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    const scope = requireScope(payload.scope);
    const expiresAt = normalizeExpiresAt(payload.expiresAt);
    const permissions = normalizePermissions(payload.permissions);
    const organizationId =
      scope === "organization" ? requireText(payload.organizationId, "组织") : null;
    const capability = await this.getScopeCapability(userId, scope, organizationId);

    if (!capability) {
      throw new ForbiddenException("当前账号没有该作用范围");
    }

    const allowed = new Set(capability.permissions.map((item) => item.permission));
    const invalid = permissions.filter((permission) => !allowed.has(permission));
    if (invalid.length > 0) {
      throw new ForbiddenException("Token 权限不能超出当前账号拥有的权限");
    }

    const id = randomUUID();
    const ttlSeconds = Math.max(
      1,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    const token = createAuthSessionToken(
      {
        jti: randomUUID(),
        sessionId: `${INTEGRATION_SESSION_PREFIX}${id}`,
        userId,
      },
      {
        secret: this.sessionSecret,
        ttlSeconds,
      },
    );

    const record = await this.tokenRepository.save(
      this.tokenRepository.create({
        id,
        expiresAt,
        note: normalizeNullableText(payload.note),
        organizationId,
        ownerUserId: userId,
        permissions,
        revokedAt: null,
        scope,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 24),
      }),
    );

    const organization = organizationId
      ? await this.organizationRepository.findOne({ where: { id: organizationId } })
      : null;

    return {
      ...toIntegrationTokenDto(record, null, organization),
      token,
    };
  }

  async revoke(
    authorization: string | undefined,
    userId: string,
    tokenId: string,
  ) {
    await this.requireInteractiveOwnerSession(authorization, userId);
    const token = await this.tokenRepository.findOne({
      where: { id: tokenId, ownerUserId: userId },
    });
    if (!token) throw new NotFoundException("Token 不存在");
    token.revokedAt = token.revokedAt ?? new Date();
    await this.tokenRepository.save(token);
  }

  async revokeOrganization(
    authorization: string | undefined,
    organizationId: string,
    tokenId: string,
  ) {
    await this.requireInteractiveSession(authorization);
    const token = await this.tokenRepository.findOne({
      where: { id: tokenId, organizationId, scope: "organization" },
    });
    if (!token) throw new NotFoundException("Token 不存在");
    token.revokedAt = token.revokedAt ?? new Date();
    await this.tokenRepository.save(token);
  }

  async revokePlatform(authorization: string | undefined, tokenId: string) {
    await this.requireInteractiveSession(authorization);
    const token = await this.tokenRepository.findOne({
      where: { id: tokenId, organizationId: IsNull(), scope: "platform" },
    });
    if (!token) throw new NotFoundException("Token 不存在");
    token.revokedAt = token.revokedAt ?? new Date();
    await this.tokenRepository.save(token);
  }

  private async requireInteractiveOwnerSession(
    authorization: string | undefined,
    userId: string,
  ) {
    const session = await this.requireInteractiveSession(authorization);
    if (session.userId !== userId) {
      throw new ForbiddenException("只能管理自己的集成 Token");
    }
    return session;
  }

  private async requireInteractiveSession(authorization: string | undefined) {
    const session = await this.authSessionService.validateAccessToken(
      extractBearerToken(authorization),
    );
    if (session.tokenKind === "integration") {
      throw new ForbiddenException("集成 Token 不能管理集成 Token");
    }
    return session;
  }

  private async getScopeCapabilities(userId: string) {
    const memberships = await this.membershipRepository.find({
      relations: { organization: true },
      where: { status: "active", userId },
    });
    const platformMembership = await this.platformMemberRepository.findOne({
      where: { status: "active", userId },
    });

    const scopes: IntegrationTokenScopeCapability[] = [];
    const ownPermissions = await this.getRolePermissionOptions(
      [
        ...memberships.map((membership) => membership.roleId),
        platformMembership?.roleId ?? null,
      ].filter((roleId): roleId is string => Boolean(roleId)),
      "own",
    );
    if (ownPermissions.length > 0) {
      scopes.push({
        organizationId: null,
        organizationName: null,
        permissions: ownPermissions,
        scope: "own",
      });
    }

    for (const membership of memberships) {
      if (!membership.roleId) continue;
      const permissions = await this.getRolePermissionOptions(
        [membership.roleId],
        "organization",
      );
      if (permissions.length === 0) continue;
      scopes.push({
        organizationId: membership.organizationId,
        organizationName: membership.organization?.name ?? membership.organizationId,
        permissions,
        scope: "organization",
      });
    }

    if (platformMembership?.roleId) {
      const permissions = await this.getRolePermissionOptions(
        [platformMembership.roleId],
        "platform",
      );
      if (permissions.length > 0) {
        scopes.push({
          organizationId: null,
          organizationName: null,
          permissions,
          scope: "platform",
        });
      }
    }

    return scopes;
  }

  private async getScopeCapability(
    userId: string,
    scope: IntegrationTokenScope,
    organizationId: string | null,
  ) {
    const scopes = await this.getScopeCapabilities(userId);
    return (
      scopes.find(
        (item) =>
          item.scope === scope &&
          (scope !== "organization" || item.organizationId === organizationId),
      ) ?? null
    );
  }

  private async getRolePermissionOptions(
    roleIds: string[],
    scope: IntegrationTokenScope,
  ) {
    if (roleIds.length === 0) return [];
    const rolePermissions = await this.rolePermissionRepository.find({
      where: roleIds.map((roleId) => ({ enabled: true, roleId })),
    });
    const codes = [
      ...new Set(
        rolePermissions
          .map((item) => item.permission)
          .filter((permission) => permission && isDelegablePermission(permission)),
      ),
    ];
    if (codes.length === 0) return [];

    const records = await this.permissionRepository.find({
      order: {
        entityOrder: "ASC",
        purposeOrder: "ASC",
        operationOrder: "ASC",
        code: "ASC",
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

  private get sessionSecret() {
    return this.configService.getOrThrow<string>("auth.sessionSecret");
  }

  private async toIntegrationTokenDtos(tokens: IntegrationToken[]) {
    const ownerIds = [...new Set(tokens.map((token) => token.ownerUserId))];
    const organizationIds = [
      ...new Set(
        tokens
          .map((token) => token.organizationId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const [users, organizations] = await Promise.all([
      ownerIds.length
        ? this.userRepository.find({ where: { id: In(ownerIds) } })
        : Promise.resolve([]),
      organizationIds.length
        ? this.organizationRepository.find({ where: { id: In(organizationIds) } })
        : Promise.resolve([]),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const organizationsById = new Map(
      organizations.map((organization) => [organization.id, organization]),
    );
    return tokens.map((token) =>
      toIntegrationTokenDto(
        token,
        usersById.get(token.ownerUserId) ?? null,
        token.organizationId ? organizationsById.get(token.organizationId) ?? null : null,
      ),
    );
  }
}

type IntegrationTokenScopeCapability = {
  organizationId: string | null;
  organizationName: string | null;
  permissions: Array<{
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
  }>;
  scope: IntegrationTokenScope;
};

function toIntegrationTokenDto(
  token: IntegrationToken,
  owner: User | null = null,
  organization: Organization | null = null,
) {
  return {
    createdAt: token.createdAt,
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
    tokenPrefix: token.tokenPrefix,
    updatedAt: token.updatedAt,
  };
}

function extractBearerToken(authorization: string | undefined) {
  return authorization?.replace(/^Bearer\s+/i, "").trim();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isDelegablePermission(permission: string) {
  return (
    !permission.startsWith("integration_token.") &&
    permission !== "page.settings.integrations.access:own" &&
    permission !== "page.settings.organization-integrations.access:organization" &&
    permission !== "page.settings.platform-integrations.access:platform"
  );
}

function normalizeExpiresAt(value: string | undefined) {
  const now = Date.now();
  const expiresAt = value
    ? new Date(value)
    : new Date(now + DEFAULT_TOKEN_TTL_MS);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    throw new BadRequestException("有效期无效");
  }
  if (expiresAt.getTime() - now > MAX_TOKEN_TTL_MS) {
    throw new BadRequestException("Token 最长有效期为 1 年");
  }
  return expiresAt;
}

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text.slice(0, 160) : null;
}

function normalizePermissions(value: string[] | undefined) {
  const permissions = [
    ...new Set(
      (value ?? []).map((item) => item.trim()).filter((item) => Boolean(item)),
    ),
  ];
  if (permissions.length === 0) {
    throw new BadRequestException("Token 至少需要选择一个权限");
  }
  return permissions;
}

function requireScope(value: string | undefined): IntegrationTokenScope {
  if (value === "own" || value === "organization" || value === "platform") {
    return value;
  }
  throw new BadRequestException("Token 作用范围无效");
}

function requireText(value: string | null | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}
