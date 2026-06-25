"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppIcon } from "@/components/app-icon";
import type { AppIconName } from "@/components/app-icon";
import { AppShell } from "@/components/app-shell";
import type { AppShellNavItem, AppShellNavSection } from "@/components/app-shell";
import { getSnapshot } from "@/lib/admin-api";
import type { Role, Snapshot, User } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  hasMenuAccess,
  resolveSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";

const MENU_LABELS: Record<string, string> = {
  organizations: "组织",
  permissions: "功能",
  roles: "用户组",
  settings: "系统配置",
  users: "用户",
};

const MENU_ICONS: Record<string, AppIconName> = {
  organizations: "building",
  permissions: "switch",
  roles: "users",
  settings: "settings",
  users: "users",
};

const ORGANIZATION_MENU_CODES = new Set(["organizations", "users"]);
const SYSTEM_MENU_CODES = new Set(["roles", "permissions", "settings"]);

export function OrganizationUserManagement() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [activeTab, setActiveTab] = useState<"users" | "invites">("users");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
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
  const canViewSettings = hasMenuAccess(
    snapshotOrEmpty(snapshot),
    resolvedSession,
    "settings",
  );

  useEffect(() => {
    async function loadSnapshot() {
      setLoading(true);
      setError("");

      const session = getStoredSession();
      if (!session) {
        router.replace("/login");
        return;
      }

      try {
        const data = await getSnapshot(session.token);
        const nextResolvedSession = resolveSession(data);
        setSnapshot(data);
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

  const navSections = buildNavSections({
    canViewOrganizations,
    canViewPermissions,
    canViewRoles,
    canViewSettings,
    canViewUsers,
    organization,
    resolvedSession,
    snapshot: snapshotOrEmpty(snapshot),
  });

  function logout() {
    clearStoredSession();
    router.replace("/login");
  }

  function navigateToMenu(item: AppShellNavItem) {
    if (item.key === "users") {
      setActiveTab("users");
    }

    if (item.key === "roles" || item.key === "settings" || item.key === "permissions") {
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
            <span>用户</span>
          </button>
          <button
            className={activeTab === "invites" ? "tab-button active" : "tab-button"}
            onClick={() => setActiveTab("invites")}
            type="button"
          >
            <AppIcon name="invite" />
            <span>邀请</span>
          </button>
        </div>

        <div className="toolbar-row">
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

        {error && <div className="form-error">{error}</div>}

        {loading && <div className="page-empty">加载中</div>}

        {!loading && activeTab === "users" && (
          <section className="user-grid">
            {filteredUsers.map((user) => (
              <button
                className={user.id === selectedUserId ? "user-card active" : "user-card"}
                key={user.id}
                onClick={() => setSelectedUserId(user.id)}
                type="button"
              >
                <UserCard user={user} role={getRoleById(roles, user.roleId)} />
              </button>
            ))}
            {!filteredUsers.length && <div className="page-empty">暂无用户</div>}
          </section>
        )}

        {!loading && activeTab === "invites" && (
          <section className="invite-placeholder">
            <div className="page-empty">邀请列表暂未接入 React</div>
          </section>
        )}

      </section>
    </AppShell>
  );
}

function UserCard({ user, role }: { user: User; role: Role | null }) {
  return (
    <>
      <div className="user-card-header">
        <span className="user-card-avatar" aria-hidden="true">
          <AppIcon name="user" />
        </span>
        <span className="user-status-dot" aria-hidden="true" />
      </div>
      <div className="user-card-body">
        <strong>{user.displayName}</strong>
        <span>{user.email}</span>
      </div>
      <div className="user-card-role">
        <span>角色:</span>
        <em>{role?.name === "super_admin" ? "SUPER ADMIN" : role?.label ?? "无角色"}</em>
      </div>
    </>
  );
}

function buildNavSections({
  canViewOrganizations,
  canViewPermissions,
  canViewRoles,
  canViewSettings,
  canViewUsers,
  organization,
  resolvedSession,
  snapshot,
}: {
  canViewOrganizations: boolean;
  canViewPermissions: boolean;
  canViewRoles: boolean;
  canViewSettings: boolean;
  canViewUsers: boolean;
  organization: Snapshot["organization"] | ResolvedSession["organization"] | undefined;
  resolvedSession: ResolvedSession | null;
  snapshot: Snapshot;
}) {
  const sections: AppShellNavSection[] = [];
  const organizationItems: AppShellNavItem[] = [];
  const systemItems: AppShellNavItem[] = [];

  for (const menu of snapshot.menus) {
    if (!menu.isActive || !hasMenuAccess(snapshot, resolvedSession, menu.code)) {
      continue;
    }

    const item = {
      href: "/organizations",
      icon: MENU_ICONS[menu.code] ?? "grid",
      key: menu.code,
      label: MENU_LABELS[menu.code] ?? menu.label,
    };

    if (ORGANIZATION_MENU_CODES.has(menu.code)) {
      organizationItems.push(item);
    } else if (SYSTEM_MENU_CODES.has(menu.code)) {
      systemItems.push(item);
    }
  }

  if (organizationItems.length) {
    sections.push({
      items: organizationItems,
      key: "organization",
      label: "组织工作台",
    });
  } else if (canViewOrganizations || canViewUsers) {
    sections.push({
      items: [
        { href: "/organizations", icon: "users" as AppIconName, key: "users", label: "用户" },
      ],
      key: "organization",
      label: "组织工作台",
    });
  }

  if (systemItems.length) {
    sections.push({
      items: systemItems,
      key: "system",
      label: "系统管理",
    });
  } else if (canViewRoles || canViewPermissions || canViewSettings) {
    sections.push({
      items: [
        { href: "/organizations", icon: "users", key: "roles", label: "用户组" },
        { href: "/organizations", icon: "switch", key: "permissions", label: "功能" },
        { href: "/organizations", icon: "settings", key: "settings", label: "系统配置" },
      ],
      key: "system",
      label: "系统管理",
    });
  }

  if (organization) {
    sections.unshift({
      items: [
        {
          href: "/organizations",
          icon: "building" as AppIconName,
          key: "current-organization",
          label: organization.name,
        },
      ],
      key: "context",
      label: "当前范围",
    });
  }

  return sections;
}

function getRoleById(roles: Role[], roleId: string | null) {
  return roles.find((role) => role.id === roleId) ?? null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
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
