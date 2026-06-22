import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  Menu,
  MenuPermission,
  Organization,
  OrganizationStatus,
  TenantUser,
  TenantUserStatus,
} from "@hermes-swarm/core";
import {
  CreateMenuPayload,
  CreateOrganizationPayload,
  CreateUserPayload,
  UpdateMenuPayload,
  UpdateOrganizationPayload,
  UpdateUserPayload,
  UpsertMenuPermissionsPayload,
} from "./tenancy.types.js";

const ORGANIZATION_STATUSES: OrganizationStatus[] = ["active", "suspended"];
const USER_STATUSES: TenantUserStatus[] = ["active", "disabled"];

const DEFAULT_MENUS = [
  { code: "dashboard", label: "控制台", path: "/", sortOrder: 10 },
  { code: "organizations", label: "组织管理", path: "/organizations", sortOrder: 20 },
  { code: "users", label: "用户管理", path: "/users", sortOrder: 30 },
  { code: "menus", label: "菜单管理", path: "/menus", sortOrder: 40 },
  { code: "permissions", label: "权限配置", path: "/permissions", sortOrder: 50 },
];

@Injectable()
export class TenancyService implements OnModuleInit {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(TenantUser)
    private readonly userRepository: Repository<TenantUser>,
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
    @InjectRepository(MenuPermission)
    private readonly permissionRepository: Repository<MenuPermission>,
  ) {}

  async onModuleInit() {
    await this.ensureSeedData();
  }

  async getSnapshot() {
    const [organizations, users, menus, permissions] = await Promise.all([
      this.listOrganizations(),
      this.userRepository.find({
        order: { createdAt: "ASC" },
      }),
      this.listMenus(),
      this.permissionRepository.find({
        order: { createdAt: "ASC" },
      }),
    ]);

    return { organizations, users, menus, permissions };
  }

  listOrganizations() {
    return this.organizationRepository.find({
      order: { createdAt: "ASC" },
    });
  }

  async createOrganization(payload: CreateOrganizationPayload) {
    const name = requireText(payload.name, "组织名称");
    const slug = normalizeSlug(payload.slug || name);
    const status = normalizeOrganizationStatus(payload.status);

    await this.assertUniqueOrganizationSlug(slug);

    return this.organizationRepository.save(
      this.organizationRepository.create({ name, slug, status }),
    );
  }

  async updateOrganization(
    organizationId: string,
    payload: UpdateOrganizationPayload,
  ) {
    const organization = await this.getOrganizationOrThrow(organizationId);

    if (payload.name !== undefined) {
      organization.name = requireText(payload.name, "组织名称");
    }

    if (payload.slug !== undefined) {
      const nextSlug = normalizeSlug(payload.slug);
      if (nextSlug !== organization.slug) {
        await this.assertUniqueOrganizationSlug(nextSlug);
      }
      organization.slug = nextSlug;
    }

    if (payload.status !== undefined) {
      organization.status = normalizeOrganizationStatus(payload.status);
    }

    return this.organizationRepository.save(organization);
  }

  async listUsers(organizationId: string) {
    await this.getOrganizationOrThrow(organizationId);
    return this.userRepository.find({
      where: { organizationId },
      order: { createdAt: "ASC" },
    });
  }

  async createUser(organizationId: string, payload: CreateUserPayload) {
    await this.getOrganizationOrThrow(organizationId);
    const displayName = requireText(payload.displayName, "用户名称");
    const email = normalizeEmail(payload.email);
    const status = normalizeUserStatus(payload.status);

    await this.assertUniqueUserEmail(organizationId, email);

    return this.userRepository.save(
      this.userRepository.create({
        organizationId,
        displayName,
        email,
        status,
      }),
    );
  }

  async updateUser(
    organizationId: string,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const user = await this.getUserInOrganizationOrThrow(organizationId, userId);

    if (payload.displayName !== undefined) {
      user.displayName = requireText(payload.displayName, "用户名称");
    }

    if (payload.email !== undefined) {
      const nextEmail = normalizeEmail(payload.email);
      if (nextEmail !== user.email) {
        await this.assertUniqueUserEmail(organizationId, nextEmail);
      }
      user.email = nextEmail;
    }

    if (payload.status !== undefined) {
      user.status = normalizeUserStatus(payload.status);
    }

    return this.userRepository.save(user);
  }

  listMenus() {
    return this.menuRepository.find({
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
  }

  async createMenu(payload: CreateMenuPayload) {
    const code = normalizeMenuCode(payload.code);
    const label = requireText(payload.label, "菜单名称");
    const path = normalizeMenuPath(payload.path);
    const parentId = await this.normalizeParentId(payload.parentId);

    await this.assertUniqueMenuCode(code);

    return this.menuRepository.save(
      this.menuRepository.create({
        code,
        label,
        path,
        parentId,
        sortOrder: normalizeSortOrder(payload.sortOrder),
        isActive: payload.isActive ?? true,
      }),
    );
  }

  async updateMenu(menuId: string, payload: UpdateMenuPayload) {
    const menu = await this.getMenuOrThrow(menuId);

    if (payload.code !== undefined) {
      const nextCode = normalizeMenuCode(payload.code);
      if (nextCode !== menu.code) {
        await this.assertUniqueMenuCode(nextCode);
      }
      menu.code = nextCode;
    }

    if (payload.label !== undefined) {
      menu.label = requireText(payload.label, "菜单名称");
    }

    if (payload.path !== undefined) {
      menu.path = normalizeMenuPath(payload.path);
    }

    if (payload.parentId !== undefined) {
      if (payload.parentId === menu.id) {
        throw new BadRequestException("菜单不能选择自身作为父级");
      }
      menu.parentId = await this.normalizeParentId(payload.parentId);
    }

    if (payload.sortOrder !== undefined) {
      menu.sortOrder = normalizeSortOrder(payload.sortOrder);
    }

    if (payload.isActive !== undefined) {
      menu.isActive = Boolean(payload.isActive);
    }

    return this.menuRepository.save(menu);
  }

  async listUserMenuPermissions(organizationId: string, userId: string) {
    await this.getUserInOrganizationOrThrow(organizationId, userId);
    return this.permissionRepository.find({
      where: { organizationId, userId },
      order: { createdAt: "ASC" },
    });
  }

  async replaceUserMenuPermissions(
    organizationId: string,
    userId: string,
    payload: UpsertMenuPermissionsPayload,
  ) {
    await this.getUserInOrganizationOrThrow(organizationId, userId);

    const normalizedPermissions = normalizePermissionPayload(
      payload.permissions,
    );

    if (normalizedPermissions.length > 0) {
      const menus = await this.menuRepository.find({
        where: { id: In(normalizedPermissions.map((item) => item.menuId)) },
      });
      if (menus.length !== normalizedPermissions.length) {
        throw new BadRequestException("存在无效菜单权限");
      }
    }

    await this.permissionRepository.delete({ organizationId, userId });

    const grantedPermissions = normalizedPermissions.filter(
      (item) => item.canView || item.canManage,
    );

    if (grantedPermissions.length === 0) {
      return [];
    }

    return this.permissionRepository.save(
      grantedPermissions.map((item) =>
        this.permissionRepository.create({
          organizationId,
          userId,
          menuId: item.menuId,
          canView: item.canView || item.canManage,
          canManage: item.canManage,
        }),
      ),
    );
  }

  private async ensureSeedData() {
    const menuCount = await this.menuRepository.count();
    if (menuCount === 0) {
      await this.menuRepository.save(
        DEFAULT_MENUS.map((menu) =>
          this.menuRepository.create({ ...menu, parentId: null, isActive: true }),
        ),
      );
    }

    let organization = await this.organizationRepository.findOne({
      where: { slug: "default" },
    });

    if (!organization) {
      organization = await this.organizationRepository.save(
        this.organizationRepository.create({
          name: "Default Organization",
          slug: "default",
          status: "active",
        }),
      );
    }

    let user = await this.userRepository.findOne({
      where: { organizationId: organization.id, email: "admin@hermes.local" },
    });

    if (!user) {
      user = await this.userRepository.save(
        this.userRepository.create({
          organizationId: organization.id,
          displayName: "Tenant Admin",
          email: "admin@hermes.local",
          status: "active",
        }),
      );
    }

    const permissions = await this.permissionRepository.find({
      where: { organizationId: organization.id, userId: user.id },
    });

    if (permissions.length === 0) {
      const menus = await this.listMenus();
      await this.permissionRepository.save(
        menus.map((menu) =>
          this.permissionRepository.create({
            organizationId: organization.id,
            userId: user.id,
            menuId: menu.id,
            canView: true,
            canManage: true,
          }),
        ),
      );
    }
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException("组织不存在");
    }

    return organization;
  }

  private async getUserInOrganizationOrThrow(
    organizationId: string,
    userId: string,
  ) {
    const user = await this.userRepository.findOne({
      where: { id: userId, organizationId },
    });

    if (!user) {
      throw new NotFoundException("用户不存在或不属于该组织");
    }

    return user;
  }

  private async getMenuOrThrow(menuId: string) {
    const menu = await this.menuRepository.findOne({ where: { id: menuId } });

    if (!menu) {
      throw new NotFoundException("菜单不存在");
    }

    return menu;
  }

  private async normalizeParentId(parentId: string | null | undefined) {
    if (!parentId) {
      return null;
    }

    await this.getMenuOrThrow(parentId);
    return parentId;
  }

  private async assertUniqueOrganizationSlug(slug: string) {
    const existing = await this.organizationRepository.findOne({
      where: { slug },
    });

    if (existing) {
      throw new ConflictException("组织标识已存在");
    }
  }

  private async assertUniqueUserEmail(organizationId: string, email: string) {
    const existing = await this.userRepository.findOne({
      where: { organizationId, email },
    });

    if (existing) {
      throw new ConflictException("该组织下邮箱已存在");
    }
  }

  private async assertUniqueMenuCode(code: string) {
    const existing = await this.menuRepository.findOne({ where: { code } });

    if (existing) {
      throw new ConflictException("菜单编码已存在");
    }
  }
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return text;
}

function normalizeSlug(value: string | undefined) {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new BadRequestException("组织标识不能为空");
  }

  return slug;
}

function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function normalizeMenuCode(value: string | undefined) {
  const code = value?.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
  if (!code) {
    throw new BadRequestException("菜单编码不能为空");
  }
  return code;
}

function normalizeMenuPath(value: string | undefined) {
  const path = requireText(value, "菜单路径");
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeSortOrder(value: number | undefined) {
  if (value === undefined || Number.isNaN(Number(value))) {
    return 0;
  }
  return Number(value);
}

function normalizeOrganizationStatus(
  status: OrganizationStatus | undefined,
): OrganizationStatus {
  if (!status) {
    return "active";
  }
  if (!ORGANIZATION_STATUSES.includes(status)) {
    throw new BadRequestException("组织状态不合法");
  }
  return status;
}

function normalizeUserStatus(
  status: TenantUserStatus | undefined,
): TenantUserStatus {
  if (!status) {
    return "active";
  }
  if (!USER_STATUSES.includes(status)) {
    throw new BadRequestException("用户状态不合法");
  }
  return status;
}

function normalizePermissionPayload(
  permissions: UpsertMenuPermissionsPayload["permissions"],
) {
  const unique = new Map<
    string,
    { menuId: string; canView: boolean; canManage: boolean }
  >();

  for (const permission of permissions ?? []) {
    const menuId = permission.menuId?.trim();
    if (!menuId) {
      throw new BadRequestException("菜单权限缺少 menuId");
    }
    unique.set(menuId, {
      menuId,
      canView: Boolean(permission.canView),
      canManage: Boolean(permission.canManage),
    });
  }

  return [...unique.values()];
}
