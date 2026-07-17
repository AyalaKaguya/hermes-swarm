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
  IntegrationToken,
  Permission,
  RolePermission,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { In } from "typeorm";
import type { CreateIntegrationTokenPayload } from "../../common/admin-api.types.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { INTEGRATION_SESSION_PREFIX, createAuthSessionToken } from "../auth/auth-session.js";
import { AuthSessionService } from "../auth/auth-session.service.js";

const MAX_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class IntegrationTokensService {
  constructor(
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async capabilities(authorization: string | undefined) {
    const session = await this.requirePersonalSession(authorization);
    const { definitionsByCode, permissions } =
      await this.delegatablePermissions(session.userId);
    return {
      scopes: [
        {
          permissions: permissions.map((permission) =>
            toPermissionCapability(permission, definitionsByCode.get(permission)),
          ),
          scope: "tenant" as const,
        },
      ],
    };
  }

  async list(authorization: string | undefined) {
    const session = await this.requirePersonalSession(authorization);
    return (
      await this.tokenRepository.find({
        order: { createdAt: "DESC" },
        where: { ownerUserId: session.userId, tenantId: this.tenantId },
      })
    ).map(toIntegrationTokenDto);
  }

  async create(
    authorization: string | undefined,
    payload: CreateIntegrationTokenPayload,
  ) {
    const session = await this.requirePersonalSession(authorization);
    if ((payload as CreateIntegrationTokenPayload & { scope?: unknown })?.scope !== undefined) {
      throw new BadRequestException("个人 API Token 不接受作用范围参数");
    }
    const permissions = normalizePermissions(payload?.permissions);
    const allowed = new Set(
      (await this.delegatablePermissions(session.userId)).permissions,
    );
    if (permissions.some((permission) => !allowed.has(permission))) {
      throw new ForbiddenException("Token 权限不能超出当前账号拥有的权限");
    }
    const expiresAt = normalizeExpiresAt(payload?.expiresAt);
    const id = randomUUID();
    const token = createAuthSessionToken(
      {
        jti: randomUUID(),
        principalType: "integration",
        sessionId: `${INTEGRATION_SESSION_PREFIX}${id}`,
        tenantId: session.tenantId,
        userId: session.userId,
      },
      {
        secret: this.configService.getOrThrow<string>("auth.sessionSecret"),
        ttlSeconds: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      },
    );
    const record = await this.tokenRepository.save(
      this.tokenRepository.create({
        expiresAt,
        id,
        note: nullableText(payload?.note),
        ownerUserId: session.userId,
        permissions,
        revokedAt: null,
        scope: "tenant",
        tenantId: this.tenantId,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 24),
      }),
    );
    return { ...toIntegrationTokenDto(record), token };
  }

  async revoke(authorization: string | undefined, tokenId: string) {
    const session = await this.requirePersonalSession(authorization);
    const token = await this.tokenRepository.findOne({
      where: {
        id: tokenId,
        ownerUserId: session.userId,
        tenantId: this.tenantId,
      },
    });
    if (!token) throw new NotFoundException("Token 不存在");
    token.revokedAt ??= new Date();
    token.revokedReason ??= "user-revoked";
    await this.tokenRepository.save(token);
  }

  private async effectivePermissions(userId: string) {
    const tenantAssignments = await this.tenantContext.repository(UserTenantRole).find({
      relations: { role: true },
      where: { tenantId: this.tenantId, userId },
    });
    const memberships = await this.tenantContext.repository(UserOrganization).find({
      where: { status: "active", tenantId: this.tenantId, userId },
    });
    const membershipsById = new Map(
      memberships.map((membership) => [membership.id, membership]),
    );
    const organizationAssignments = memberships.length
      ? await this.tenantContext.repository(UserOrganizationRole).find({
          relations: { role: true },
          where: {
            membershipId: In(memberships.map((membership) => membership.id)),
            tenantId: this.tenantId,
          },
        })
      : [];
    const roleIds = [
      ...tenantAssignments
        .filter(
          (assignment) =>
            assignment.role?.scope === "tenant" &&
            assignment.role.organizationId === null,
        )
        .map((assignment) => assignment.roleId),
      ...organizationAssignments
        .filter((assignment) => {
          const membership = membershipsById.get(assignment.membershipId);
          return (
            membership?.organizationId === assignment.organizationId &&
            assignment.role?.scope === "organization" &&
            assignment.role.organizationId === assignment.organizationId
          );
        })
        .map((assignment) => assignment.roleId),
    ];
    if (!roleIds.length) return [];
    const rows = await this.tenantContext.repository(RolePermission).find({
      where: {
        enabled: true,
        roleId: In([...new Set(roleIds)]),
        tenantId: this.tenantId,
      },
    });
    return [
      ...new Set(
        rows
          .map((row) => row.permission)
          .filter((permission) => !isTokenManagementPermission(permission)),
      ),
    ].sort();
  }

  private async delegatablePermissions(userId: string) {
    const effectivePermissions = await this.effectivePermissions(userId);
    const definitions = effectivePermissions.length
      ? await this.tenantContext.repository(Permission).find({
          where: { code: In(effectivePermissions) },
        })
      : [];
    const definitionsByCode = new Map(
      definitions
        .filter((definition) => definition.code)
        .map((definition) => [definition.code as string, definition]),
    );
    return {
      definitionsByCode,
      permissions: effectivePermissions.filter(
        (permission) =>
          definitionsByCode.has(permission) &&
          definitionsByCode.get(permission)?.source !== "navigation",
      ),
    };
  }

  private async requirePersonalSession(authorization: string | undefined) {
    const session = await this.authSessionService.validateAccessToken(extractBearerToken(authorization));
    if (session.tokenKind === "integration") throw new ForbiddenException("个人 API Token 不能管理其他 Token");
    if (session.principalType !== "tenant" || session.tenantId !== this.tenantId) {
      throw new ForbiddenException("当前会话不能管理个人 API Token");
    }
    return session;
  }

  private get tokenRepository() { return this.tenantContext.repository(IntegrationToken); }
  private get tenantId() { return this.tenantContext.current()!.tenantId; }
}

function toPermissionCapability(code: string, definition?: Permission) {
  const [path, scope = "tenant"] = code.split(":");
  const [fallbackEntity = "permission", fallbackPurpose = "general", fallbackOperation = "access"] = path.split(".");
  const entity = definition?.entity ?? fallbackEntity;
  const purpose = definition?.purpose ?? fallbackPurpose;
  const operation = definition?.operation ?? fallbackOperation;
  return {
    description: definition?.description ?? null,
    entity,
    entityLabel: definition?.entityLabel ?? entity,
    entityOrder: definition?.entityOrder ?? null,
    isDangerous: definition?.isDangerous ?? false,
    label: definition?.operationLabel ?? operation,
    operation,
    operationOrder: definition?.operationOrder ?? null,
    permission: code,
    purpose,
    purposeLabel: definition?.purposeLabel ?? purpose,
    purposeOrder: definition?.purposeOrder ?? null,
    scope,
  };
}

function normalizePermissions(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BadRequestException("Token 权限格式不正确");
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}
function normalizeExpiresAt(value: unknown) {
  const now = Date.now();
  const expiresAt = value ? new Date(String(value)) : new Date(now + DEFAULT_TOKEN_TTL_MS);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    throw new BadRequestException("Token 过期时间无效");
  }
  if (expiresAt.getTime() - now > MAX_TOKEN_TTL_MS) {
    throw new BadRequestException("Token 有效期不能超过 1 年");
  }
  return expiresAt;
}
function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function extractBearerToken(value: string | undefined) {
  return value?.replace(/^Bearer\s+/i, "").trim();
}
function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function isTokenManagementPermission(permission: string) {
  return permission.startsWith("integration_token.personal_api_token.");
}
function toIntegrationTokenDto(token: IntegrationToken) {
  return {
    createdAt: token.createdAt,
    expiresAt: token.expiresAt,
    id: token.id,
    isExpired: token.expiresAt.getTime() <= Date.now(),
    lastUsedAt: token.lastUsedAt,
    note: token.note,
    ownerUserId: token.ownerUserId,
    permissions: token.permissions,
    revokedAt: token.revokedAt,
    scope: token.scope,
    tokenPrefix: token.tokenPrefix,
  };
}
