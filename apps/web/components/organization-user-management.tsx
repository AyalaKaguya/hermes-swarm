"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import { AppShell } from "@/components/app-shell";
import type { AppShellNavItem, AppShellNavSection } from "@/components/app-shell";
import { deleteInvite, getInvites, getSnapshot, resendInvite } from "@/lib/admin-api";
import type { Invite, Role, Snapshot, User } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";

const NAV_SECTIONS: AppShellNavSection[] = [
  {
    key: "system",
    label: "系统管理",
    items: [
      { href: "/organizations", icon: "building", key: "organizations", label: "组织管理" },
      { href: "/organizations", icon: "users", key: "users", label: "用户管理" },
      { href: "/organizations", icon: "users", key: "roles", label: "角色管理" },
      { href: "/organizations", icon: "invite", key: "invites", label: "邀请管理" },
      { href: "/organizations", icon: "switch", key: "permissions", label: "权限配置" },
      { href: "/organizations", icon: "settings", key: "settings", label: "系统配置" },
    ],
  },
];

export function OrganizationUserManagement() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [activeTab, setActiveTab] = useState<"users" | "invites" | "applications">("users");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState<string | null>(null);

  useEffect(() => {
    async function loadSnapshot() {
      setLoading(true);
      setError("");

      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setSessionToken(session.token);

      try {
        const [data, inviteItems] = await Promise.all([
          getSnapshot(session.token),
          getInvites(session.token),
        ]);
        const nextResolvedSession = resolveSession(data);
        setSnapshot(data);
        setInvites(inviteItems);
        setResolvedSession(nextResolvedSession);
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

    void loadSnapshot();
  }, [router]);

  const organization = snapshot?.organization ?? resolvedSession?.organization;
  const roles = snapshot?.roles ?? [];
  const allUsers = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.users.filter(
      (user) => user.organizationId === resolvedSession?.organization.id,
    );
  }, [resolvedSession?.organization.id, snapshot]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allUsers.filter((user) => {
      const role = roles.find((item) => item.id === user.roleId);
      if (roleFilter && role?.name !== roleFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        user.displayName,
        user.email,
        user.username,
        user.firstName,
        user.lastName,
        role?.label,
        role?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [allUsers, roleFilter, roles, search]);

  useEffect(() => {
    if (!filteredUsers.length) {
      setSelectedUserId("");
      return;
    }

    setSelectedUserId((current) =>
      filteredUsers.some((user) => user.id === current)
        ? current
        : filteredUsers[0]?.id ?? "",
    );
  }, [filteredUsers]);

  const navSections = NAV_SECTIONS;

  function logout() {
    clearStoredSession();
    router.replace("/login");
  }

  function navigateToMenu(item: AppShellNavItem) {
    const tabMap: Record<string, typeof activeTab> = {
      users: "users",
      invites: "invites",
      applications: "applications",
    };
    const tab = tabMap[item.key];
    if (tab) {
      setActiveTab(tab);
    }

    if (item.key === "roles" || item.key === "settings" || item.key === "permissions" || item.key === "organizations") {
      window.history.replaceState(null, "", item.href);
    }
  }

  async function handleResendInvite(inviteId: string) {
    if (!sessionToken) return;
    setError("");
    try {
      const updatedInvite = await resendInvite(sessionToken, inviteId);
      setInvites((current) =>
        current.map((invite) => (invite.id === inviteId ? updatedInvite : invite)),
      );
    } catch (inviteError) {
      setError(getErrorMessage(inviteError));
    }
  }

  async function handleDeleteInvite(inviteId: string, email: string) {
    if (!sessionToken) return;
    if (!window.confirm("删除 " + email + " 的邀请？")) return;
    setError("");
    try {
      await deleteInvite(sessionToken, inviteId);
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
    } catch (inviteError) {
      setError(getErrorMessage(inviteError));
    }
  }

  return (
    <AppShell
      actions={
        <button className="sidebar-link-button" onClick={logout} type="button">
          退出
        </button>
      }
      activeItem="users"
      navSections={navSections}
      onNavigate={navigateToMenu}
      organizationName={organization?.name}
      roleLabel={resolvedSession?.role?.label}
      user={resolvedSession?.user}
    >
      <section className="page-shell">
        <header className="page-header page-header-stacked">
          <div>
            <h1>管理用户</h1>
          </div>
          <button className="header-invite-button" type="button">
            <AppIcon name="invite" />
            <span>邀请</span>
          </button>
        </header>

        <div className="tab-strip" role="tablist" aria-label="用户管理页签">
          <button
            className={activeTab === "users" ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab("users")}
            type="button"
          >
            <AppIcon name="users" />
            <span>用户列表</span>
          </button>
          <button
            className={activeTab === "invites" ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab("invites")}
            type="button"
          >
            <AppIcon name="invite" />
            <span>邀请列表</span>
          </button>
          <button
            className={activeTab === "applications" ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab("applications")}
            type="button"
          >
            <AppIcon name="file" />
            <span>申请列表</span>
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {loading && <div className="page-empty">加载中</div>}

        {!loading && activeTab === "users" && (
          <>
            <div className="toolbar-row">
              <div className="toolbar-actions">
                <button className="btn-primary" type="button">
                  <AppIcon name="add" />
                  <span>添加用户</span>
                </button>
                <button className="btn-secondary" type="button">
                  <AppIcon name="invite" />
                  <span>邀请</span>
                </button>
                <button className="btn-secondary" type="button">
                  <AppIcon name="import" />
                  <span>导入</span>
                </button>
              </div>
              <div className="toolbar-right">
                <label className="search-field">
                  <AppIcon name="search" />
                  <input
                    aria-label="搜索"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索"
                    value={search}
                  />
                </label>
                <label className="role-filter">
                  <span>角色:</span>
                  <select
                    aria-label="选择角色"
                    onChange={(event) => setRoleFilter(event.target.value)}
                    value={roleFilter}
                  >
                    <option value="">选择角色</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.name}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <section className="user-grid user-grid-rows">
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className={user.id === selectedUserId ? "user-card-row active" : "user-card-row"}
                  onClick={() => setSelectedUserId(user.id)}
                >
                  <UserCardRow
                    role={getRoleById(roles, user.roleId)}
                    user={user}
                    menuOpen={userMenuOpen === user.id}
                    onToggleMenu={() => setUserMenuOpen(userMenuOpen === user.id ? null : user.id)}
                  />
                </div>
              ))}
              {!filteredUsers.length && <div className="page-empty">暂无用户</div>}
            </section>
          </>
        )}

        {!loading && activeTab === "invites" && (
          <InviteTable
            invites={invites}
            onDelete={handleDeleteInvite}
            onResend={handleResendInvite}
            roles={roles}
            users={snapshot?.users ?? []}
          />
        )}

        {!loading && activeTab === "applications" && (
          <div className="page-empty">暂无申请</div>
        )}

      </section>
    </AppShell>
  );
}

function InviteTable({
  invites,
  onDelete,
  onResend,
  roles,
  users,
}: {
  invites: Invite[];
  onDelete: (inviteId: string, email: string) => void;
  onResend: (inviteId: string) => void;
  roles: Role[];
  users: User[];
}) {
  if (!invites.length) {
    return <div className="page-empty">暂无邀请</div>;
  }

  return (
    <section className="invite-table-wrap" aria-label="邀请列表">
      <table className="invite-table">
        <thead>
          <tr>
            <th>邮箱</th>
            <th>角色</th>
            <th>邀请人</th>
            <th>创建时间</th>
            <th>过期时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {invites.map((invite) => {
            const role = getRoleById(roles, invite.roleId);
            const invitedBy = users.find((user) => user.id === invite.invitedById) ?? null;
            return (
              <tr key={invite.id}>
                <td>{invite.email}</td>
                <td>{role?.name ?? "无角色"}</td>
                <td>
                  {invitedBy ? (
                    <span className="invite-user-inline">
                      <span className="user-card-avatar" aria-hidden="true">
                        <AppIcon name="user" />
                        <span className="user-status-dot" aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{invitedBy.displayName}</strong>
                        <small>{invitedBy.email}</small>
                      </span>
                    </span>
                  ) : (
                    "系统"
                  )}
                </td>
                <td>{formatDate(invite.createdAt)}</td>
                <td>{formatDate(invite.expireDate) || "永不过期"}</td>
                <td>
                  <span className={"invite-status invite-status-" + invite.status}>
                    <span aria-hidden="true" />
                    {inviteStatusText(invite.status)}
                  </span>
                </td>
                <td>
                  <div className="invite-actions">
                    <button onClick={() => onResend(invite.id)} title="重新发送" type="button">
                      <AppIcon name="refresh" />
                    </button>
                    <button onClick={() => onDelete(invite.id, invite.email)} title="删除" type="button">
                      <AppIcon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function UserCardRow({
  role,
  user,
  menuOpen,
  onToggleMenu,
}: {
  role: Role | null;
  user: User;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  return (
    <div className="user-card-row-inner">
      <div className="user-card-person">
        <span className="user-card-avatar" aria-hidden="true">
          <AppIcon name="user" />
          <span className="user-status-dot" aria-hidden="true" />
        </span>
        <div className="user-card-body">
          <strong>{user.displayName}</strong>
          <span>{user.email}</span>
        </div>
      </div>
      <div className="user-card-role">
        <span className={"role-badge " + roleBadgeClass(role?.name)}>
          {role?.label ?? "无角色"}
        </span>
      </div>
      <div className="user-card-actions">
        <button
          className="user-card-menu-trigger"
          onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
          type="button"
        >
          <AppIcon name="more" />
        </button>
        {menuOpen && (
          <>
            <div className="user-card-menu-overlay" onClick={(e) => { e.stopPropagation(); onToggleMenu(); }} />
            <div className="user-card-menu">
              <button type="button" className="user-card-menu-item" onClick={(e) => e.stopPropagation()}>
                <AppIcon name="pencil" />
                <span>编辑</span>
              </button>
              <button type="button" className="user-card-menu-item danger" onClick={(e) => e.stopPropagation()}>
                <AppIcon name="trash" />
                <span>删除</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function roleBadgeClass(roleName: string | undefined | null): string {
  if (!roleName) return "role-badge-none";
  if (roleName === "super_admin") return "role-badge-super";
  if (roleName === "admin") return "role-badge-admin";
  if (roleName === "viewer") return "role-badge-viewer";
  return "role-badge-default";
}

function getRoleById(roles: Role[], roleId: string | null) {
  return roles.find((role) => role.id === roleId) ?? null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function inviteStatusText(status: Invite["status"]) {
  const labels: Record<Invite["status"], string> = {
    accepted: "已接受",
    expired: "已过期",
    invited: "已邀请",
    revoked: "已撤销",
  };
  return labels[status] ?? status;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
