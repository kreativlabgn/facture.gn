import { Module } from "@nestjs/common";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";

// PASSWORD_SERVICE résolu via AuthModule (@Global(), voir app.module.ts) —
// aucun import explicite requis ici.
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
