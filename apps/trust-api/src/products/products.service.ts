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
  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: { organizationId: dto.organizationId, name: dto.name },
    });
  }
}
