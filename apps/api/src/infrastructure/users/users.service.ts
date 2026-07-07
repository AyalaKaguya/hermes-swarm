import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { User } from "@hermes-swarm/core";
import type {
  CreateUserPayload,
  SearchUsersQuery,
  UpdatePreferredLanguagePayload,
  UpdateUserPasswordPayload,
  UpdateUserPayload,
} from "../../common/admin-api.types.js";
import { parseAuthSessionToken } from "../auth/auth-session.js";
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
  ) {}

  /**
   * Lists users in the active organization after checking user view permission.
   */
  async list(authorization: string | undefined) {
    this.requireSessionUserId(authorization);
    const users = await this.userRepository.find({
      order: { createdAt: "DESC" },
    });
    return users.map(toUserDto);
  }

  /**
   * Searches organization users by profile, email, username, or mobile fields.
   */
  async search(authorization: string | undefined, query: SearchUsersQuery) {
    this.requireSessionUserId(authorization);
    const search = normalizeOptionalText(query.search);
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
    this.requireSessionUserId(authorization);
    const email = normalizeEmail(payload.email);
    await this.assertUniqueEmail(email);

    const displayName =
      normalizeOptionalText(payload.displayName) ?? email.split("@")[0] ?? email;
    const passwordHash = payload.password
      ? hashPassword(requirePassword(payload.password))
      : null;

    const user = this.userRepository.create({
      avatarUrl: payload.imageUrl ?? null,
      displayName,
      email,
      firstName: normalizeNullableText(payload.firstName),
      imageUrl: payload.imageUrl ?? null,
      lastName: normalizeNullableText(payload.lastName),
      mobile: normalizeNullableText(payload.mobile),
      nickname: displayName,
      passwordHash,
      status: payload.status ?? "active",
      type: "user",
      username: normalizeNullableText(payload.username),
    });

    return toUserDto(await this.userRepository.save(user));
  }

  /**
   * Updates mutable profile, status, role, and credential fields for a user.
   */
  async update(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const currentUserId = this.requireSessionUserId(authorization);
    if (currentUserId !== userId) {
      throw new ForbiddenException("只能更新自己的账号信息");
    }
    const user = await this.getUserOrThrow(userId);
    return this.applyUserPatch(user, payload);
  }

  /**
   * Updates mutable fields for a global user from platform administration.
   */
  async updateManaged(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    this.requireSessionUserId(authorization);
    const user = await this.getUserOrThrow(userId);
    return this.applyUserPatch(user, payload);
  }

  /**
   * Deletes a global user from platform administration.
   */
  async deleteManaged(authorization: string | undefined, userId: string) {
    this.requireSessionUserId(authorization);
    const user = await this.getUserOrThrow(userId);
    await this.userRepository.softDelete({ id: user.id });
  }

  /**
   * Updates a user password, allowing self-service with current password proof.
   */
  async updatePassword(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPasswordPayload,
  ) {
    const currentUserId = this.requireSessionUserId(authorization);
    if (currentUserId !== userId) {
      throw new ForbiddenException("只能更新自己的密码");
    }
    const user = await this.getUserOrThrow(userId);

    if (currentUserId === user.id && payload.currentPassword) {
      if (!verifyPassword(payload.currentPassword, user.passwordHash)) {
        throw new BadRequestException("当前密码不正确");
      }
    }

    user.passwordHash = hashPassword(requirePassword(payload.password));
    user.updatedAt = new Date();
    return toUserDto(await this.userRepository.save(user));
  }

  /**
   * Updates a user's preferred language within the supported language set.
   */
  async updatePreferredLanguage(
    authorization: string | undefined,
    userId: string,
    payload: UpdatePreferredLanguagePayload,
  ) {
    const currentUserId = this.requireSessionUserId(authorization);
    if (currentUserId !== userId) {
      throw new ForbiddenException("只能更新自己的语言偏好");
    }
    const user = await this.getUserOrThrow(userId);
    user.preferredLanguage = normalizePreferredLanguage(
      payload.preferredLanguage,
    );
    user.updatedAt = new Date();
    return toUserDto(await this.userRepository.save(user));
  }

  private async applyUserPatch(user: User, payload: UpdateUserPayload) {
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
      user.status = payload.status;
    }
    if (payload.password !== undefined) {
      user.passwordHash = hashPassword(requirePassword(payload.password));
    }

    user.updatedAt = new Date();
    return toUserDto(await this.userRepository.save(user));
  }

  private requireSessionUserId(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    const session = parseAuthSessionToken(token);
    if (!session) throw new BadRequestException("登录已失效，请重新登录");
    return session.userId;
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

function normalizeEmail(value: string | undefined) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function requireText(value: string | undefined | null, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeOptionalText(value: string | undefined | null) {
  const text = value?.trim();
  return text || null;
}

function normalizeNullableText(value: string | undefined | null) {
  return value === null ? null : normalizeOptionalText(value);
}

function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function normalizePreferredLanguage(value: string | undefined | null) {
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
