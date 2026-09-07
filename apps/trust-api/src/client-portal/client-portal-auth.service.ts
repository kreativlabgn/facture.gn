import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { AUTH_TOKEN_SERVICE } from "../auth/auth.tokens";
import type { AuthTokenService } from "../auth/auth-token.service";
import { ClientPortalOtpService } from "./client-portal-otp.service";

// F13, ADR-096/ADR-108 — auto-inscription par OTP SMS, canal PWA du portail
// client. Aucune invitation préalable requise : un numéro totalement inconnu du
// repo peut demander/vérifier un OTP, ce qui résout ou crée son identité User
// (voir resolveOrCreateUser). Le canal *620# reste sur UssdAuthService (PIN
// direct, ADR-108) — non concerné par ce service.
//
// Cross-Story Audit 2026-08-24, finding #2 — le stockage/la vérification/la
// consommation de l'OTP lui-même vivent désormais dans ClientPortalOtpService
// (extrait pour être réutilisé par AuthService.register(), qui exige la même
// preuve de possession du téléphone pour réclamer un compte fantôme). Ce
// service-ci ne fait plus qu'orchestrer : déléguer l'OTP, puis résoudre/créer
// le User et émettre le token scope:"client_portal".
@Injectable()
export class ClientPortalAuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
    private readonly clientPortalOtp: ClientPortalOtpService,
  ) {}

  async requestOtp(msisdn: string): Promise<{ message: string }> {
    await this.clientPortalOtp.request(msisdn);

    // Toujours le même message, que le numéro soit déjà connu ou non — la
    // résolution d'identité n'a lieu qu'à la vérification, jamais ici.
    return { message: "Un code de vérification a été envoyé par SMS." };
  }

  async verifyOtp(msisdn: string, code: string): Promise<{ accessToken: string }> {
    await this.clientPortalOtp.verifyAndConsume(msisdn, code);

    const userId = await this.resolveOrCreateUser(msisdn);
    // Cross-Story Audit 2026-08-24, finding #1 CRITIQUE — sans `scope`, ce token
    // était indiscernable d'un token AuthService.login() (mot de passe vérifié) :
    // un attaquant interceptant ce SMS OTP obtenait une portée COMPLÈTE sur le
    // compte de la victime (dont son rôle réel owner/admin sur une organisation),
    // pas seulement l'accès au portail client. `scope: "client_portal"` est lu
    // par RolesGuard (rejette 403 sur toute route @Roles()) et par
    // ClientPortalScopeGuard (seule valeur, avec l'absence de scope, acceptée
    // sur ClientPortalController/ClientPortalAuthController).
    const accessToken = await this.tokenService.sign({ sub: userId, scope: "client_portal" });
    return { accessToken };
  }

  // ADR-096 : un numéro déjà connu (ex. collaborateur d'une organisation
  // ailleurs) réutilise son User existant tel quel — jamais une seconde
  // identité pour le même msisdn. Un numéro totalement inconnu déclenche
  // l'auto-inscription : User sans passwordHash/pinHash (jamais utilisable pour
  // /auth/login ni *620#, seule la session client_portal issue de cet OTP y
  // donne accès) + UserPhone déjà vérifié.
  //
  // F10 — décision délibérée de NE PAS résoudre PendingMemberInvite ici,
  // contrairement à AuthService.register()/OrganizationsService.createAssisted() :
  // un User créé par ce chemin n'a ni passwordHash ni pinHash, donc ne pourrait
  // jamais réellement se servir d'un accès OrganizationMember/PracticeMember
  // (aucun moyen de login PWA/*620# pour l'utiliser). Résoudre l'invitation ici
  // créerait un membership fantôme, inutilisable, et bloquerait en plus toute
  // inscription "réelle" ultérieure sur ce numéro (AuthService.register()
  // rejette déjà un msisdn existant avec ConflictException). Une invitation
  // reçue par quelqu'un qui commence par le portail client doit d'abord passer
  // par une inscription PWA classique pour être résolue.
  // RLS — non scopée à dessein : `user` et `user_phone` sont hors des
  // politiques (identité, partagée entre organisations), et cette méthode
  // s'exécute AVANT toute organisation — elle sert justement à établir
  // l'identité que ClientPortalService utilisera ensuite pour les découvrir.
  // Le $transaction ci-dessous ne touche qu'à ces deux tables : aucun
  // setOrganizationScope() à poser.
  private async resolveOrCreateUser(msisdn: string): Promise<string> {
    const existingPhone = await this.prisma.userPhone.findUnique({ where: { msisdn } });
    if (existingPhone) {
      if (!existingPhone.verifiedAt) {
        await this.prisma.userPhone.update({
          where: { id: existingPhone.id },
          data: { verifiedAt: new Date() },
        });
      }
      return existingPhone.userId;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Aucune collecte de nom pendant l'auto-inscription OTP — le msisdn sert
      // de nom par défaut, faute d'un flux "profil" dans le périmètre de F13.
      const user = await tx.user.create({ data: { name: msisdn } });
      await tx.userPhone.create({
        data: { userId: user.id, msisdn, isPrimary: true, verifiedAt: new Date() },
      });
      return user;
    });

    return created.id;
  }
}
