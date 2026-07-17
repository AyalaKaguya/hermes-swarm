import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { PLATFORM_DATA_SOURCE } from "./database.constants.js";

type RoleState = {
  current_user: string;
  rolbypassrls: boolean;
  rolsuper: boolean;
};

@Injectable()
export class DatabaseRoleValidatorService implements OnApplicationBootstrap {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @InjectDataSource() private readonly tenantDataSource: DataSource,
    @InjectDataSource(PLATFORM_DATA_SOURCE)
    private readonly platformDataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    if (!this.configService.getOrThrow<boolean>("database.strictRls")) return;

    const [tenant] = await this.tenantDataSource.query<RoleState[]>(
      `SELECT current_user, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    const [platform] = await this.platformDataSource.query<RoleState[]>(
      `SELECT current_user, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    if (!tenant || tenant.current_user !== "hermes_tenant_app") {
      throw new Error(
        "Tenant datasource must run as hermes_tenant_app when strict RLS is enabled",
      );
    }
    if (tenant.rolsuper || tenant.rolbypassrls) {
      throw new Error("Tenant datasource database role must not bypass RLS");
    }
    if (!platform || platform.current_user === tenant.current_user) {
      throw new Error("Platform datasource must use a distinct database role");
    }
    if (!platform.rolsuper && !platform.rolbypassrls) {
      throw new Error(
        "Platform datasource database role must be allowed to bypass tenant RLS",
      );
    }
  }
}
