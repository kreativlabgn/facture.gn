import { Inject, Injectable } from "@nestjs/common";
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
  async listActive() {
    return this.prisma.publicBuyerAccount.findMany({ orderBy: { name: "asc" } });
  }
}
