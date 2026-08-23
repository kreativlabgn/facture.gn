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
  async create(dto: CreateProductDto) {
    const existingMatch = await this.prisma.product.findFirst({
      where: { organizationId: dto.organizationId, name: { equals: dto.name, mode: "insensitive" } },
    });

    return this.prisma.product.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
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
