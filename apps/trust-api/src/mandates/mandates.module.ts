import { Module } from "@nestjs/common";
import { MandatesController } from "./mandates.controller";
import { OrganizationMandatesController } from "./organization-mandates.controller";
import { MandatesService } from "./mandates.service";

@Module({
  controllers: [MandatesController, OrganizationMandatesController],
  providers: [MandatesService],
  exports: [MandatesService],
})
export class MandatesModule {}
