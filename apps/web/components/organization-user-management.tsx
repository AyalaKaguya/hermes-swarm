"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import {
  buildMenuPermission,
  fetchAdmin,
  getSnapshot,
} from "@/lib/admin-api";
import type {
  Organization,
  Role,
  Snapshot,
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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [storedSession, setStoredSession] = useState<UserSession | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedUserRoleId, setSelectedUserRoleId] = useState("");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>({});
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoleId, setUserRoleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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

  const usersInOrganization = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.users.filter(
      (user) => user.organizationId === resolvedSession?.organization.id,
    );
  }, [snapshot, resolvedSession]);

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
      const data = await getSnapshot(session.token);
      const nextResolvedSession = resolveSession(data);

      setSnapshot(data);
      setResolvedSession(nextResolvedSession);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedUserId((current) =>
      usersInOrganization.some((user) => user.id === current)
        ? current
        : usersInOrganization[0]?.id ?? "",
    );
  }, [usersInOrganization]);

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

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userName.trim() || !userEmail.trim() || !canManageUsers) return;

    await mutate("/users", {
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

  async function toggleUserStatus(user: User) {
    if (!canManageUsers) return;

    await mutate(`/users/${user.id}`, {
      body: { status: user.status === "active" ? "disabled" : "active" },
      method: "PATCH",
      success: "用户状态已更新",
    });
  }

  async function saveSelectedUserRole() {
    if (!selectedUser || !canManageUsers) return;

    await mutate(`/users/${selectedUser.id}`, {
      body: { roleId: selectedUserRoleId || null },
      method: "PATCH",
      success: "用户角色已更新",
    });
  }

  function updatePermissionDraft(permission: string, enabled: boolean) {
    setPermissionDraft((current) => ({ ...current, [permission]: enabled }));
  }

  async function saveRolePermissions() {
    if (!snapshot || !selectedRoleId || !canManagePermissions) return;

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
    canViewOrganizations ||
    canViewUsers ||
    canViewRoles ||
    canViewPermissions ||
    canViewSettings;

  const organization = snapshot?.organization ?? resolvedSession?.organization;
  const roles = snapshot?.roles ?? [];
  const menus = snapshot?.menus ?? [];
  const settings = snapshot?.settings ?? [];

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
          <h1>组织与用户管理</h1>
        </div>
      </section>

      <section className="console-status" aria-live="polite">
        <div>
          <strong>{organization?.name ?? "未登录"}</strong>
          <span>
            {resolvedSession
              ? `${resolvedSession.user.displayName}`
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
            {canViewOrganizations && (
              <div className="panel admin-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Organization</p>
                    <h2>组织</h2>
                  </div>
                </div>
                <div className="session-detail">
                  <span>名称</span>
                  <strong>{organization?.name ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>标识</span>
                  <strong>{organization?.slug ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>状态</span>
                  <strong>{organization?.status ?? "-"}</strong>
                </div>
                <div className="session-detail">
                  <span>子域名</span>
                  <strong>{organization?.subdomain ?? "-"}</strong>
                </div>
              </div>
            )}

            {canViewUsers && (
              <div className="panel admin-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Users</p>
                    <h2>用户</h2>
                  </div>
                  <span className="count-badge">
                    {usersInOrganization.length}
                  </span>
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
                      disabled={saving}
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

          {(canViewRoles || canViewSettings) && (
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
                  <h2>
                    角色权限{selectedRole ? ` / ${selectedRole.label}` : ""}
                  </h2>
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

function snapshotOrEmpty(snapshot: Snapshot | null): Snapshot {
  if (snapshot) return snapshot;

  return {
    currentUser: {
      organization: {
        id: "",
        name: "",
        slug: "",
        status: "suspended",
        subdomain: null,
      },
      permissions: [],
      role: null,
      user: {
        id: "",
        displayName: "",
        email: "",
        firstName: null,
        lastName: null,
        username: null,
        mobile: null,
        imageUrl: null,
        preferredLanguage: "zh-CN",
        emailVerified: false,
        timeZone: null,
        roleId: null,
        status: "disabled",
        organizationId: null,
        type: "user",
        createdAt: "",
        updatedAt: "",
      },
    },
    menus: [],
    organization: {
      id: "",
      name: "",
      slug: "",
      status: "suspended",
      subdomain: null,
    },
    organizations: [],
    rolePermissions: [],
    roles: [],
    settings: [],
    users: [],
  };
}
