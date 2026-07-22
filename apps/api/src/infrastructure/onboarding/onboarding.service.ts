import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  Account,
  Permission,
  PLATFORM_ADMIN_ROLE_NAME,
  PLATFORM_SETTING_KEYS,
  PLATFORM_TITLE_SETTING_KEY,
  PlatformMembership,
  Role,
  RolePermission,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import type {
  OnboardingPayload,
  OnboardingState,
  ResumeOnboardingPayload,
  SaveSettingsPayload,
} from "@hermes-swarm/api-contracts";
import { DataSource, type EntityManager } from "typeorm";
import { syncPermissionCatalogInTransaction } from "../../common/database/seed/seed-permission-catalog.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { SettingsService } from "../settings/settings.service.js";

const ONBOARDING_LOCK_NAME = "hermes-swarm:first-workspace-onboarding";

type NormalizedWorkspaceOnboarding = {
  defaultLanguage: "en" | "zh-Hans" | "zh-Hant";
  defaultTimeZone: string;
  platformTitle: string;
  workspaceApplicationsEnabled: boolean;
  workspaceName: string;
  workspaceSlug: string;
};

export type OnboardingProvisionResult = {
  account: Account;
  membership: WorkspaceMembership;
};

@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  async getState(manager: EntityManager = this.dataSource.manager) {
    const [accountCount, platformAdminRole, workspaceCount] = await Promise.all([
      manager.getRepository(Account).count({ withDeleted: true }),
      manager.findOne(Role, {
        where: { name: PLATFORM_ADMIN_ROLE_NAME, scope: "platform" },
      }),
      manager.getRepository(Workspace).count({ withDeleted: true }),
    ]);
    const activeAdminCount = platformAdminRole
      ? await manager.getRepository(PlatformMembership).count({
          where: { roleId: platformAdminRole.id, status: "active" },
        })
      : 0;
    return resolveOnboardingState(activeAdminCount, workspaceCount, accountCount);
  }

  async create(payload: OnboardingPayload): Promise<OnboardingProvisionResult> {
    const input = normalizeWorkspaceOnboarding(payload);
    const adminName = requireText(payload.adminName, "管理员名称", 120);
    const adminEmail = normalizeEmail(payload.adminEmail);
    const adminPassword = requirePassword(payload.adminPassword);

    const transaction = await this.dataSource.transaction(async (manager) => {
      await acquireOnboardingLock(manager);
      assertOnboardingState(await this.getState(manager), "admin_required");
      const permissions = await syncPermissionCatalogInTransaction(manager);

      const existingAccount = await manager.findOne(Account, {
        where: { email: adminEmail },
        withDeleted: true,
      });
      if (existingAccount) {
        throw new BadRequestException("管理员邮箱已被现有账号占用");
      }

      const account = await manager.save(
        Account,
        manager.create(Account, {
          displayName: adminName,
          email: adminEmail,
          emailVerified: true,
          nickname: adminName,
          passwordHash: await hashPassword(adminPassword),
          preferredLanguage: input.defaultLanguage,
          status: "active",
          timeZone: input.defaultTimeZone,
          type: "user",
        }),
      );
      const platformRole = await ensureSystemRole(manager, {
        description: "Platform administrator with all platform permissions.",
        displayName: "Platform Admin",
        name: PLATFORM_ADMIN_ROLE_NAME,
        scope: "platform",
        workspaceId: null,
      });
      await replaceDefaultRolePermissions(manager, platformRole, permissions);
      await manager.save(
        PlatformMembership,
        manager.create(PlatformMembership, {
          accountId: account.id,
          removedAt: null,
          roleId: platformRole.id,
          status: "active",
        }),
      );

      const provisioned = await provisionWorkspace(manager, account, input, permissions);
      const invalidations = await this.settingsService.savePlatformSettingsInTransaction(
        manager,
        platformSettingsPayload(input),
      );
      return { ...provisioned, invalidations };
    });

    await this.settingsService.applySettingsInvalidations(transaction.invalidations);
    return { account: transaction.account, membership: transaction.membership };
  }

  async resume(
    accountId: string,
    payload: ResumeOnboardingPayload,
  ): Promise<OnboardingProvisionResult> {
    const input = normalizeWorkspaceOnboarding(payload);
    const normalizedAccountId = requireText(accountId, "管理员账号", 80);

    const transaction = await this.dataSource.transaction(async (manager) => {
      await acquireOnboardingLock(manager);
      assertOnboardingState(await this.getState(manager), "workspace_required");
      const permissions = await syncPermissionCatalogInTransaction(manager);

      const [account, platformMembership] = await Promise.all([
        manager.findOne(Account, {
          where: { id: normalizedAccountId, status: "active" },
        }),
        manager.findOne(PlatformMembership, {
          relations: { role: true },
          where: { accountId: normalizedAccountId, status: "active" },
        }),
      ]);
      if (!account || platformMembership?.role?.scope !== "platform") {
        throw new BadRequestException("当前账号不能续办平台主管理初始化");
      }

      const provisioned = await provisionWorkspace(manager, account, input, permissions);
      const invalidations = await this.settingsService.savePlatformSettingsInTransaction(
        manager,
        platformSettingsPayload(input),
      );
      return { ...provisioned, invalidations };
    });

    await this.settingsService.applySettingsInvalidations(transaction.invalidations);
    return { account: transaction.account, membership: transaction.membership };
  }
}

export function resolveOnboardingState(
  activeAdminCount: number,
  workspaceCount: number,
  accountCount: number,
): OnboardingState {
  if (activeAdminCount === 0 && workspaceCount === 0 && accountCount === 0) {
    return "admin_required";
  }
  if (activeAdminCount > 0 && workspaceCount === 0) return "workspace_required";
  if (activeAdminCount > 0 && workspaceCount > 0) return "complete";
  return "recovery_required";
}

async function provisionWorkspace(
  manager: EntityManager,
  account: Account,
  input: NormalizedWorkspaceOnboarding,
  permissions: Permission[],
) {
  const workspace = await manager.save(
    Workspace,
    manager.create(Workspace, {
      name: input.workspaceName,
      slug: input.workspaceSlug,
      status: "active",
      subdomain: null,
    }),
  );
  const roles = [
    await ensureSystemRole(manager, {
      description: "Workspace owner with full governance access.",
      displayName: "Workspace Owner",
      name: "workspace-owner",
      scope: "workspace",
      workspaceId: workspace.id,
    }),
    await ensureSystemRole(manager, {
      description: "Workspace administrator with governance access.",
      displayName: "Workspace Admin",
      name: "workspace-admin",
      scope: "workspace",
      workspaceId: workspace.id,
    }),
    await ensureSystemRole(manager, {
      description: "Workspace member with standard access.",
      displayName: "Workspace Member",
      name: "workspace-member",
      scope: "workspace",
      workspaceId: workspace.id,
    }),
  ];
  for (const role of roles) {
    await replaceDefaultRolePermissions(manager, role, permissions);
  }

  const membership = await manager.save(
    WorkspaceMembership,
    manager.create(WorkspaceMembership, {
      accountId: account.id,
      removedAt: null,
      roleId: roles[0].id,
      status: "active",
      workspaceId: workspace.id,
    }),
  );
  return { account, membership };
}

async function ensureSystemRole(
  manager: EntityManager,
  input: {
    description: string;
    displayName: string;
    name: string;
    scope: "platform" | "workspace";
    workspaceId: string | null;
  },
) {
  if (input.scope === "workspace" && !input.workspaceId) {
    throw new Error("Workspace system roles require a workspace id");
  }
  const existing = await manager.findOne(Role, {
    where: input.scope === "platform"
      ? { name: input.name, scope: "platform" }
      : { name: input.name, scope: "workspace", workspaceId: input.workspaceId! },
  });
  return manager.save(
    Role,
    Object.assign(
      existing ?? manager.create(Role, { name: input.name }),
      {
        color: input.scope === "workspace" ? "#7c3aed" : null,
        description: input.description,
        displayName: input.displayName,
        isSystem: true,
        label: input.displayName,
        scope: input.scope,
        workspaceId: input.workspaceId,
      },
    ),
  );
}

async function replaceDefaultRolePermissions(
  manager: EntityManager,
  role: Role,
  permissions: Permission[],
) {
  const grants = permissions
    .filter((permission) => {
      if (!permission.defaultRoles?.includes(role.name)) return false;
      return role.scope === "platform"
        ? permission.scope === "platform"
        : permission.scope === "workspace" || permission.scope === "own";
    })
    .map((permission) =>
      manager.create(RolePermission, {
        enabled: true,
        permissionId: permission.id,
        roleId: role.id,
      }),
    );
  await manager.delete(RolePermission, { roleId: role.id });
  if (grants.length > 0) await manager.save(RolePermission, grants);
}

function platformSettingsPayload(
  input: NormalizedWorkspaceOnboarding,
): SaveSettingsPayload {
  return {
    settings: [
      {
        name: PLATFORM_TITLE_SETTING_KEY,
        scope: "platform",
        value: input.platformTitle,
        valueType: "string",
      },
      {
        name: PLATFORM_SETTING_KEYS.defaultLanguage,
        scope: "workspace",
        value: input.defaultLanguage,
      },
      {
        name: PLATFORM_SETTING_KEYS.defaultTimeZone,
        scope: "workspace",
        value: input.defaultTimeZone,
      },
      {
        name: PLATFORM_SETTING_KEYS.workspaceApplicationsEnabled,
        scope: "platform",
        value: input.workspaceApplicationsEnabled,
      },
    ],
  };
}

function normalizeWorkspaceOnboarding(
  payload: ResumeOnboardingPayload | OnboardingPayload,
): NormalizedWorkspaceOnboarding {
  const defaultLanguage = payload.defaultLanguage;
  if (!["en", "zh-Hans", "zh-Hant"].includes(defaultLanguage)) {
    throw new BadRequestException("默认语言无效");
  }
  const workspaceSlug = requireText(payload.workspaceSlug, "工作空间标识", 80)
    .toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug)) {
    throw new BadRequestException("工作空间标识只能包含小写字母、数字和连字符");
  }
  const defaultTimeZone = requireText(payload.defaultTimeZone, "默认时区", 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: defaultTimeZone }).format();
  } catch {
    throw new BadRequestException("默认时区无效");
  }
  return {
    defaultLanguage,
    defaultTimeZone,
    platformTitle: requireText(payload.platformTitle, "平台名称", 120),
    workspaceApplicationsEnabled: payload.workspaceApplicationsEnabled,
    workspaceName: requireText(payload.workspaceName, "工作空间名称", 120),
    workspaceSlug,
  };
}

function assertOnboardingState(
  actual: OnboardingState,
  expected: "admin_required" | "workspace_required",
) {
  if (actual === expected) return;
  if (actual === "workspace_required") {
    throw new BadRequestException("平台主管理员已创建，请登录后继续配置首个工作空间");
  }
  if (actual === "complete") {
    throw new BadRequestException("平台已经完成初始化");
  }
  if (actual === "recovery_required") {
    throw new BadRequestException("初始化数据状态异常，需要管理员恢复后才能继续");
  }
  throw new BadRequestException("尚未创建平台主管理员，不能续办初始化");
}

async function acquireOnboardingLock(manager: EntityManager) {
  await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    ONBOARDING_LOCK_NAME,
  ]);
}

function normalizeEmail(value: string | undefined) {
  const email = requireText(value, "邮箱", 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function requirePassword(value: string | undefined) {
  const password = value ?? "";
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  if (password.length > 240) throw new BadRequestException("密码长度不能超过 240 位");
  return password;
}

function requireText(value: string | undefined | null, label: string, max: number) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  if (text.length > max) throw new BadRequestException(`${label}长度不能超过 ${max} 位`);
  return text;
}
