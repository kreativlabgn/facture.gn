import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { ClientPortalAuthService } from "./client-portal-auth.service";
import { requestOtpSchema, type RequestOtpDto } from "./dto/request-otp.dto";
import { verifyOtpSchema, type VerifyOtpDto } from "./dto/verify-otp.dto";

// F13, ADR-096/ADR-108 — les deux seules routes du portail atteignables sans
// authentification préalable (avant même d'avoir un token). Même discipline
// que auth.controller.ts (register/login/recovery-requests) : @Public() +
// Throttle strict par IP, bien en-dessous du filet générique 100/min
// d'AppModule — seules routes exploitables pour un abus de spam SMS ou un
// brute-force de code OTP à grande échelle.
@ApiTags("client-portal")
@Controller("client-portal/otp")
export class ClientPortalAuthController {
  constructor(private readonly clientPortalAuthService: ClientPortalAuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("request")
  requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) dto: RequestOtpDto) {
    return this.clientPortalAuthService.requestOtp(dto.msisdn);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("verify")
  verifyOtp(@Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpDto) {
    return this.clientPortalAuthService.verifyOtp(dto.msisdn, dto.code);
  }
}
