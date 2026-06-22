"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
};

type TenantUser = {
  id: string;
  organizationId: string;
  displayName: string;
  email: string;
  status: "active" | "disabled";
};

type Menu = {
  id: string;
  parentId: string | null;
  code: string;
  label: string;
  path: string;
  sortOrder: number;
  isActive: boolean;
};

type MenuPermission = {
  id: string;
  organizationId: string;
  userId: string;
  menuId: string;
  canView: boolean;
  canManage: boolean;
};

type TenantSnapshot = {
  organizations: Organization[];
  users: TenantUser[];
  menus: Menu[];
  permissions: MenuPermission[];
};

type PermissionDraft = Record<
  string,
  {
    canView: boolean;
    canManage: boolean;
  }
>;

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100/api";
const ADMIN_API_BASE_URL = `${API_BASE_URL}/admin`;

const emptySnapshot: TenantSnapshot = {
  organizations: [],
  users: [],
  menus: [],
  permissions: [],
};

export function TenantAdminConsole() {
  const [snapshot, setSnapshot] = useState<TenantSnapshot>(emptySnapshot);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [menuLabel, setMenuLabel] = useState("");
  const [menuCode, setMenuCode] = useState("");
  const [menuPath, setMenuPath] = useState("");

  const usersInOrganization = useMemo(
    () =>
      snapshot.users.filter(
        (user) => user.organizationId === selectedOrganizationId,
      ),
    [selectedOrganizationId, snapshot.users],
  );

  const selectedOrganization = snapshot.organizations.find(
    (organization) => organization.id === selectedOrganizationId,
  );

  const selectedUser = usersInOrganization.find(
    (user) => user.id === selectedUserId,
  );

  async function loadSnapshot() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchJson<TenantSnapshot>("/tenant-admin");
      setSnapshot(data);
      setSelectedOrganizationId((current) =>
        data.organizations.some((item) => item.id === current)
          ? current
          : data.organizations[0]?.id ?? "",
      );
    } catch (loadError) {
      setError(getErrorMessage(loadError));
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
    if (!selectedOrganizationId || !selectedUserId) {
      setPermissionDraft({});
      return;
    }

    const nextDraft: PermissionDraft = {};
    for (const permission of snapshot.permissions) {
      if (
        permission.organizationId === selectedOrganizationId &&
        permission.userId === selectedUserId
      ) {
        nextDraft[permission.menuId] = {
          canView: permission.canView,
          canManage: permission.canManage,
        };
      }
    }
    setPermissionDraft(nextDraft);
  }, [selectedOrganizationId, selectedUserId, snapshot.permissions]);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationName.trim()) {
      return;
    }

    await mutate("/organizations", {
      method: "POST",
      body: { name: organizationName },
      success: "组织已创建",
    });
    setOrganizationName("");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId || !userName.trim() || !userEmail.trim()) {
      return;
    }

    await mutate(`/organizations/${selectedOrganizationId}/users`, {
      method: "POST",
      body: { displayName: userName, email: userEmail },
      success: "用户已创建",
    });
    setUserName("");
    setUserEmail("");
  }

  async function createMenu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!menuLabel.trim() || !menuCode.trim() || !menuPath.trim()) {
      return;
    }

    await mutate("/menus", {
      method: "POST",
      body: {
        label: menuLabel,
        code: menuCode,
        path: menuPath,
        sortOrder: snapshot.menus.length * 10 + 10,
      },
      success: "菜单已创建",
    });
    setMenuLabel("");
    setMenuCode("");
    setMenuPath("");
  }

  async function toggleOrganizationStatus(organization: Organization) {
    await mutate(`/organizations/${organization.id}`, {
      method: "PATCH",
      body: {
        status: organization.status === "active" ? "suspended" : "active",
      },
      success: "组织状态已更新",
    });
  }

  async function toggleUserStatus(user: TenantUser) {
    await mutate(`/organizations/${user.organizationId}/users/${user.id}`, {
      method: "PATCH",
      body: { status: user.status === "active" ? "disabled" : "active" },
      success: "用户状态已更新",
    });
  }

  async function toggleMenuStatus(menu: Menu) {
    await mutate(`/menus/${menu.id}`, {
      method: "PATCH",
      body: { isActive: !menu.isActive },
      success: "菜单状态已更新",
    });
  }

  function updatePermissionDraft(
    menuId: string,
    field: "canView" | "canManage",
    checked: boolean,
  ) {
    setPermissionDraft((current) => {
      const nextValue = {
        canView: current[menuId]?.canView ?? false,
        canManage: current[menuId]?.canManage ?? false,
        [field]: checked,
      };

      if (field === "canManage" && checked) {
        nextValue.canView = true;
      }

      if (field === "canView" && !checked) {
        nextValue.canManage = false;
      }

      return { ...current, [menuId]: nextValue };
    });
  }

  async function savePermissions() {
    if (!selectedOrganizationId || !selectedUserId) {
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      await fetchJson(
        `/organizations/${selectedOrganizationId}/users/${selectedUserId}/menu-permissions`,
        {
          method: "PUT",
          body: {
            permissions: snapshot.menus.map((menu) => ({
              menuId: menu.id,
              canView: permissionDraft[menu.id]?.canView ?? false,
              canManage: permissionDraft[menu.id]?.canManage ?? false,
            })),
          },
        },
      );
      setNotice("菜单权限已保存");
      await loadSnapshot();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function mutate(
    path: string,
    options: {
      method: "POST" | "PATCH";
      body: Record<string, unknown>;
      success: string;
    },
  ) {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await fetchJson(path, {
        method: options.method,
        body: options.body,
      });
      setNotice(options.success);
      await loadSnapshot();
    } catch (mutationError) {
      setError(getErrorMessage(mutationError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tenant-console">
      <section className="console-status" aria-live="polite">
        <div>
          <strong>{selectedOrganization?.name ?? "未选择组织"}</strong>
          <span>{selectedUser?.displayName ?? "未选择用户"}</span>
        </div>
        <div>
          {loading && <span className="status-pill neutral">加载中</span>}
          {notice && <span className="status-pill positive">{notice}</span>}
          {error && <span className="status-pill warning">{error}</span>}
        </div>
      </section>

      <section className="admin-grid">
        <div className="panel admin-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Organizations</p>
              <h2>组织</h2>
            </div>
            <span className="count-badge">{snapshot.organizations.length}</span>
          </div>
          <form className="compact-form" onSubmit={createOrganization}>
            <input
              aria-label="组织名称"
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="组织名称"
              value={organizationName}
            />
            <button className="primary-action" disabled={saving} type="submit">
              新建
            </button>
          </form>
          <div className="select-list">
            {snapshot.organizations.map((organization) => (
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
                <em className={organization.status}>{organization.status}</em>
              </button>
            ))}
          </div>
          {selectedOrganization && (
            <button
              className="text-button full-width"
              disabled={saving}
              onClick={() => toggleOrganizationStatus(selectedOrganization)}
              type="button"
            >
              {selectedOrganization.status === "active" ? "暂停组织" : "启用组织"}
            </button>
          )}
        </div>

        <div className="panel admin-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Users</p>
              <h2>用户</h2>
            </div>
            <span className="count-badge">{usersInOrganization.length}</span>
          </div>
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
            <button
              className="primary-action"
              disabled={!selectedOrganizationId || saving}
              type="submit"
            >
              新建用户
            </button>
          </form>
          <div className="select-list">
            {usersInOrganization.map((user) => (
              <button
                className={
                  user.id === selectedUserId ? "select-card selected" : "select-card"
                }
                key={user.id}
                onClick={() => setSelectedUserId(user.id)}
                type="button"
              >
                <span>
                  <strong>{user.displayName}</strong>
                  <small>{user.email}</small>
                </span>
                <em className={user.status}>{user.status}</em>
              </button>
            ))}
          </div>
          {selectedUser && (
            <button
              className="text-button full-width"
              disabled={saving}
              onClick={() => toggleUserStatus(selectedUser)}
              type="button"
            >
              {selectedUser.status === "active" ? "停用用户" : "启用用户"}
            </button>
          )}
        </div>

        <div className="panel admin-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Menus</p>
              <h2>菜单</h2>
            </div>
            <span className="count-badge">{snapshot.menus.length}</span>
          </div>
          <form className="stack-form" onSubmit={createMenu}>
            <input
              aria-label="菜单名称"
              onChange={(event) => setMenuLabel(event.target.value)}
              placeholder="菜单名称"
              value={menuLabel}
            />
            <input
              aria-label="菜单编码"
              onChange={(event) => setMenuCode(event.target.value)}
              placeholder="menu-code"
              value={menuCode}
            />
            <input
              aria-label="菜单路径"
              onChange={(event) => setMenuPath(event.target.value)}
              placeholder="/route"
              value={menuPath}
            />
            <button className="primary-action" disabled={saving} type="submit">
              新建菜单
            </button>
          </form>
          <div className="menu-list">
            {snapshot.menus.map((menu) => (
              <article className="menu-row" key={menu.id}>
                <span>
                  <strong>{menu.label}</strong>
                  <small>{menu.path}</small>
                </span>
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => toggleMenuStatus(menu)}
                  type="button"
                >
                  {menu.isActive ? "启用" : "停用"}
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel permission-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Permissions</p>
            <h2>菜单权限</h2>
          </div>
          <button
            className="primary-action"
            disabled={!selectedUserId || saving}
            onClick={savePermissions}
            type="button"
          >
            保存权限
          </button>
        </div>
        <div className="permission-grid" role="table" aria-label="菜单权限矩阵">
          <div className="permission-head" role="row">
            <span>菜单</span>
            <span>路径</span>
            <span>查看</span>
            <span>管理</span>
          </div>
          {snapshot.menus.map((menu) => (
            <div className="permission-row" key={menu.id} role="row">
              <span>
                <strong>{menu.label}</strong>
                <small>{menu.code}</small>
              </span>
              <span>{menu.path}</span>
              <label>
                <input
                  checked={permissionDraft[menu.id]?.canView ?? false}
                  disabled={!selectedUserId}
                  onChange={(event) =>
                    updatePermissionDraft(menu.id, "canView", event.target.checked)
                  }
                  type="checkbox"
                />
              </label>
              <label>
                <input
                  checked={permissionDraft[menu.id]?.canManage ?? false}
                  disabled={!selectedUserId}
                  onChange={(event) =>
                    updatePermissionDraft(
                      menu.id,
                      "canManage",
                      event.target.checked,
                    )
                  }
                  type="checkbox"
                />
              </label>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

async function fetchJson<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: options?.method ?? "GET",
    headers:
      options?.body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
          },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => undefined);
    const message = Array.isArray(detail?.message)
      ? detail.message.join(", ")
      : detail?.message;
    throw new Error(message || `请求失败：${response.status}`);
  }

  return response.json() as Promise<T>;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
