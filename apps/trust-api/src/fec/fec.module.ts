import { Module } from "@nestjs/common";
import { FecController } from "./fec.controller";
import { FecService } from "./fec.service";

@Module({
  controllers: [FecController],
  providers: [FecService],
})
export class FecModule {}
