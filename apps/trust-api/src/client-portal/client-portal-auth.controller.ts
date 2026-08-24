import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { ClientPortalAuthService } from "./client-portal-auth.service";
import { ClientPortalScopeGuard } from "./client-portal-scope.guard";
import { requestOtpSchema, type RequestOtpDto } from "./dto/request-otp.dto";
import { verifyOtpSchema, type VerifyOtpDto } from "./dto/verify-otp.dto";
import { AllowClientPortalScope } from "../common/allow-client-portal-scope.decorator";

// F13, ADR-096/ADR-108 — les deux seules routes du portail atteignables sans
// authentification préalable (avant même d'avoir un token). Même discipline
// que auth.controller.ts (register/login/recovery-requests) : @Public() +
// Throttle strict par IP, bien en-dessous du filet générique 100/min
// d'AppModule — seules routes exploitables pour un abus de spam SMS ou un
// brute-force de code OTP à grande échelle.
//
// Cross-Story Audit 2026-08-24, finding #1 — ClientPortalScopeGuard ajouté ici
// aussi par symétrie/documentation avec ClientPortalController : sans effet
// réel sur ces deux routes @Public() (request.user n'existe pas avant l'OTP
// vérifié), mais rend explicite que ce contrôleur appartient au même périmètre
// de portée que ClientPortalController.
//
// Cross-Story Audit 2026-08-24, finding #1 (résiduel) — @AllowClientPortalScope()
// ajouté ici aussi par symétrie/documentation : sans effet réel sur ces deux
// routes @Public() (JwtAuthGuard retourne déjà true avant même de lire le scope),
// mais rend explicite que ce contrôleur appartient au même périmètre autorisé que
// ClientPortalController, au cas où une route non-@Public() y serait ajoutée un jour.
@ApiTags("client-portal")
@AllowClientPortalScope()
@UseGuards(ClientPortalScopeGuard)
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
