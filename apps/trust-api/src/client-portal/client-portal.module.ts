import { Module } from "@nestjs/common";
import { ClientPortalAuthController } from "./client-portal-auth.controller";
import { ClientPortalAuthService } from "./client-portal-auth.service";
import { ClientPortalOtpService } from "./client-portal-otp.service";
import { ClientPortalController } from "./client-portal.controller";
import { ClientPortalService } from "./client-portal.service";

// AUTH_TOKEN_SERVICE/PASSWORD_SERVICE (AuthModule) et SMS_PROVIDER
// (NotificationsModule) sont tous deux @Global() — jamais réimportés ici.
@Module({
  controllers: [ClientPortalAuthController, ClientPortalController],
  providers: [ClientPortalAuthService, ClientPortalOtpService, ClientPortalService],
  // ClientPortalService exporté — réutilisé par UssdModule pour l'option 7
  // (*620#, résolution PIN déjà authentifiée, même service que la PWA plutôt
  // qu'une seconde implémentation de la résolution cross-organisation).
  //
  // Cross-Story Audit 2026-08-24, finding #2 — ClientPortalOtpService exporté
  // pour être réutilisé par AuthModule (AuthService.register(), réclamation
  // d'un compte fantôme F13 : même preuve de possession du téléphone que la
  // connexion au portail client, jamais un second mécanisme OTP dupliqué).
  exports: [ClientPortalService, ClientPortalOtpService],
})
export class ClientPortalModule {}
