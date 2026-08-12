import { Module } from "@nestjs/common";
import { VerificationModule } from "../verification/verification.module";
import { UssdController } from "./ussd.controller";
import { UssdSessionService } from "./ussd-session.service";
import { UssdAuthService } from "./ussd-auth.service";

@Module({
  imports: [VerificationModule],
  controllers: [UssdController],
  providers: [UssdSessionService, UssdAuthService],
})
export class UssdModule {}
