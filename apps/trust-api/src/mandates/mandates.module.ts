import { Module } from "@nestjs/common";
import { MandatesController } from "./mandates.controller";
import { MandatesService } from "./mandates.service";

@Module({
  controllers: [MandatesController],
  providers: [MandatesService],
  exports: [MandatesService],
})
export class MandatesModule {}
