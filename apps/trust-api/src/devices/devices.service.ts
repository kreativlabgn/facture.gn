import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { PASSWORD_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";
import type { ProvisionDeviceDto } from "./dto/provision-device.dto";
import type { EnrollDeviceDto } from "./dto/enroll-device.dto";

// Fenêtre courte : un jeton d'association se présente dans la foulée de sa
// remise à l'installateur, jamais des jours plus tard. Valeur MVP assumée,
// ajustable en ce point unique (même posture que PENDING_MEMBER_INVITE_TTL_MS).
export const DEVICE_ENROLLMENT_TOKEN_TTL_MS = 30 * 60_000;

// 32 octets d'entropie CSPRNG. Jamais Math.random() — c'est le seul secret qui
// autorise l'enrôlement d'un terminal.
function generateEnrollmentToken(): string {
  return randomBytes(32).toString("base64url");
}

// RLS (ADR-111) — CARTE DU MODULE. `device` porte organization_id en direct et
// a rejoint le registre (migration 20260907030000) : 29 tables au 2026-09-07.
//
// Le module a DEUX régimes, et c'est le cœur de sa conception :
//
//   • provision() / list() / revoke() — chemin PME. L'organisation vient du
//     RolesGuard, tout passe par organizationScopedClient.
//
//   • enroll() — chemin TERMINAL. Le boîtier ne présente qu'un jeton : il n'est
//     porteur d'aucune session, d'aucune organisation. La résolution du jeton
//     est donc une lecture de DÉCOUVERTE, non scopée, exactement comme
//     PaymentsService.recordProviderPayment() pour le webhook opérateur. Dès
//     l'organisation connue, tout bascule sous scope.
@Injectable()
export class DevicesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
  ) {}

  // Émet un jeton d'association à usage unique pour un futur terminal. Le jeton
  // en clair n'est rendu QU'ICI, une seule fois — seule son empreinte est
  // persistée (même discipline qu'ApiKeysService.createApiKey).
  async provision(
    organizationId: string,
    dto: ProvisionDeviceDto,
    requesterUserId: string,
  ): Promise<{ deviceId: string; enrollmentToken: string; expiresAt: Date }> {
    const scoped = organizationScopedClient(this.prisma, organizationId);

    // La succursale doit appartenir à CETTE organisation : sans cette lecture,
    // un branchId d'un tiers rattacherait un terminal hors périmètre. Double
    // clause, et findFirst — jamais findUnique via un client scopé.
    if (dto.branchId) {
      const branch = await scoped.branch.findFirst({
        where: { id: dto.branchId, organizationId },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException(`Succursale ${dto.branchId} introuvable pour cette organisation`);
      }
    }

    const enrollmentToken = generateEnrollmentToken();
    // Aléa INDÉPENDANT du jeton. Dériver le placeholder du jeton (un prefixe,
    // par exemple) réintroduirait en clair, dans une colonne que list() rend
    // aux administrateurs, une partie du secret que enrollmentTokenHash existe
    // précisément pour ne jamais stocker.
    const placeholderSerial = `pending:${randomBytes(12).toString("hex")}`;
    const enrollmentTokenHash = await this.passwordService.hash(enrollmentToken);
    const tokenExpiresAt = new Date(Date.now() + DEVICE_ENROLLMENT_TOKEN_TTL_MS);

    const device = await scoped.device.create({
      data: {
        organizationId,
        branchId: dto.branchId ?? null,
        label: dto.label,
        // Placeholder unique : la colonne est @unique globalement et le vrai
        // numéro de série n'est connu qu'à l'enrôlement. Un littéral fixe
        // ferait échouer le deuxième provisionnement de la plateforme.
        imeiOrSerial: placeholderSerial,
        status: "pending",
        enrollmentTokenHash,
        tokenExpiresAt,
        provisionedByUserId: requesterUserId,
      },
    });

    return { deviceId: device.id, enrollmentToken, expiresAt: tokenExpiresAt };
  }

  // Chemin TERMINAL. Aucune session, aucune organisation : le jeton EST
  // l'identité. Message d'échec unique et générique — un terminal ne doit
  // jamais pouvoir distinguer « jeton inconnu » de « jeton expiré » ou « déjà
  // consommé », sous peine d'en faire un oracle (même discipline que
  // ClientPortalOtpService.verifyAndConsume et AuthService.login).
  async enroll(dto: EnrollDeviceDto): Promise<{ deviceId: string; status: string }> {
    const INVALIDE = "Jeton d'enrôlement invalide ou expiré";

    // ── Découverte, hors scope ────────────────────────────────────────────────
    // argon2 est volontairement non réversible : on ne peut pas retrouver la
    // ligne par un WHERE sur le hash. On restreint donc aux candidats
    // réellement enrôlables (pending, non consommés, non expirés), puis on
    // vérifie le jeton un par un. Le volume reste borné : une organisation n'a
    // qu'une poignée de terminaux en attente à un instant donné.
    const candidats = await this.prisma.device.findMany({
      where: {
        status: "pending",
        tokenConsumedAt: null,
        tokenExpiresAt: { gt: new Date() },
      },
      select: { id: true, organizationId: true, enrollmentTokenHash: true },
    });

    let cible: { id: string; organizationId: string } | null = null;
    for (const candidat of candidats) {
      if (await this.passwordService.verify(candidat.enrollmentTokenHash, dto.enrollmentToken)) {
        cible = { id: candidat.id, organizationId: candidat.organizationId };
        break;
      }
    }
    if (!cible) {
      throw new NotFoundException(INVALIDE);
    }

    // ── À partir d'ici l'organisation est connue : tout est scopé ─────────────
    try {
      return await this.prisma.$transaction(async (tx) => {
        // GUC en première ligne : il couvre la revendication du jeton et
        // l'activation du terminal.
        await setOrganizationScope(tx, cible.organizationId);

        // updateMany + where sur l'état, jamais un update inconditionnel : deux
        // présentations concurrentes du même jeton ne doivent enrôler qu'une
        // fois. C'est cette clause, pas la lecture ci-dessus, qui ferme la
        // course (même idiome que PendingMemberInviteService.resolveForNewUser).
        const revendique = await tx.device.updateMany({
          where: {
            id: cible.id,
            organizationId: cible.organizationId,
            status: "pending",
            tokenConsumedAt: null,
            tokenExpiresAt: { gt: new Date() },
          },
          data: {
            imeiOrSerial: dto.imeiOrSerial,
            publicKey: dto.publicKey,
            status: "active",
            tokenConsumedAt: new Date(),
            enrolledAt: new Date(),
          },
        });
        if (revendique.count === 0) {
          throw new NotFoundException(INVALIDE);
        }

        return { deviceId: cible.id, status: "active" };
      });
    } catch (error) {
      // imei_or_serial est @unique GLOBALEMENT : le même boîtier ne peut pas
      // être enrôlé deux fois, ni par deux organisations. La contrainte est le
      // seul garde-fou réel sous concurrence — une lecture préalable ne verrait
      // de toute façon pas la ligne d'une AUTRE organisation, RLS la masquant.
      // Message distinct de INVALIDE : ici le jeton était bon, c'est le
      // matériel qui est déjà enrôlé. Aucune fuite — l'appelant détient un
      // jeton valide de l'organisation concernée.
      if (isUniqueConstraintViolation(error, "imei_or_serial")) {
        throw new ConflictException(`Terminal ${dto.imeiOrSerial} déjà enrôlé`);
      }
      throw error;
    }
  }

  async list(organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).device.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      // Ni enrollmentTokenHash ni publicKey : le premier est un secret, le
      // second n'a aucun intérêt dans une liste d'écran.
      select: {
        id: true,
        label: true,
        branchId: true,
        imeiOrSerial: true,
        status: true,
        createdAt: true,
        enrolledAt: true,
        revokedAt: true,
      },
    });
  }

  // Coupure d'un terminal — perte, vol, remplacement. Jamais une suppression :
  // les factures déjà émises par ce terminal doivent rester traçables.
  async revoke(organizationId: string, deviceId: string, requesterUserId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);

    // Un terminal inexistant et un terminal d'un tiers rendent le même 404 :
    // la double clause porte la vérification, le message ne distingue rien.
    const device = await scoped.device.findFirst({
      where: { id: deviceId, organizationId },
      select: { id: true, status: true },
    });
    if (!device) {
      throw new NotFoundException(`Terminal ${deviceId} introuvable pour cette organisation`);
    }
    if (device.status === "revoked") {
      throw new ConflictException(`Terminal ${deviceId} déjà révoqué`);
    }

    // update() exige un `where` unique et ne peut pas porter la colonne de
    // scope : la lecture scopée ci-dessus est la barrière.
    return scoped.device.update({
      where: { id: deviceId },
      data: { status: "revoked", revokedAt: new Date(), revokedByUserId: requesterUserId },
    });
  }
}
