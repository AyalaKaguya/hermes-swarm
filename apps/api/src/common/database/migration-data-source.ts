import "reflect-metadata";
import path from "node:path";
import { DataSource } from "typeorm";
import { databaseRuntimeConfig } from "../config/runtime-config.js";
import { DATABASE_ENTITIES } from "./database-entities.js";

const database = databaseRuntimeConfig();

/** Release-only datasource. API instances never auto-apply migrations. */
export default new DataSource({
  type: "postgres",
  url: database.url,
  entities: [...DATABASE_ENTITIES],
  migrations: [path.join(import.meta.dirname, "migrations", "*.{js,ts}")],
  synchronize: false,
});
