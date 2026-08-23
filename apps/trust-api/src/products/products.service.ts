import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateProductDto } from "./dto/create-product.dto";

@Injectable()
export class ProductsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // E10 — prérequis minimal (aucune story Backlog ne construit la création de
  // PRODUCT, voir PLAN "Clarifications"). costPrice jamais renseigné ici :
  // territoire d'E6, laissé undefined pour que Prisma applique le défaut
  // schema (null), jamais dupliqué en dur ici.
  //
  // E3, ADR-038 — dédoublonnage par nom (exact match insensible à la casse), contre
  // la base existante de l'organisation. Même logique que
  // CustomersService.create() (téléphone) : jamais de fusion automatique, juste le
  // signal possibleDuplicateOf. Aucun ProductsService.merge() : le Backlog ne
  // demande la fusion QUE pour les clients (E4).
  //
  // Revue post-fix — trim() ici au niveau du SERVICE (pas dans le DTO Zod, contrairement
  // au téléphone client via msisdnSchema) : une ressaisie après coupure réseau produit
  // souvent des variations d'espacement de début/fin ("Riz 25kg " vs "Riz 25kg"), pas
  // seulement de casse — sans ce trim, ces deux saisies ne seraient jamais détectées comme
  // doublons. Choix service plutôt que DTO : garde l'invariant testable directement dans
  // products.service.spec.ts (comme le reste du dédoublonnage E3), sans dépendre du
  // comportement de transformation Zod ni faire dépendre les tests de service du DTO.
  // Un seul trim, réutilisé pour la comparaison ET la création (jamais deux normalisations
  // divergentes).
  async create(dto: CreateProductDto) {
    const name = dto.name.trim();
    const existingMatch = await this.prisma.product.findFirst({
      where: {
        organizationId: dto.organizationId,
        name: { equals: name, mode: "insensitive" },
      },
    });

    return this.prisma.product.create({
      data: {
        organizationId: dto.organizationId,
        name,
        possibleDuplicateOf: existingMatch?.id ?? null,
      },
    });
  }

  // E6, ADR-084 — "la création du produit n'est jamais bloquée en son
  // absence" : ce endpoint est le seul chemin qui renseigne costPrice.
  async setCostPrice(productId: string, costPrice: bigint) {
    return this.prisma.product.update({
      where: { id: productId },
      data: { costPrice },
    });
  }
}
