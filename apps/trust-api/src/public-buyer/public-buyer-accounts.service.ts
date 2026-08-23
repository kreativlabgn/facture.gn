import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreatePublicBuyerAccountDto } from "./dto/create-public-buyer-account.dto";

@Injectable()
export class PublicBuyerAccountsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Self-service, même précédent que PracticesService.create() (ADR-068) : le
  // créateur devient public_buyer_validator dans la même transaction, jamais un
  // compte sans au moins un membre pouvant l'utiliser. Aucune vérification
  // institutionnelle en V1 (même posture que les cabinets/CGA à leurs débuts).
  async create(dto: CreatePublicBuyerAccountDto, creatorUserId: string) {
    // Un DAF n'appartient qu'à un seul public_buyer_account en V1 (invariant dont dépend
    // PublicBuyerPortalService.listReceivedInvoices(), qui résout le membership par userId
    // seul) — sans cette garde, le self-service permettrait silencieusement une double
    // appartenance et rendrait ce membership ambigu.
    const existingMembership = await this.prisma.publicBuyerAccountMember.findFirst({
      where: { userId: creatorUserId },
    });
    if (existingMembership) {
      throw new ConflictException("Cet utilisateur est déjà membre d'un compte acheteur public");
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.publicBuyerAccount.create({ data: { name: dto.name } });

      await tx.publicBuyerAccountMember.create({
        data: { publicBuyerAccountId: account.id, userId: creatorUserId, role: "public_buyer_validator" },
      });

      return account;
    });
  }

  // Sélecteur PME (F16, flag-public-entity) — aucun concept "actif/inactif"
  // scaffoldé (même limite que ProfessionalPractice), tout compte existant est
  // retourné, trié pour un sélecteur lisible côté client.
  //
  // Security Audit 2026-08-23, revue post-fix #1 (finding #1 CRITIQUE) —
  // select restreint à {id, name} : cet endpoint n'a aucun @Roles() (self-service
  // volontaire, tout owner/admin PME doit pouvoir rattacher un client), donc
  // n'importe qui d'authentifié peut lister tous les comptes. Ne JAMAIS exposer
  // verificationStatus ici — un attaquant pourrait sinon l'utiliser pour repérer
  // spécifiquement les comptes déjà "verified" comme cibles de repointage
  // (flagPublicEntity() est désormais protégé indépendamment côté serveur, mais
  // cet endpoint ne doit pas non plus faciliter la reconnaissance de cibles).
  async listActive() {
    return this.prisma.publicBuyerAccount.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }
}
