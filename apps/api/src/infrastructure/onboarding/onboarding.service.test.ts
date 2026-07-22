import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Account,
  Permission,
  PlatformMembership,
  Role,
  RolePermission,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import {
  OnboardingService,
  resolveOnboardingState,
} from "./onboarding.service.js";

describe("onboarding state", () => {
  it("derives all public onboarding states", () => {
    assert.equal(resolveOnboardingState(0, 0, 0), "admin_required");
    assert.equal(resolveOnboardingState(1, 0, 1), "workspace_required");
    assert.equal(resolveOnboardingState(3, 0, 3), "workspace_required");
    assert.equal(resolveOnboardingState(1, 1, 1), "complete");
    assert.equal(resolveOnboardingState(2, 4, 5), "complete");
    assert.equal(resolveOnboardingState(0, 0, 1), "recovery_required");
    assert.equal(resolveOnboardingState(0, 1, 1), "recovery_required");
  });
});

describe("OnboardingService", () => {
  it("creates one account with platform admin and workspace owner memberships", async () => {
    const state = createState();
    const result = await state.service.create(freshPayload());

    assert.equal(state.store.accounts.length, 1);
    assert.equal(state.store.platformMemberships.length, 1);
    assert.equal(state.store.workspaceMemberships.length, 1);
    assert.equal(state.store.workspaces.length, 1);
    assert.equal(state.store.roles.length, 4);
    assert.equal(state.store.workspaces[0]?.subdomain, null);
    assert.equal(state.store.workspaces[0]?.status, "active");
    assert.equal(state.store.platformMemberships[0]?.accountId, result.account.id);
    assert.equal(state.store.workspaceMemberships[0]?.accountId, result.account.id);
    assert.equal(result.membership.accountId, result.account.id);
    assert.deepEqual(
      state.store.roles
        .filter((role) => role.scope === "workspace")
        .map((role) => role.name)
        .sort(),
      ["workspace-admin", "workspace-member", "workspace-owner"],
    );
    assert.ok(state.store.rolePermissions.length >= 4);
    assert.equal(await state.service.getState(), "complete");
    assert.equal(state.settings.savedInsideTransaction, true);
    assert.equal(state.settings.invalidationBatches, 1);
    assert.match(state.queries[0]?.sql ?? "", /pg_advisory_xact_lock/);

    const platformRole = state.store.roles.find(
      (role) => role.name === "platform-admin",
    );
    const workspaceOwnerRole = state.store.roles.find(
      (role) => role.name === "workspace-owner",
    );
    const accountSettingsPermission = state.store.permissions.find(
      (permission) => permission.code === "page.settings.account.access:own",
    );
    const platformSettingsPermission = state.store.permissions.find(
      (permission) => permission.code === "page.settings.platform.access:platform",
    );

    assert.ok(accountSettingsPermission);
    assert.ok(platformSettingsPermission);
    assert.ok(platformRole);
    assert.ok(workspaceOwnerRole);
    assert.ok(state.store.rolePermissions.some(
      (grant) =>
        grant.roleId === workspaceOwnerRole.id &&
        grant.permissionId === accountSettingsPermission.id,
    ));
    assert.ok(state.store.rolePermissions.some(
      (grant) =>
        grant.roleId === platformRole.id &&
        grant.permissionId === platformSettingsPermission.id,
    ));
  });

  it("rolls back all identity, workspace, role, and setting work on failure", async () => {
    const state = createState({ failSettings: true });

    await assert.rejects(
      () => state.service.create(freshPayload()),
      /settings failed/,
    );

    assert.equal(state.store.accounts.length, 0);
    assert.equal(state.store.platformMemberships.length, 0);
    assert.equal(state.store.workspaceMemberships.length, 0);
    assert.equal(state.store.workspaces.length, 0);
    assert.equal(state.store.roles.length, 0);
    assert.equal(state.store.rolePermissions.length, 0);
    assert.equal(state.settings.invalidationBatches, 0);
  });

  it("serializes concurrent fresh onboarding and permits only one request", async () => {
    const state = createState();
    const outcomes = await Promise.allSettled([
      state.service.create(freshPayload()),
      state.service.create(freshPayload()),
    ]);

    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
    assert.equal(state.store.accounts.length, 1);
    assert.equal(state.store.workspaces.length, 1);
  });

  it("resumes with the authenticated global administrator account", async () => {
    const state = createState({ existingAdmin: true });
    const account = state.store.accounts[0]!;

    const result = await state.service.resume(account.id, resumePayload());

    assert.equal(state.store.accounts.length, 1);
    assert.equal(state.store.workspaceMemberships.length, 1);
    assert.equal(result.account.id, account.id);
    assert.equal(result.membership.accountId, account.id);
    assert.equal(await state.service.getState(), "complete");
  });

  it("requires recovery for an active non-admin platform member", async () => {
    const state = createState({ existingPlatformMember: true });

    assert.equal(await state.service.getState(), "recovery_required");
  });

  it("rejects repeated and inconsistent initialization states", async () => {
    const complete = createState({ existingAdmin: true, existingWorkspace: true });
    await assert.rejects(
      () => complete.service.resume(complete.store.accounts[0]!.id, resumePayload()),
      /平台已经完成初始化/,
    );

    const recovery = createState({ existingWorkspace: true });
    await assert.rejects(
      () => recovery.service.create(freshPayload()),
      /初始化数据状态异常/,
    );
  });
});

function freshPayload() {
  return {
    ...resumePayload(),
    adminEmail: "ADMIN@example.com",
    adminName: "Platform Admin",
    adminPassword: "strong-password",
  } as const;
}

function resumePayload() {
  return {
    defaultLanguage: "zh-Hans",
    defaultTimeZone: "Asia/Shanghai",
    platformTitle: "Hermes",
    workspaceApplicationsEnabled: true,
    workspaceName: "Acme",
    workspaceSlug: "acme",
  } as const;
}

function createState(options: {
  existingAdmin?: boolean;
  existingPlatformMember?: boolean;
  existingWorkspace?: boolean;
  failSettings?: boolean;
} = {}) {
  const store: Store = {
    accounts: [],
    permissions: [],
    platformMemberships: [],
    rolePermissions: [],
    roles: [],
    workspaceMemberships: [],
    workspaces: [],
  };
  let nextId = 1;
  if (options.existingAdmin || options.existingPlatformMember) {
    const account = entity(Account, {
      displayName: "Existing Admin",
      email: "admin@example.com",
      id: "account-existing",
      status: "active",
    });
    const role = entity(Role, {
      id: "role-platform-existing",
      isSystem: true,
      name: options.existingAdmin ? "platform-admin" : "platform-viewer",
      scope: "platform",
      workspaceId: null,
    });
    store.accounts.push(account);
    store.roles.push(role);
    store.platformMemberships.push(entity(PlatformMembership, {
      accountId: account.id,
      id: "membership-platform-existing",
      role,
      roleId: role.id,
      status: "active",
    }));
  }
  if (options.existingWorkspace) {
    store.workspaces.push(entity(Workspace, {
      id: "workspace-existing",
      name: "Existing",
      slug: "existing",
      status: "active",
      subdomain: null,
    }));
  }

  const queries: Array<{ params?: unknown[]; sql: string }> = [];
  const manager = {
    create: <T>(target: new () => T, value: Partial<T>) => entity(target, value),
    delete: async (target: Function, where: Record<string, unknown>) => {
      const records = collection(store, target);
      const kept = records.filter((item) => !matches(item, where));
      records.splice(0, records.length, ...kept);
    },
    find: async (target: Function) => [...collection(store, target)],
    findOne: async (
      target: Function,
      options: { relations?: unknown; where?: Record<string, unknown> },
    ) => {
      const found = collection(store, target).find((item) =>
        matches(item, options.where ?? {}),
      ) ?? null;
      if (found && target === PlatformMembership) {
        found.role = store.roles.find((role) => role.id === found.roleId) ?? null;
      }
      return found;
    },
    getRepository: (target: Function) => ({
      count: async (options?: { where?: Record<string, unknown> }) =>
        collection(store, target).filter((item) =>
          matches(item, options?.where ?? {}),
        ).length,
    }),
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ params, sql });
      return [];
    },
    upsert: async (target: Function, values: any | any[]) => {
      const records = collection(store, target);
      const rows = Array.isArray(values) ? values : [values];
      for (const value of rows) {
        const existing = target === Permission && value.code
          ? records.find((item) => item.code === value.code)
          : records.find((item) => item.id === value.id);
        if (existing) {
          Object.assign(existing, value);
          continue;
        }
        value.id ??= `${target.name.toLowerCase()}-${nextId++}`;
        records.push(value);
      }
      return rows;
    },
    save: async (target: Function, value: any) => {
      if (Array.isArray(value)) {
        return Promise.all(value.map((item) => manager.save(target, item)));
      }
      value.id ??= `${target.name.toLowerCase()}-${nextId++}`;
      const records = collection(store, target);
      const index = records.findIndex((item) => item.id === value.id);
      if (index >= 0) records[index] = value;
      else records.push(value);
      return value;
    },
  };

  let transactionTail = Promise.resolve();
  const dataSource = {
    manager,
    transaction<T>(work: (transactionManager: typeof manager) => Promise<T>) {
      const run = transactionTail.then(async () => {
        const snapshot = cloneStore(store);
        const snapshotId = nextId;
        try {
          return await work(manager);
        } catch (error) {
          restoreStore(store, snapshot);
          nextId = snapshotId;
          throw error;
        }
      });
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const settings = {
    invalidationBatches: 0,
    savedInsideTransaction: false,
    applySettingsInvalidations: async () => {
      settings.invalidationBatches += 1;
    },
    savePlatformSettingsInTransaction: async (
      transactionManager: unknown,
      payload: unknown,
    ) => {
      assert.equal(transactionManager, manager);
      assert.ok(payload);
      settings.savedInsideTransaction = true;
      if (options.failSettings) throw new Error("settings failed");
      return [{ name: "platform.title" }];
    },
  };
  return {
    queries,
    service: new OnboardingService(dataSource as never, settings as never),
    settings,
    store,
  };
}

type Store = {
  accounts: any[];
  permissions: any[];
  platformMemberships: any[];
  rolePermissions: any[];
  roles: any[];
  workspaceMemberships: any[];
  workspaces: any[];
};

function collection(store: Store, target: Function): any[] {
  if (target === Account) return store.accounts;
  if (target === Permission) return store.permissions;
  if (target === PlatformMembership) return store.platformMemberships;
  if (target === Role) return store.roles;
  if (target === RolePermission) return store.rolePermissions;
  if (target === Workspace) return store.workspaces;
  if (target === WorkspaceMembership) return store.workspaceMemberships;
  throw new Error(`Unsupported entity: ${target.name}`);
}

function matches(value: Record<string, any>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => value[key] === expected);
}

function entity<T>(target: new () => T, value: Partial<T>) {
  return Object.assign(new target(), value);
}

function cloneStore(store: Store): Store {
  return Object.fromEntries(
    Object.entries(store).map(([key, records]) => [
      key,
      records.map((record) => Object.assign(
        Object.create(Object.getPrototypeOf(record)),
        record,
      )),
    ]),
  ) as Store;
}

function restoreStore(target: Store, source: Store) {
  for (const key of Object.keys(target) as Array<keyof Store>) {
    target[key].splice(0, target[key].length, ...source[key]);
  }
}
