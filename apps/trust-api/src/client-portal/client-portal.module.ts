import { Module } from "@nestjs/common";
import { ClientPortalAuthController } from "./client-portal-auth.controller";
import { ClientPortalAuthService } from "./client-portal-auth.service";
import { ClientPortalController } from "./client-portal.controller";
import { ClientPortalService } from "./client-portal.service";

// AUTH_TOKEN_SERVICE/PASSWORD_SERVICE (AuthModule) et SMS_PROVIDER
// (NotificationsModule) sont tous deux @Global() — jamais réimportés ici.
@Module({
  controllers: [ClientPortalAuthController, ClientPortalController],
  providers: [ClientPortalAuthService, ClientPortalService],
})
export class ClientPortalModule {}
