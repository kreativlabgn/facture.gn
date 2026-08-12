import { Module } from "@nestjs/common";
import { UssdController } from "./ussd.controller";
import { UssdSessionService } from "./ussd-session.service";
import { UssdAuthService } from "./ussd-auth.service";

@Module({
  controllers: [UssdController],
  providers: [UssdSessionService, UssdAuthService],
})
export class UssdModule {}
