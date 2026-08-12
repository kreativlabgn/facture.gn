import { Module } from "@nestjs/common";
import { UssdController } from "./ussd.controller";
import { UssdSessionService } from "./ussd-session.service";

@Module({
  controllers: [UssdController],
  providers: [UssdSessionService],
})
export class UssdModule {}
