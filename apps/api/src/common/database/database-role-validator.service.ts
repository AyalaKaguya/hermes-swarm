import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
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
  private readonly logger = new Logger(DatabaseRoleValidatorService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @InjectDataSource() private readonly workspaceDataSource: DataSource,
    @InjectDataSource(PLATFORM_DATA_SOURCE)
    private readonly platformDataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    if (!this.configService.getOrThrow<boolean>("database.strictRls")) {
      const workspaceUrl = this.configService.getOrThrow<string>(
        "database.workspaceUrl",
      );
      const platformUrl = this.configService.getOrThrow<string>(
        "database.platformUrl",
      );
      if (workspaceUrl === platformUrl) {
        this.logger.warn(
          "Workspace and platform datasources share one PostgreSQL URL; strict RLS role isolation is disabled.",
        );
      }
      return;
    }

    const [workspace] = await this.workspaceDataSource.query<RoleState[]>(
      `SELECT current_user, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    const [platform] = await this.platformDataSource.query<RoleState[]>(
      `SELECT current_user, rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`,
    );
    if (!workspace || workspace.current_user !== "hermes_workspace_app") {
      throw new Error(
        "Workspace datasource must run as hermes_workspace_app when strict RLS is enabled",
      );
    }
    if (workspace.rolsuper || workspace.rolbypassrls) {
      throw new Error("Workspace datasource database role must not bypass RLS");
    }
    if (!platform || platform.current_user === workspace.current_user) {
      throw new Error("Platform datasource must use a distinct database role");
    }
    if (!platform.rolsuper && !platform.rolbypassrls) {
      throw new Error(
        "Platform datasource database role must be allowed to bypass workspace RLS",
      );
    }
  }
}
