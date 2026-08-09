import { Module } from "@nestjs/common";
import { MandatesModule } from "../mandates/mandates.module";
import { PracticesController } from "./practices.controller";
import { PracticesService } from "./practices.service";

@Module({
  imports: [MandatesModule],
  controllers: [PracticesController],
  providers: [PracticesService],
  exports: [PracticesService],
})
export class PracticesModule {}
