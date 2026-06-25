"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import type {
  AppShellNavItem,
  AppShellNavSection,
} from "@/components/app-shell";
import { UserAvatar } from "@/components/user-avatar";
import {
  buildMenuPermission,
  fetchAdmin,
  getSnapshot,
} from "@/lib/admin-api";
import type {
  Organization,
  Menu,
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

const ORGANIZATION_MENU_CODES = new Set(["organizations", "users"]);
const SYSTEM_MENU_CODES = new Set(["roles", "menus", "permissions", "settings"]);
const MENU_SECTION_IDS: Record<string, string> = {
  menus: "menus",
  organizations: "organizations",
  permissions: "permissions",
  roles: "roles",
  settings: "settings",
  users: "users",
};
const SYSTEM_ADMIN_ROLES = new Set(["admin", "owner"]);

export function OrganizationUserManagement() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [storedSession, setStoredSession] = useState<UserSession | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedUserRoleId, setSelectedUserRoleId] = useState("");
  const [activeMenuCode, setActiveMenuCode] = useState("organizations");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>({});
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatarUrl, setUserAvatarUrl] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoleId, setUserRoleId] = useState("");
  const [selectedUserAvatarUrl, setSelectedUserAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canViewOrganizations = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "organizations",
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
  const canViewMenus = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "menus",
  );
  const canManageMenus = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "menus",
    "manage",
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
    setSelectedUserAvatarUrl(selectedUser?.imageUrl ?? "");
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
        imageUrl: userAvatarUrl || null,
        password: userPassword || undefined,
        roleId: userRoleId || undefined,
      },
      method: "POST",
      success: "用户已创建",
    });
    setUserName("");
    setUserEmail("");
    setUserAvatarUrl("");
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
      body: {
        imageUrl: selectedUserAvatarUrl || null,
        roleId: selectedUserRoleId || null,
      },
      method: "PATCH",
      success: "用户信息已更新",
    });
  }

  async function toggleMenuActive(menu: Menu) {
    if (!canManageMenus) return;

    await mutate(`/menus/${menu.id}`, {
      body: { isActive: !menu.isActive },
      method: "PATCH",
      success: menu.isActive ? "菜单已隐藏" : "菜单已显示",
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
    canViewMenus ||
    canViewPermissions ||
    canViewSettings;

  const organization = snapshot?.organization ?? resolvedSession?.organization;
  const roles = snapshot?.roles ?? [];
  const menus = snapshot?.menus ?? [];
  const settings = snapshot?.settings ?? [];
  const isSystemAdministrator = SYSTEM_ADMIN_ROLES.has(
    resolvedSession?.role?.name ?? "",
  );
  const navSections = buildNavSections({
    isSystemAdministrator,
    menus,
    resolvedSession,
    snapshot: snapshotOrEmpty(snapshot),
  });
  const navItems = navSections.flatMap((section) => section.items);
  const navItemKeys = navItems.map((item) => item.key).join("|");
  const activeMenu = navItems.find((item) => item.key === activeMenuCode);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialCode = getMenuCodeFromHash(window.location.hash);
    if (initialCode) {
      setActiveMenuCode(initialCode);
    }
  }, []);

  useEffect(() => {
    if (navItems.length === 0) return;
    if (navItems.some((item) => item.key === activeMenuCode)) return;
    setActiveMenuCode(navItems[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navItemKeys, activeMenuCode]);

  function navigateToMenu(item: AppShellNavItem) {
    setActiveMenuCode(item.key);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", item.href);
    }
  }

  return (
    <AppShell
      actions={
        <button className="sidebar-link-button" onClick={logout} type="button">
          退出
        </button>
      }
      activeItem={activeMenuCode}
      navSections={navSections}
      onNavigate={navigateToMenu}
      organizationName={organization?.name}
      roleLabel={resolvedSession?.role?.label}
      user={resolvedSession?.user}
    >
      <section className="page-header">
        <div>
          <p className="eyebrow">Hermes Swarm</p>
          <h1>{activeMenu?.label ?? "组织与用户管理"}</h1>
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
          {["organizations", "users"].includes(activeMenuCode) && (
            <section className="admin-grid active-grid">
              {canViewOrganizations && activeMenuCode === "organizations" && (
              <div className="panel admin-panel" id="organizations">
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

              {canViewUsers && activeMenuCode === "users" && (
              <div className="panel admin-panel users-panel" id="users">
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
                      aria-label="头像 URL"
                      onChange={(event) => setUserAvatarUrl(event.target.value)}
                      placeholder="头像 URL，可留空"
                      value={userAvatarUrl}
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
                      <span className="select-card-main">
                        <UserAvatar size="sm" user={user} />
                        <span>
                          <strong>{user.displayName}</strong>
                          <small>
                            {user.email} / {getRoleLabel(roles, user.roleId)}
                          </small>
                        </span>
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
                    <input
                      aria-label="调整用户头像 URL"
                      onChange={(event) =>
                        setSelectedUserAvatarUrl(event.target.value)
                      }
                      placeholder="头像 URL，可留空"
                      value={selectedUserAvatarUrl}
                    />
                    <button
                      className="text-button full-width"
                      disabled={saving}
                      onClick={saveSelectedUserRole}
                      type="button"
                    >
                      保存用户
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
          )}

          {["roles", "menus", "settings"].includes(activeMenuCode) && (
            <section className="admin-grid active-grid secondary-grid">
              {canViewRoles && activeMenuCode === "roles" && (
                <div className="panel admin-panel session-panel" id="roles">
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

              {canViewMenus && activeMenuCode === "menus" && (
                <div className="panel admin-panel session-panel" id="menus">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Menus</p>
                      <h2>菜单</h2>
                    </div>
                    <span className="count-badge">{menus.length}</span>
                  </div>
                  <div className="menu-list">
                    {menus.map((menu) => (
                      <div className="menu-row" key={menu.id}>
                        <span>
                          <strong>{menu.label}</strong>
                          <small>
                            {menu.code} / {menu.path}
                          </small>
                        </span>
                        {canManageMenus ? (
                          <button
                            className="text-button"
                            disabled={saving}
                            onClick={() => toggleMenuActive(menu)}
                            type="button"
                          >
                            {menu.isActive ? "隐藏" : "显示"}
                          </button>
                        ) : (
                          <em className={menu.isActive ? "active" : "disabled"}>
                            {menu.isActive ? "visible" : "hidden"}
                          </em>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canViewSettings && activeMenuCode === "settings" && (
                <div className="panel admin-panel session-panel" id="settings">
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
                <div className="identity-card">
                  <UserAvatar size="lg" user={resolvedSession?.user} />
                  <div>
                    <strong>{resolvedSession?.user.displayName ?? "-"}</strong>
                    <span>{resolvedSession?.user.email ?? "-"}</span>
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

          {canViewPermissions && activeMenuCode === "permissions" && (
            <section className="panel permission-panel" id="permissions">
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

          {activeMenu &&
            ![
              "menus",
              "organizations",
              "permissions",
              "roles",
              "settings",
              "users",
            ].includes(activeMenu.key) && (
              <section className="panel empty-state">
                <p className="eyebrow">Menu</p>
                <h2>{activeMenu.label}</h2>
                <p>该菜单已按权限显示，但还没有绑定 React 前端视图。</p>
              </section>
            )}
        </div>
      )}
    </AppShell>
  );
}

function buildNavSections({
  isSystemAdministrator,
  menus,
  resolvedSession,
  snapshot,
}: {
  isSystemAdministrator: boolean;
  menus: Menu[];
  resolvedSession: ResolvedSession | null;
  snapshot: Snapshot;
}) {
  const visibleMenus = menus
    .filter(
      (menu) =>
        menu.isActive && hasMenuAccess(snapshot, resolvedSession, menu.code),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const organizationItems = visibleMenus
    .filter((menu) => ORGANIZATION_MENU_CODES.has(menu.code))
    .map(toNavItem);
  const systemItems = visibleMenus
    .filter((menu) => SYSTEM_MENU_CODES.has(menu.code))
    .map(toNavItem);
  const extensionItems = visibleMenus
    .filter(
      (menu) =>
        !ORGANIZATION_MENU_CODES.has(menu.code) &&
        !SYSTEM_MENU_CODES.has(menu.code),
    )
    .map(toNavItem);

  const sections: AppShellNavSection[] = [];

  if (organizationItems.length > 0) {
    sections.push({
      items: organizationItems,
      key: "organization",
      label: "组织工作台",
    });
  }

  if (systemItems.length > 0) {
    sections.push({
      badge: isSystemAdministrator ? "Admin" : undefined,
      items: systemItems,
      key: "system",
      label: "系统管理",
    });
  }

  if (extensionItems.length > 0) {
    sections.push({
      items: extensionItems,
      key: "extensions",
      label: "扩展入口",
    });
  }

  return sections;
}

function toNavItem(menu: Menu) {
  return {
    href: buildMenuHref(menu),
    key: menu.code,
    label: menu.label,
  };
}

function buildMenuHref(menu: Menu) {
  const basePath = menu.path || "/organizations";
  if (basePath !== "/organizations") {
    return basePath;
  }

  return `${basePath}#${MENU_SECTION_IDS[menu.code] ?? menu.code}`;
}

function getMenuCodeFromHash(hash: string) {
  const sectionId = hash.replace(/^#/, "");
  return (
    Object.entries(MENU_SECTION_IDS).find(([, value]) => value === sectionId)?.[0] ??
    ""
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
