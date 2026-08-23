import { Global, Module } from "@nestjs/common";
import { PendingMemberInviteService } from "./pending-member-invite.service";

// @Global() — même précédent que NotificationsModule/AuthModule : consommé par
// AuthModule (register), OrganizationsModule (createAssisted), ClientPortalModule
// (auto-inscription OTP), OrganizationsModule/PracticesModule (endpoints
// d'invitation) sans import circulaire entre ces modules distincts.
@Global()
@Module({
  providers: [PendingMemberInviteService],
  exports: [PendingMemberInviteService],
})
export class PendingMemberInvitesModule {}
