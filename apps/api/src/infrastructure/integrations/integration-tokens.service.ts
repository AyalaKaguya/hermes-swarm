import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Permission,
  RolePermission,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { In, type Repository } from "typeorm";
import type { CreateIntegrationTokenPayload } from "../../common/admin-api.types.js";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
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
    private readonly workspaceContext: WorkspaceContextService,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    @InjectRepository(WorkspaceMembership)
    private readonly workspaceMembershipRepository: Repository<WorkspaceMembership>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
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
          scope: "workspace" as const,
        },
      ],
    };
  }

  async list(authorization: string | undefined) {
    const session = await this.requirePersonalSession(authorization);
    return (
      await this.integrationTokenRepository.find({
        order: { createdAt: "DESC" },
        where: { ownerUserId: session.userId, workspaceId: this.workspaceId },
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
        workspaceId: session.workspaceId,
        userId: session.userId,
      },
      {
        secret: this.configService.getOrThrow<string>("auth.sessionSecret"),
        ttlSeconds: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      },
    );
    const record = await this.integrationTokenRepository.save(
      this.integrationTokenRepository.create({
        expiresAt,
        id,
        note: nullableText(payload?.note),
        ownerUserId: session.userId,
        permissions,
        revokedAt: null,
        scope: "workspace",
        workspaceId: this.workspaceId,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 24),
      }),
    );
    return { ...toIntegrationTokenDto(record), token };
  }

  async revoke(authorization: string | undefined, tokenId: string) {
    const session = await this.requirePersonalSession(authorization);
    const token = await this.integrationTokenRepository.findOne({
      where: {
        id: tokenId,
        ownerUserId: session.userId,
        workspaceId: this.workspaceId,
      },
    });
    if (!token) throw new NotFoundException("Token 不存在");
    token.revokedAt ??= new Date();
    token.revokedReason ??= "user-revoked";
    await this.integrationTokenRepository.save(token);
  }

  private async effectivePermissions(userId: string) {
    const workspaceId = this.workspaceId;
    const workspaceAssignments = await this.workspaceMembershipRepository.find({
      relations: { role: true },
      where: { accountId: userId, status: "active", workspaceId },
    });
    const roleIds = workspaceAssignments
      .flatMap((assignment) =>
        assignment.roleId &&
        assignment.role?.scope === "workspace" &&
        assignment.role.workspaceId === workspaceId
          ? [assignment.roleId]
          : [],
      );
    if (!roleIds.length) return [];
    const rows = await this.rolePermissionRepository.find({
      relations: { permissionRecord: true, role: true },
      where: {
        enabled: true,
        roleId: In([...new Set(roleIds)]),
        role: { scope: "workspace", workspaceId },
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
      ? await this.permissionRepository.find({
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
    if (session.principalType !== "workspace" || session.workspaceId !== this.workspaceId) {
      throw new ForbiddenException("当前会话不能管理个人 API Token");
    }
    const membership = await this.workspaceMembershipRepository.findOne({
      relations: { role: true },
      where: {
        accountId: session.userId,
        status: "active",
        workspaceId: this.workspaceId,
      },
    });
    if (
      !membership ||
      membership.role?.scope !== "workspace" ||
      membership.role.workspaceId !== this.workspaceId
    ) {
      throw new ForbiddenException("当前账号不属于该工作空间");
    }
    return session;
  }

  private get workspaceId() { return this.workspaceContext.current()!.workspaceId; }
}

function toPermissionCapability(code: string, definition?: Permission) {
  const [path, scope = "workspace"] = code.split(":");
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
