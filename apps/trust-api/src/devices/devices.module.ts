import { Module } from "@nestjs/common";
import { DevicesController, DeviceEnrollmentController } from "./devices.controller";
import { DevicesService } from "./devices.service";

// PASSWORD_SERVICE résolu via AuthModule (@Global(), voir app.module.ts) — le
// service s'en sert pour hacher et vérifier les jetons d'enrôlement, avec la
// même primitive argon2id que les mots de passe et les clés d'API.
@Module({
  controllers: [DevicesController, DeviceEnrollmentController],
  providers: [DevicesService],
})
export class DevicesModule {}
