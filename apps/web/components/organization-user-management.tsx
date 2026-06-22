"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import {
  buildMenuPermission,
  fetchAdmin,
  getTenantSnapshot,
} from "@/lib/admin-api";
import type {
  Organization,
  Role,
  TenantSnapshot,
  User,
} from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  hasMenuAccess,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession, UserSession } from "@/lib/session";

type PermissionDraft = Record<string, boolean>;

export function OrganizationUserManagement() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<TenantSnapshot | null>(null);
  const [storedSession, setStoredSession] = useState<UserSession | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedUserRoleId, setSelectedUserRoleId] = useState("");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>({});
  const [organizationName, setOrganizationName] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoleId, setUserRoleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canViewTenants = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "tenants",
  );
  const canViewOrganizations = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "organizations",
  );
  const canManageOrganizations = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "organizations",
    "manage",
  );
  const canViewUsers = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "users",
  );
  const canManageUsers = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "users",
    "manage",
  );
  const canViewRoles = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "roles",
  );
  const canViewPermissions = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "permissions",
  );
  const canManagePermissions = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "permissions",
    "manage",
  );
  const canViewSettings = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "settings",
  );

  const visibleOrganizations = useMemo(() => {
    if (!snapshot || !resolvedSession) {
      return [];
    }
    if (canManageOrganizations) {
      return snapshot.organizations;
    }

    const allowedOrganizationIds = new Set(
      snapshot.userOrganizations
        .filter(
          (membership) =>
            membership.userId === resolvedSession.user.id &&
            membership.isActive,
        )
        .map((membership) => membership.organizationId),
    );
    return snapshot.organizations.filter((organization) =>
      allowedOrganizationIds.has(organization.id),
    );
  }, [canManageOrganizations, resolvedSession, snapshot]);

  const usersInOrganization = useMemo(() => {
    if (!snapshot || !selectedOrganizationId) {
      return [];
    }

    const userIds = new Set(
      snapshot.userOrganizations
        .filter(
          (membership) =>
            membership.organizationId === selectedOrganizationId &&
            membership.isActive,
        )
        .map((membership) => membership.userId),
    );

    return snapshot.users.filter((user) => userIds.has(user.id));
  }, [selectedOrganizationId, snapshot]);

  const selectedOrganization = visibleOrganizations.find(
    (organization) => organization.id === selectedOrganizationId,
  );
  const selectedUser = usersInOrganization.find(
    (user) => user.id === selectedUserId,
  );
  const selectedRole = snapshot?.roles.find((role) => role.id === selectedRoleId);

  async function loadSnapshot() {
    setLoading(true);
    setError("");

    const session = getStoredSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    setStoredSession(session);

    try {
      const data = await getTenantSnapshot(session.token);
      const nextResolvedSession = resolveSession(data);

      setSnapshot(data);
      setResolvedSession(nextResolvedSession);
      setSelectedOrganizationId((current) => {
        const nextVisibleOrganizations = data.organizations.filter((organization) =>
          hasMenuAccess(data, nextResolvedSession, "organizations", "manage")
            ? true
            : data.userOrganizations.some(
                (membership) =>
                  membership.userId === nextResolvedSession.user.id &&
                  membership.organizationId === organization.id &&
                  membership.isActive,
              ),
        );
        return nextVisibleOrganizations.some(
          (organization) => organization.id === current,
        )
          ? current
          : nextResolvedSession.organization.id;
      });
      setSelectedRoleId((current) =>
        data.roles.some((role) => role.id === current)
          ? current
          : nextResolvedSession.role?.id ?? data.roles[0]?.id ?? "",
      );
      setUserRoleId((current) =>
        data.roles.some((role) => role.id === current)
          ? current
          : data.roles.find((role) => role.name === "member")?.id ??
            data.roles[0]?.id ??
            "",
      );
    } catch (loadError) {
      const message = getErrorMessage(loadError);
      if (message.includes("登录") || message.includes("401")) {
        clearStoredSession();
        router.replace("/login");
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSnapshot();
  }, []);

  useEffect(() => {
    if (!selectedOrganizationId) {
      setSelectedUserId("");
      return;
    }

    setSelectedUserId((current) =>
      usersInOrganization.some((user) => user.id === current)
        ? current
        : usersInOrganization[0]?.id ?? "",
    );
  }, [selectedOrganizationId, usersInOrganization]);

  useEffect(() => {
    setSelectedUserRoleId(selectedUser?.roleId ?? "");
  }, [selectedUser]);

  useEffect(() => {
    if (!snapshot || !selectedRoleId) {
      setPermissionDraft({});
      return;
    }

    const nextDraft: PermissionDraft = {};
    for (const menu of snapshot.menus) {
      for (const action of ["view", "manage"] as const) {
        const permissionName = buildMenuPermission(menu.code, action);
        nextDraft[permissionName] =
          snapshot.rolePermissions.find(
            (permission) =>
              permission.roleId === selectedRoleId &&
              permission.permission === permissionName,
          )?.enabled ?? false;
      }
    }
    setPermissionDraft(nextDraft);
  }, [selectedRoleId, snapshot]);

  function logout() {
    clearStoredSession();
    router.replace("/login");
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationName.trim() || !canManageOrganizations) {
      return;
    }

    await mutate("/organizations", {
      body: { name: organizationName },
      method: "POST",
      success: "组织已创建",
    });
    setOrganizationName("");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedOrganizationId ||
      !userName.trim() ||
      !userEmail.trim() ||
      !canManageUsers
    ) {
      return;
    }

    await mutate(`/organizations/${selectedOrganizationId}/users`, {
      body: {
        displayName: userName,
        email: userEmail,
        password: userPassword || undefined,
        roleId: userRoleId || undefined,
      },
      method: "POST",
      success: "用户已创建",
    });
    setUserName("");
    setUserEmail("");
    setUserPassword("");
  }

  async function toggleOrganizationStatus(organization: Organization) {
    if (!canManageOrganizations) {
      return;
    }

    await mutate(`/organizations/${organization.id}`, {
      body: {
        status: organization.status === "active" ? "suspended" : "active",
      },
      method: "PATCH",
      success: "组织状态已更新",
    });
  }

  async function toggleUserStatus(user: User) {
    if (!canManageUsers || !selectedOrganizationId) {
      return;
    }

    await mutate(`/organizations/${selectedOrganizationId}/users/${user.id}`, {
      body: { status: user.status === "active" ? "disabled" : "active" },
      method: "PATCH",
      success: "用户状态已更新",
    });
  }

  async function saveSelectedUserRole() {
    if (!selectedUser || !selectedOrganizationId || !canManageUsers) {
      return;
    }

    await mutate(`/organizations/${selectedOrganizationId}/users/${selectedUser.id}`, {
      body: { roleId: selectedUserRoleId || null },
      method: "PATCH",
      success: "用户角色已更新",
    });
  }

  function updatePermissionDraft(permission: string, enabled: boolean) {
    setPermissionDraft((current) => ({ ...current, [permission]: enabled }));
  }

  async function saveRolePermissions() {
    if (!snapshot || !selectedRoleId || !canManagePermissions) {
      return;
    }

    await mutate(`/roles/${selectedRoleId}/permissions`, {
      body: {
        permissions: snapshot.menus.flatMap((menu) =>
          (["view", "manage"] as const).map((action) => {
            const permission = buildMenuPermission(menu.code, action);
            return {
              enabled: permissionDraft[permission] ?? false,
              permission,
            };
          }),
        ),
      },
      method: "PUT",
      success: "角色权限已保存",
    });
  }

  async function mutate(
    path: string,
    options: {
      body: Record<string, unknown>;
      method: "PATCH" | "POST" | "PUT";
      success: string;
    },
  ) {
    setSaving(true);
    setNotice("");
    setError("");

    try {
      await fetchAdmin(path, {
        body: options.body,
        method: options.method,
        token: storedSession?.token,
      });
      setNotice(options.success);
      await loadSnapshot();
    } catch (mutationError) {
      setError(getErrorMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  const hasPageAccess =
    canViewTenants ||
    canViewOrganizations ||
    canViewUsers ||
    canViewRoles ||
    canViewPermissions ||
    canViewSettings;

  const tenant = snapshot?.currentUser.tenant;
  const roles = snapshot?.roles ?? [];
  const menus = snapshot?.menus ?? [];
  const settings = snapshot?.tenantSettings ?? [];

  return (
    <AppShell
      actions={
        <button className="sidebar-link-button" onClick={logout} type="button">
          退出
        </button>
      }
    >
      <section className="page-header">
        <div>
          <p className="eyebrow">Hermes Swarm</p>
          <h1>租户与用户基础设施</h1>
        </div>
      </section>

      <section className="console-status" aria-live="polite">
        <div>
          <strong>{tenant?.name ?? "未登录"}</strong>
          <span>
            {resolvedSession
              ? `${resolvedSession.organization.name} / ${resolvedSession.user.displayName}`
              : "未确认用户"}
          </span>
        </div>
        <div>
          {loading && <span className="status-pill neutral">加载中</span>}
          {notice && <span className="status-pill positive">{notice}</span>}
          {error && <span className="status-pill warning">{error}</span>}
        </div>
      </section>

      {!loading && !hasPageAccess && (
        <section className="panel empty-state">
          <p className="eyebrow">Access</p>
          <h2>无权限</h2>
        </section>
      )}

      {hasPageAccess && (
        <div className="tenant-console">
          <section className="admin-grid">
            {canViewTenants && (
              <div className="panel admin-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Tenant</p>
                    <h2>租户</h2>
                  </div>
                </div>
                <div className="session-detail">
                  <span>名称</span>
                  <strong>{tenant?.name ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>标识</span>
                  <strong>{tenant?.slug ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>状态</span>
                  <strong>{tenant?.status ?? "-"}</strong>
                </div>
              </div>
            )}

            {canViewOrganizations && (
              <div className="panel admin-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Organizations</p>
                    <h2>组织</h2>
                  </div>
                  <span className="count-badge">
                    {visibleOrganizations.length}
                  </span>
                </div>
                {canManageOrganizations && (
                  <form className="compact-form" onSubmit={createOrganization}>
                    <input
                      aria-label="组织名称"
                      onChange={(event) =>
                        setOrganizationName(event.target.value)
                      }
                      placeholder="组织名称"
                      value={organizationName}
                    />
                    <button
                      className="primary-action"
                      disabled={saving}
                      type="submit"
                    >
                      新建
                    </button>
                  </form>
                )}
                <div className="select-list">
                  {visibleOrganizations.map((organization) => (
                    <button
                      className={
                        organization.id === selectedOrganizationId
                          ? "select-card selected"
                          : "select-card"
                      }
                      key={organization.id}
                      onClick={() => setSelectedOrganizationId(organization.id)}
                      type="button"
                    >
                      <span>
                        <strong>{organization.name}</strong>
                        <small>{organization.slug}</small>
                      </span>
                      <em className={organization.status}>
                        {organization.status}
                      </em>
                    </button>
                  ))}
                </div>
                {selectedOrganization && canManageOrganizations && (
                  <button
                    className="text-button full-width"
                    disabled={saving}
                    onClick={() => toggleOrganizationStatus(selectedOrganization)}
                    type="button"
                  >
                    {selectedOrganization.status === "active"
                      ? "暂停组织"
                      : "启用组织"}
                  </button>
                )}
              </div>
            )}

            {canViewUsers && (
              <div className="panel admin-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Users</p>
                    <h2>用户</h2>
                  </div>
                  <span className="count-badge">{usersInOrganization.length}</span>
                </div>
                {canManageUsers && (
                  <form className="stack-form" onSubmit={createUser}>
                    <input
                      aria-label="用户名称"
                      onChange={(event) => setUserName(event.target.value)}
                      placeholder="用户名称"
                      value={userName}
                    />
                    <input
                      aria-label="邮箱"
                      onChange={(event) => setUserEmail(event.target.value)}
                      placeholder="user@example.com"
                      type="email"
                      value={userEmail}
                    />
                    <input
                      aria-label="初始密码"
                      onChange={(event) => setUserPassword(event.target.value)}
                      placeholder="初始密码，留空使用默认值"
                      type="password"
                      value={userPassword}
                    />
                    <select
                      aria-label="用户角色"
                      onChange={(event) => setUserRoleId(event.target.value)}
                      value={userRoleId}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary-action"
                      disabled={!selectedOrganizationId || saving}
                      type="submit"
                    >
                      新建用户
                    </button>
                  </form>
                )}
                <div className="select-list">
                  {usersInOrganization.map((user) => (
                    <button
                      className={
                        user.id === selectedUserId
                          ? "select-card selected"
                          : "select-card"
                      }
                      key={user.id}
                      onClick={() => setSelectedUserId(user.id)}
                      type="button"
                    >
                      <span>
                        <strong>{user.displayName}</strong>
                        <small>
                          {user.email} / {getRoleLabel(roles, user.roleId)}
                        </small>
                      </span>
                      <em className={user.status}>{user.status}</em>
                    </button>
                  ))}
                </div>
                {selectedUser && canManageUsers && (
                  <div className="stack-form">
                    <select
                      aria-label="调整用户角色"
                      onChange={(event) =>
                        setSelectedUserRoleId(event.target.value)
                      }
                      value={selectedUserRoleId}
                    >
                      <option value="">无角色</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-button full-width"
                      disabled={saving}
                      onClick={saveSelectedUserRole}
                      type="button"
                    >
                      保存角色
                    </button>
                    <button
                      className="text-button full-width"
                      disabled={saving}
                      onClick={() => toggleUserStatus(selectedUser)}
                      type="button"
                    >
                      {selectedUser.status === "active" ? "停用用户" : "启用用户"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {(canViewRoles || canViewPermissions || canViewSettings) && (
            <section className="admin-grid secondary-grid">
              {canViewRoles && (
                <div className="panel admin-panel session-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Roles</p>
                      <h2>角色</h2>
                    </div>
                    <span className="count-badge">{roles.length}</span>
                  </div>
                  <div className="select-list">
                    {roles.map((role) => (
                      <button
                        className={
                          role.id === selectedRoleId
                            ? "select-card selected"
                            : "select-card"
                        }
                        key={role.id}
                        onClick={() => setSelectedRoleId(role.id)}
                        type="button"
                      >
                        <span>
                          <strong>{role.label}</strong>
                          <small>{role.name}</small>
                        </span>
                        <em className={role.isSystem ? "active" : "disabled"}>
                          {role.isSystem ? "system" : "custom"}
                        </em>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {canViewSettings && (
                <div className="panel admin-panel session-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Settings</p>
                      <h2>系统配置</h2>
                    </div>
                    <span className="count-badge">{settings.length}</span>
                  </div>
                  <div className="settings-list">
                    {settings.map((setting) => (
                      <div className="session-detail" key={setting.id}>
                        <span>{setting.name}</span>
                        <strong>{setting.value ?? "-"}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="panel admin-panel session-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Session</p>
                    <h2>当前身份</h2>
                  </div>
                </div>
                <div className="session-detail">
                  <span>组织</span>
                  <strong>{resolvedSession?.organization.name ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>用户</span>
                  <strong>{resolvedSession?.user.email ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>角色</span>
                  <strong>{resolvedSession?.role?.label ?? "-"}</strong>
                </div>
                <button
                  className="text-button full-width"
                  onClick={logout}
                  type="button"
                >
                  退出登录
                </button>
              </div>
            </section>
          )}

          {canViewPermissions && (
            <section className="panel permission-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Permissions</p>
                  <h2>角色权限{selectedRole ? ` / ${selectedRole.label}` : ""}</h2>
                </div>
                {canManagePermissions && (
                  <button
                    className="primary-action"
                    disabled={!selectedRoleId || saving}
                    onClick={saveRolePermissions}
                    type="button"
                  >
                    保存权限
                  </button>
                )}
              </div>
              <div className="permission-grid" role="table" aria-label="角色权限">
                <div className="permission-head" role="row">
                  <span>菜单</span>
                  <span>路径</span>
                  <span>查看</span>
                  <span>管理</span>
                </div>
                {menus.map((menu) => {
                  const viewPermission = buildMenuPermission(menu.code, "view");
                  const managePermission = buildMenuPermission(
                    menu.code,
                    "manage",
                  );

                  return (
                    <div className="permission-row" key={menu.id} role="row">
                      <span>
                        <strong>{menu.label}</strong>
                        <small>{menu.code}</small>
                      </span>
                      <span>{menu.path}</span>
                      <label>
                        <input
                          checked={permissionDraft[viewPermission] ?? false}
                          disabled={!canManagePermissions || !selectedRoleId}
                          onChange={(event) =>
                            updatePermissionDraft(
                              viewPermission,
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                        />
                      </label>
                      <label>
                        <input
                          checked={permissionDraft[managePermission] ?? false}
                          disabled={!canManagePermissions || !selectedRoleId}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            updatePermissionDraft(managePermission, checked);
                            if (checked) {
                              updatePermissionDraft(viewPermission, true);
                            }
                          }}
                          type="checkbox"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

function getRoleLabel(roles: Role[], roleId: string | null) {
  return roles.find((role) => role.id === roleId)?.label ?? "无角色";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

function snapshotOrEmpty(snapshot: TenantSnapshot | null): TenantSnapshot {
  if (snapshot) {
    return snapshot;
  }

  return {
    currentUser: {
      membership: {
        id: "",
        isActive: false,
        isDefault: false,
        organizationId: "",
        preferences: null,
        tenantId: "",
        userId: "",
      },
      organization: {
        id: "",
        isDefault: false,
        name: "",
        slug: "",
        status: "suspended",
        tenantId: "",
      },
      permissions: [],
      role: null,
      tenant: {
        id: "",
        name: "",
        slug: "",
        status: "suspended",
        subdomain: null,
      },
      user: {
        displayName: "",
        email: "",
        firstName: null,
        id: "",
        lastName: null,
        roleId: null,
        status: "disabled",
        tenantId: "",
        type: "user",
        username: null,
      },
    },
    menus: [],
    organizations: [],
    rolePermissions: [],
    roles: [],
    tenantSettings: [],
    tenants: [],
    userOrganizations: [],
    users: [],
  };
}
