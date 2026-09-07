import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateProductDto } from "./dto/create-product.dto";

const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;

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
  // Cross-Story Audit 2026-08-24, finding #3 MOYENNE-HAUTE (verrou consultatif) —
  // pg_advisory_xact_lock(hashtext(...)) posé AVANT le findFirst, même fix et
  // même mécanisme que CustomersService.create() (voir son commentaire
  // détaillé) : clé dérivée de organizationId+nom normalisé (trim + minuscule,
  // pour que la clé du verrou suive exactement la même normalisation que la
  // comparaison `mode: "insensitive"` ci-dessous — deux saisies qui ne
  // diffèrent que par la casse doivent se sérialiser sur LE MÊME verrou).
  // Remplace la limite précédente (findFirst+create simplement englobés dans
  // $transaction(), sans effet sous isolation Read Committed). Aucune
  // contrainte unique DB ajoutée, même raison qu'expliqué chez
  // CustomersService.create() (ADR-038 : signal, jamais une règle d'unicité).
  // RLS — `organizationId` vient du RolesGuard (@CurrentOrganizationId), plus
  // de `dto.organizationId` : sur une CRÉATION sans params.id, le guard résout
  // depuis le corps, donc les deux valeurs coïncident — mais c'est celle que le
  // guard a effectivement AUTORISÉE qu'on écrit, jamais celle que l'appelant a
  // envoyée. La distinction est gratuite ici et le restera si la résolution change.
  async create(dto: CreateProductDto, organizationId: string) {
    const name = dto.name.trim();

    return this.prisma.$transaction(async (tx) => {
      // GUC en première ligne : il couvre le verrou, la recherche de doublon et
      // la création. Le client scopé ne conviendrait pas ici (chaque opération y
      // ouvrirait sa propre transaction, le verrou consultatif serait relâché).
      await setOrganizationScope(tx, organizationId);

      // $executeRaw, jamais $queryRaw — voir CustomersService.create().
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`product:${organizationId}:${name.toLowerCase()}`}))`;

      const existingMatch = await tx.product.findFirst({
        where: {
          organizationId,
          name: { equals: name, mode: "insensitive" },
        },
      });

      return tx.product.create({
        data: {
          organizationId,
          name,
          possibleDuplicateOf: existingMatch?.id ?? null,
        },
      });
    });
  }

  // E6, ADR-084 — "la création du produit n'est jamais bloquée en son
  // absence" : ce endpoint est le seul chemin qui renseigne costPrice.
  async setCostPrice(productId: string, costPrice: bigint, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    // Lecture scopée AVANT l'écriture : update() exige un `where` unique et ne
    // peut donc pas porter la colonne de scope. Cette lecture est la barrière
    // tant que les politiques dorment (même discipline que CustomersService).
    await scoped.product.findFirstOrThrow({ where: { id: productId, organizationId } });
    return scoped.product.update({
      where: { id: productId },
      data: { costPrice },
    });
  }

  // Gap produit comblé ici (UI backlog gap) — aucun GET /products n'existait
  // jusqu'ici (seul POST /products, E10). Même convention de pagination que
  // CustomersService.findAllByOrganization (DEFAULT_LIST_PAGE_SIZE=50,
  // MAX_LIST_PAGE_SIZE=100). orderBy name (pas createdAt : Product n'a pas ce
  // champ, contrairement à Customer) — s'appuie sur le nouvel index composite
  // product_organization_id_name_idx.
  async findAllByOrganization(organizationId: string, pagination: { take?: number; skip?: number }) {
    const take = Math.min(pagination.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = pagination.skip ?? 0;
    return organizationScopedClient(this.prisma, organizationId).product.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take,
      skip,
    });
  }

  // Gap produit comblé ici — écran détail produit (UI backlog gap). Même
  // pattern que CustomersService.findOneWithBalance : duplicateOf {id, name}
  // résolu pour afficher un nom lisible du candidat doublon plutôt que le
  // seul UUID possibleDuplicateOf déjà exposé par la liste. Jamais une
  // fusion : ProductsService.merge() n'existe pas (E3, décision actée — la
  // fusion n'est demandée par le Backlog que pour les clients, E4).
  async findOneWithDuplicate(productId: string, organizationId: string) {
    return organizationScopedClient(this.prisma, organizationId).product.findFirstOrThrow({
      where: { id: productId, organizationId },
      include: { duplicateOf: { select: { id: true, name: true } } },
    });
  }
}
