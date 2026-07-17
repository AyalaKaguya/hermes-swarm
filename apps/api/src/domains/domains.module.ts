import { Module } from "@nestjs/common";
import { SupportModule } from "./support/support.module.js";

@Module({
  imports: [SupportModule],
})
export class DomainsModule {}
