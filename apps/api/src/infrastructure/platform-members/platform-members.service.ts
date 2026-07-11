import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PLATFORM_ADMIN_ROLE_NAME,
  PlatformRole,
  PlatformUser,
  PlatformUserRole,
  type PlatformUserStatus,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { hashPassword } from "../../common/security/password-hash.js";
import type { PlatformMemberPayload } from "./platform-members.controller.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Injectable()
export class PlatformMembersService {
  constructor(
    @InjectRepository(PlatformUser, PLATFORM_DATA_SOURCE)
    private readonly userRepository: Repository<PlatformUser>,
    @InjectRepository(PlatformRole, PLATFORM_DATA_SOURCE)
    private readonly roleRepository: Repository<PlatformRole>,
    @InjectRepository(PlatformUserRole, PLATFORM_DATA_SOURCE)
    private readonly userRoleRepository: Repository<PlatformUserRole>,
  ) {}

  async list() {
    const users = await this.userRepository.find({
      order: { createdAt: "ASC" },
      relations: { roles: { platformRole: true } },
    });
    return users.map(toPlatformUserDto);
  }

  async create(payload: PlatformMemberPayload) {
    const input = requirePayload(payload);
    const role = await this.resolveRole(input.roleId);
    let user = input.userId
      ? await this.userRepository.findOne({ where: { id: input.userId } })
      : null;
    if (!user) {
      const email = normalizeEmail(input.email);
      if (await this.userRepository.findOne({ where: { email } })) {
        throw new BadRequestException("平台账号邮箱已被使用");
      }
      const displayName = requireText(input.displayName, "显示名称");
      const password = requireText(input.password, "密码");
      if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
      user = await this.userRepository.save(
        this.userRepository.create({
          displayName,
          email,
          passwordHash: hashPassword(password),
          preferredLanguage: "zh-CN",
          status: normalizeStatus(input.status),
        }),
      );
    }
    if (role) await this.assignRole(user.id, role.id);
    return toPlatformUserDto(await this.getUserOrThrow(user.id));
  }

  async update(platformUserId: string, payload: Partial<PlatformMemberPayload>) {
    const input = requirePayload(payload);
    await this.userRepository.manager.transaction(async (manager) => {
      const user = await manager.findOne(PlatformUser, {
        lock: { mode: "pessimistic_write" },
        relations: { roles: { platformRole: true } },
        where: { id: platformUserId },
      });
      if (!user) throw new NotFoundException("平台账号不存在");
      const wasAdmin = isActivePlatformAdmin(user);
      if (input.displayName !== undefined) {
        user.displayName = requireText(input.displayName, "显示名称");
      }
      if (input.status !== undefined) user.status = normalizeStatus(input.status);
      if (input.roleId !== undefined) {
        await manager.delete(PlatformUserRole, { platformUserId: user.id });
        const role = await this.resolveRole(input.roleId, manager);
        if (role) {
          await manager.save(
            PlatformUserRole,
            manager.create(PlatformUserRole, {
              platformRoleId: role.id,
              platformUserId: user.id,
            }),
          );
          user.roles = [{ platformRole: role }] as PlatformUserRole[];
        } else {
          user.roles = [];
        }
      }
      if (wasAdmin && !isActivePlatformAdmin(user)) {
        await this.assertAnotherAdmin(user.id, manager);
      }
      await manager.save(PlatformUser, user);
    });
    return toPlatformUserDto(await this.getUserOrThrow(platformUserId));
  }

  async remove(platformUserId: string) {
    await this.userRepository.manager.transaction(async (manager) => {
      const user = await manager.findOne(PlatformUser, {
        lock: { mode: "pessimistic_write" },
        relations: { roles: { platformRole: true } },
        where: { id: platformUserId },
      });
      if (!user) throw new NotFoundException("平台账号不存在");
      if (isActivePlatformAdmin(user)) await this.assertAnotherAdmin(user.id, manager);
      await manager.delete(PlatformUserRole, { platformUserId: user.id });
      await manager.softDelete(PlatformUser, { id: user.id });
    });
  }

  private async getUserOrThrow(id: string) {
    const user = await this.userRepository.findOne({
      relations: { roles: { platformRole: true } },
      where: { id },
    });
    if (!user) throw new NotFoundException("平台账号不存在");
    return user;
  }

  private async resolveRole(roleId: string | null | undefined, manager = this.roleRepository.manager) {
    if (roleId === null || roleId === undefined) return null;
    const id = requireText(roleId, "角色 ID");
    const role = await manager.findOne(PlatformRole, { where: { id } });
    if (!role) throw new BadRequestException("平台角色不存在");
    return role;
  }

  private async assignRole(platformUserId: string, platformRoleId: string) {
    const exists = await this.userRoleRepository.findOne({
      where: { platformRoleId, platformUserId },
    });
    if (!exists) {
      await this.userRoleRepository.save(
        this.userRoleRepository.create({ platformRoleId, platformUserId }),
      );
    }
  }

  private async assertAnotherAdmin(currentUserId: string, manager: Repository<PlatformUser>["manager"]) {
    const users = await manager.find(PlatformUser, {
      lock: { mode: "pessimistic_write" },
      relations: { roles: { platformRole: true } },
      where: { status: "active" },
    });
    if (!users.some((user) => user.id !== currentUserId && isActivePlatformAdmin(user))) {
      throw new BadRequestException("平台至少需要保留一个 Platform Admin");
    }
  }
}

function requirePayload(value: object | null | undefined) {
  if (!value || Array.isArray(value)) throw new BadRequestException("请求内容无效");
  return value as Partial<PlatformMemberPayload>;
}

function requireText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeEmail(value: unknown) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function normalizeStatus(value: unknown): PlatformUserStatus {
  if (value === undefined || value === null) return "active";
  if (value === "active" || value === "disabled") return value;
  throw new BadRequestException("平台账号状态无效");
}

function isActivePlatformAdmin(user: PlatformUser) {
  return user.status === "active" &&
    user.roles?.some((item) => item.platformRole?.name === PLATFORM_ADMIN_ROLE_NAME);
}

function toPlatformUserDto(user: PlatformUser) {
  const roles = user.roles?.map((item) => item.platformRole).filter(Boolean) ?? [];
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    role: roles[0] ?? null,
    roleId: roles[0]?.id ?? null,
    roles,
    status: user.status,
    user: undefined,
    userId: user.id,
  };
}
