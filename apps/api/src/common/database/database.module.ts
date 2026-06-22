import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { getPostgresUrl } from "@hermes-swarm/core/config/database";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: "postgres",
        url: getPostgresUrl(),
        autoLoadEntities: true,
        synchronize: true, // dev only
      }),
    }),
  ],
})
export class DatabaseModule {}
