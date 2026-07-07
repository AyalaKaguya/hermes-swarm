import { Controller, Get } from "@nestjs/common";
import { DataSource } from "typeorm";

@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    let db = "error" as string;
    try {
      await this.dataSource.query("SELECT 1");
      db = "connected";
    } catch {
      db = "error";
    }
    return { status: "ok", db };
  }
}
