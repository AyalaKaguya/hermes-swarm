import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, IsNull, Repository } from "typeorm";
import { IntegrationToken, User, type UserStatus } from "@hermes-swarm/core";
import type {
  CreateUserPayload,
  SearchUsersQuery,
  UpdatePreferredLanguagePayload,
  UpdateUserPasswordPayload,
  UpdateUserPayload,
} from "../../common/admin-api.types.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import {
  hashPassword,
  verifyPassword,
} from "../../common/security/password-hash.js";
import { toUserDto } from "./user-dto.js";

@Injectable()
/**
 * Implements global user-management operations.
 */
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(IntegrationToken)
    private readonly integrationTokenRepository: Repository<IntegrationToken>,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
  ) {}

  /**
   * Lists users in the active organization after checking user view permission.
   */
  async list(authorization: string | undefined) {
    await this.requireSessionUserId(authorization);
    const users = await this.userRepository.find({
      order: { createdAt: "DESC" },
    });
    return users.map(toUserDto);
  }

  /**
   * Searches organization users by profile, email, username, or mobile fields.
   */
  async search(authorization: string | undefined, query: SearchUsersQuery) {
    await this.requireSessionUserId(authorization);
    const input = requirePayload(query);
    const search = normalizeOptionalText(input.search);
    if (!search) return this.list(authorization);

    const pattern = `%${search}%`;
    const users = await this.userRepository.find({
      order: { createdAt: "DESC" },
      take: 20,
      where: [
        { email: ILike(pattern) },
        { displayName: ILike(pattern) },
        { nickname: ILike(pattern) },
        { username: ILike(pattern) },
        { mobile: ILike(pattern) },
      ],
    });
    return users.map(toUserDto);
  }

  /**
   * Creates a user in the active organization with the requested role.
   */
  async create(
    authorization: string | undefined,
    payload: CreateUserPayload,
  ) {
    await this.requireSessionUserId(authorization);
    const input = requirePayload(payload);
    const email = normalizeEmail(input.email);
    await this.assertUniqueEmail(email);

    const displayName =
      normalizeOptionalText(input.displayName) ?? email.split("@")[0] ?? email;
    const passwordHash = input.password
      ? hashPassword(requirePassword(input.password))
      : null;

    const user = this.userRepository.create({
      avatarUrl: normalizeNullableText(input.imageUrl),
      displayName,
      email,
      firstName: normalizeNullableText(input.firstName),
      imageUrl: normalizeNullableText(input.imageUrl),
      lastName: normalizeNullableText(input.lastName),
      mobile: normalizeNullableText(input.mobile),
      nickname: displayName,
      passwordHash,
      status:
        input.status === undefined ? "active" : normalizeUserStatus(input.status),
      type: "user",
      username: normalizeNullableText(input.username),
    });

    try {
      return toUserDto(await this.userRepository.save(user));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已被使用");
      }
      throw error;
    }
  }

  /**
   * Updates mutable profile, status, role, and credential fields for a user.
   */
  async update(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const currentUserId = await this.requireSessionUserId(authorization);
    if (currentUserId !== userId) {
      throw new ForbiddenException("只能更新自己的账号信息");
    }
    const input = requirePayload(payload);
    const user = await this.getUserOrThrow(userId);
    return this.applyUserPatch(user, input);
  }

  /**
   * Updates mutable fields for a global user from platform administration.
   */
  async updateManaged(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    await this.requireSessionUserId(authorization);
    const input = requirePayload(payload);
    const user = await this.getUserOrThrow(userId);
    return this.applyUserPatch(user, input);
  }

  /**
   * Deletes a global user from platform administration.
   */
  async deleteManaged(authorization: string | undefined, userId: string) {
    await this.requireSessionUserId(authorization);
    const user = await this.getUserOrThrow(userId);
    await this.userRepository.manager.transaction(async (manager) => {
      await manager.update(
        IntegrationToken,
        { ownerUserId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      await manager.softDelete(User, { id: user.id });
    });
    await this.authSessionService.revokeUserSessions(user.id);
  }

  /**
   * Updates a user password, allowing self-service with current password proof.
   */
  async updatePassword(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPasswordPayload,
  ) {
    const currentUserId = await this.requireSessionUserId(authorization);
    if (currentUserId !== userId) {
      throw new ForbiddenException("只能更新自己的密码");
    }
    const input = requirePayload(payload);
    const user = await this.getUserOrThrow(userId);

    if (user.passwordHash) {
      const currentPassword = requireText(input.currentPassword, "当前密码");
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        throw new BadRequestException("当前密码不正确");
      }
    }

    user.passwordHash = hashPassword(requirePassword(input.password));
    user.updatedAt = new Date();
    try {
      return toUserDto(await this.userRepository.save(user));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已被使用");
      }
      throw error;
    }
  }

  /**
   * Updates a user's preferred language within the supported language set.
   */
  async updatePreferredLanguage(
    authorization: string | undefined,
    userId: string,
    payload: UpdatePreferredLanguagePayload,
  ) {
    const currentUserId = await this.requireSessionUserId(authorization);
    if (currentUserId !== userId) {
      throw new ForbiddenException("只能更新自己的语言偏好");
    }
    const input = requirePayload(payload);
    const user = await this.getUserOrThrow(userId);
    user.preferredLanguage = normalizePreferredLanguage(
      input.preferredLanguage,
    );
    user.updatedAt = new Date();
    return toUserDto(await this.userRepository.save(user));
  }

  private async applyUserPatch(user: User, payload: UpdateUserPayload) {
    const wasActive = user.status === "active";
    if (payload.email !== undefined) {
      const email = normalizeEmail(payload.email);
      if (email !== user.email) await this.assertUniqueEmail(email, user.id);
      user.email = email;
    }
    if (payload.displayName !== undefined) {
      const displayName = requireText(payload.displayName, "显示名称");
      user.displayName = displayName;
      user.nickname = displayName;
    }
    if (payload.firstName !== undefined) {
      user.firstName = normalizeNullableText(payload.firstName);
    }
    if (payload.lastName !== undefined) {
      user.lastName = normalizeNullableText(payload.lastName);
    }
    if (payload.imageUrl !== undefined) {
      user.imageUrl = normalizeNullableText(payload.imageUrl);
      user.avatarUrl = user.imageUrl;
    }
    if (payload.mobile !== undefined) {
      user.mobile = normalizeNullableText(payload.mobile);
    }
    if (payload.username !== undefined) {
      user.username = normalizeNullableText(payload.username);
    }
    if (payload.status !== undefined) {
      user.status = normalizeUserStatus(payload.status);
    }
    if (payload.password !== undefined) {
      user.passwordHash = hashPassword(requirePassword(payload.password));
    }

    user.updatedAt = new Date();
    const shouldRevokeAccess = wasActive && user.status !== "active";
    try {
      const saved = await this.userRepository.manager.transaction(
        async (manager) => {
          const result = await manager.save(User, user);
          if (shouldRevokeAccess) {
            await manager.update(
              IntegrationToken,
              { ownerUserId: user.id, revokedAt: IsNull() },
              { revokedAt: new Date() },
            );
          }
          return result;
        },
      );
      if (shouldRevokeAccess) {
        await this.authSessionService.revokeUserSessions(user.id);
      }
      return toUserDto(saved);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已被使用");
      }
      throw error;
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

  private async getUserOrThrow(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("用户不存在");
    return user;
  }

  private async assertUniqueEmail(email: string, exceptUserId?: string) {
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing && existing.id !== exceptUserId) {
      throw new BadRequestException("邮箱已被使用");
    }
  }
}

function requirePayload<T extends object>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
}

function normalizeEmail(value: unknown) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function requireText(value: unknown, label: string) {
  if (value === undefined || value === null) {
    throw new BadRequestException(`${label}不能为空`);
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${label}无效`);
  }
  const text = value.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeOptionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("文本字段无效");
  }
  const text = value.trim();
  return text || null;
}

function normalizeNullableText(value: unknown) {
  return value === null ? null : normalizeOptionalText(value);
}

function requirePassword(value: unknown) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function normalizePreferredLanguage(value: unknown) {
  const language = requireText(value, "首选语言");
  switch (language) {
    case "en":
      return "en";
    case "zh":
    case "zh-CN":
    case "zh-Hans":
      return "zh-Hans";
    case "zh-Hant":
      return "zh-Hant";
    default:
      throw new BadRequestException("不支持的语言");
  }
}

function normalizeUserStatus(value: unknown): UserStatus {
  if (value === "active" || value === "disabled") return value;
  throw new BadRequestException("用户状态无效");
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}
