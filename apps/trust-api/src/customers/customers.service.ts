import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { CreateCustomerDto } from "./dto/create-customer.dto";
import { DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD } from "./credit-limit-approval";
import { importCustomerRowSchema, type ImportCustomerRowDto } from "./dto/import-customers.dto";
import { isAdvancedCustomerManagementAllowed } from "../common/plan-features-grid";
import { OUTSTANDING_INVOICE_STATUSES } from "../invoices/invoice-status";

type ImportRowResult =
  | { index: number; status: "created"; customerId: string; possibleDuplicateOf: string | null }
  | { index: number; status: "error"; reason: string; input: unknown };

const DEFAULT_LIST_PAGE_SIZE = 50;
const MAX_LIST_PAGE_SIZE = 100;

@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // J2, ADR-116 — une ligne client anonymisée est GELÉE : plus aucune opération
  // métier (fusion, marquage entité publique, limite de crédit) ne s'y applique.
  private assertNotAnonymized(customer: { id: string; anonymizedAt: Date | null }): void {
    if (customer.anonymizedAt) {
      throw new ConflictException(`Client ${customer.id} anonymisé (L/2016/037) — opération impossible`);
    }
  }

  // Sélecteur client (émission de facture) + section "liste des clients"
  // (dashboard) — même plafonnement défensif que InvoicesService.findAllByOrganization,
  // aucun endpoint de liste n'existait jusqu'ici (seul findOne() par id).
  async findAllByOrganization(organizationId: string, pagination: { take?: number; skip?: number }) {
    const take = Math.min(pagination.take ?? DEFAULT_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE);
    const skip = pagination.skip ?? 0;
    // `where.organizationId` est CONSERVÉ : les politiques sont dormantes et le
    // rôle applicatif possède les tables, donc contourne RLS. Le retirer rendrait
    // les clients de toutes les organisations.
    return organizationScopedClient(this.prisma, organizationId).customer.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
  }

  // E3, ADR-038 — même filet de sécurité qu'importCustomers() (E9), appliqué ici au chemin
  // unitaire : peu importe qu'une création soit "en direct" ou rejouée après une coupure
  // réseau (le scénario offline concret de cette story), les deux traversent ce même
  // endpoint et doivent recevoir le même dédoublonnage par téléphone. Contre la base
  // existante de l'organisation uniquement (pas de "lot en cours" ici, une seule ligne)
  // — jamais de fusion automatique, juste le signal possibleDuplicateOf pour résolution
  // manuelle ultérieure (merge(), E4).
  //
  // Cross-Story Audit 2026-08-24, finding #3 MOYENNE-HAUTE (verrou consultatif) —
  // pg_advisory_xact_lock(hashtext(...)) posé AVANT le findFirst, sur une clé
  // dérivée de organizationId+phone : sérialise les créations concurrentes pour
  // LE MÊME téléphone (la seconde attend que la première commite son
  // findFirst+create, voit alors le nouvel enregistrement et pose correctement
  // possibleDuplicateOf) sans jamais bloquer deux créations pour des téléphones
  // différents (hash différent → verrous différents, indépendants). `_xact_` :
  // relâché automatiquement à la fin de CETTE transaction (commit ou rollback),
  // jamais besoin d'un unlock explicite. Remplace la limite précédente
  // (findFirst+create simplement englobés dans $transaction(), qui ne changeait
  // rien sous isolation Read Committed — voir historique de ce commentaire) :
  // un verrou consultatif n'est pas soumis à l'isolation des transactions,
  // c'est un mécanisme de sérialisation explicite orthogonal à MVCC. Toujours
  // pas une contrainte unique DB (ADR-038 l'exclut explicitement — deux clients
  // légitimement différents PEUVENT partager un téléphone, ce n'est qu'un
  // SIGNAL) : le verrou ne fait que garantir que le signal est posé de façon
  // fiable sous course réelle, jamais qu'une seule ligne peut exister pour ce
  // téléphone.
  // L'organisation vient du DTO — aucun paramètre à ajouter.
  async create(dto: CreateCustomerDto) {
    const organizationId = dto.organizationId;
    return this.prisma.$transaction(async (tx) => {
      // RLS (rls-rollout.md, étape 1) — première ligne du bloc : le client scopé
      // ouvrirait une transaction imbriquée par opération.
      await setOrganizationScope(tx, organizationId);

      if (dto.phone) {
        // $executeRaw et non $queryRaw : pg_advisory_xact_lock() renvoie void, et
        // $queryRaw tente de désérialiser les colonnes du résultat — « Failed to
        // deserialize column of type 'void' », donc un 500 systématique. Même
        // raison que le set_config() de packages/db/src/rls.ts.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${dto.organizationId}:${dto.phone}`}))`;
      }

      const existingMatch = dto.phone
        ? await tx.customer.findFirst({
            // J2, ADR-116 — une ligne anonymisée est GELÉE : jamais un candidat
            // de dédoublonnage, jamais une cible de possibleDuplicateOf.
            where: { organizationId: dto.organizationId, phone: dto.phone, anonymizedAt: null },
          })
        : null;

      return tx.customer.create({
        data: {
          organizationId: dto.organizationId,
          name: dto.name,
          phone: dto.phone,
          nif: dto.nif,
          creditLimit: dto.creditLimit,
          // undefined → Prisma applique le défaut schema ("sms"), jamais dupliqué ici.
          notificationChannel: dto.notificationChannel,
          possibleDuplicateOf: existingMatch?.id ?? null,
        },
      });
    });
  }

  // C6, ADR-039 — running_balance n'est jamais stocké : agrégé à la demande sur
  // les factures encore dues (issued/partially_paid). paid/voided/draft exclus
  // (respectivement soldée, sans effet, ou pas encore une dette réelle).
  //
  // E4/E9, ADR-038 — écran détail client (UI, backlog gap) : duplicateOf
  // {id, name} résolu ici pour afficher un nom lisible du candidat doublon
  // plutôt que le seul UUID possibleDuplicateOf déjà exposé par la liste.
  // Jamais une fusion : uniquement la lecture nécessaire à la résolution
  // manuelle via merge() (E4) depuis cet écran.
  async findOneWithBalance(customerId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const customer = await scoped.customer.findFirstOrThrow({
      where: { id: customerId, organizationId },
      include: { duplicateOf: { select: { id: true, name: true } } },
    });
    // L'agrégat porte aussi le filtre organisation : un solde calculé sur les
    // factures d'un autre locataire serait faux ET révélateur.
    const aggregate = await scoped.invoice.aggregate({
      where: { customerId, organizationId, status: { in: [...OUTSTANDING_INVOICE_STATUSES] } },
      _sum: { amountDue: true },
    });

    return { ...customer, runningBalance: aggregate._sum.amountDue ?? 0n };
  }

  // F16, ADR-105 — "sans elle, le portail Niveau 2 déjà V1 n'aurait
  // structurellement aucune facture à présenter à un DAF". publicBuyerAccountId
  // vérifié explicitement (jamais une simple FK muette) : une PME ne doit pas
  // pouvoir rattacher un client à un compte acheteur public inexistant.
  async flagPublicEntity(customerId: string, publicBuyerAccountId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    // public_buyer_account n'est PAS sous politique org_isolation (table globale
    // des acheteurs publics, partagée entre organisations) : lecture non scopée
    // à dessein, pas un oubli.
    const publicBuyerAccount = await this.prisma.publicBuyerAccount.findUnique({
      where: { id: publicBuyerAccountId },
    });
    if (!publicBuyerAccount) {
      throw new NotFoundException(`Compte acheteur public ${publicBuyerAccountId} introuvable`);
    }
    this.assertNotAnonymized(
      await scoped.customer.findFirstOrThrow({ where: { id: customerId, organizationId } }),
    );

    // Security Audit 2026-08-23, finding #13 — isPublicEntityConfirmed toujours
    // remis à false ici, même en cas de re-pointage vers un autre compte : la
    // confirmation appartient exclusivement au compte CIBLÉ
    // (PublicBuyerPortalService.confirmCustomerLink()), jamais acquise par la
    // seule initiative de la PME qui pose ce lien.
    //
    // Security Audit 2026-08-23, revue post-fix #1 (finding #1 CRITIQUE) — sans
    // la réinitialisation d'Invoice.validatedByAdministration ci-dessous, une
    // validation obtenue sous l'ANCIEN rattachement (même frauduleuse, via un
    // faux compte auto-créé désormais bloqué par validateLiquidation()) restait
    // valable après un repointage vers un vrai compte déjà "verified" — exactement
    // le contournement du finding critique. Une validation appartient au lien
    // customer<->publicBuyerAccount qui l'a produite, jamais transférable à un
    // nouveau lien sans repasser par une vraie validation.
    return this.prisma.$transaction(async (tx) => {
      // RLS (rls-rollout.md, étape 1) — première ligne du bloc : le client scopé
      // ouvrirait une transaction imbriquée par opération.
      await setOrganizationScope(tx, organizationId);

      // update par id, à travers le client scopé : la lecture juste au-dessus a
      // déjà établi l'appartenance avec { id, organizationId }, et
      // Customer.organizationId est immuable. Un updateMany + relecture
      // n'ajouterait pas de barrière, seulement un aller-retour et une valeur de
      // retour reconstruite.
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { isPublicEntity: true, publicBuyerAccountId, isPublicEntityConfirmed: false },
      });
      await tx.invoice.updateMany({
        where: { customerId, organizationId, validatedByAdministration: true },
        data: { validatedByAdministration: false },
      });
      return customer;
    });
  }

  // E4, ADR-038 — "jamais de fusion automatique, résolution manuelle" : cette
  // méthode EST la résolution manuelle (un admin/owner choisit explicitement les
  // deux fiches). Organisation vérifiée par comparaison directe des deux
  // organizationId chargés, jamais un paramètre transmis par l'appelant.
  async merge(canonicalCustomerId: string, duplicateCustomerId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    if (canonicalCustomerId === duplicateCustomerId) {
      throw new ConflictException("Impossible de fusionner un client avec lui-même");
    }

    // Les deux lectures et le contrôle d'appartenance ci-dessous sont conservés :
    // le message distingue « introuvable » de « autre organisation », nuance que
    // le scope seul écraserait.
    const canonical = await scoped.customer.findFirstOrThrow({
      where: { id: canonicalCustomerId, organizationId },
    });
    const duplicate = await scoped.customer.findFirst({ where: { id: duplicateCustomerId, organizationId } });
    if (!duplicate || duplicate.organizationId !== canonical.organizationId) {
      throw new ConflictException(`Client ${duplicateCustomerId} introuvable pour cette organisation`);
    }
    this.assertNotAnonymized(canonical);
    this.assertNotAnonymized(duplicate);

    // H1, Grille §2 — "gestion client avancée" (merge doublons + credit_limit)
    // dépend structurellement du rôle approver (ADR-083, Pro+ uniquement).
    const organization = await scoped.organization.findUniqueOrThrow({
      where: { id: canonical.organizationId },
    });
    if (!isAdvancedCustomerManagementAllowed(organization.commercialTier)) {
      throw new ForbiddenException(
        `La fusion de clients nécessite le palier pro ou supérieur (palier actuel : ${organization.commercialTier})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // RLS (rls-rollout.md, étape 1) — première ligne du bloc : le client scopé
      // ouvrirait une transaction imbriquée par opération.
      await setOrganizationScope(tx, organizationId);

      await tx.invoice.updateMany({
        where: { customerId: duplicateCustomerId, organizationId },
        data: { customerId: canonicalCustomerId },
      });
      // La fusion est irréversible — l'écriture la plus dangereuse de ce
      // service. L'appartenance des DEUX clients a été vérifiée plus haut, sur
      // des lectures scopées, et le message distingue explicitement « autre
      // organisation » de « introuvable ».
      await tx.customer.delete({ where: { id: duplicateCustomerId } });
      return tx.customer.findFirstOrThrow({ where: { id: canonicalCustomerId, organizationId } });
    });
  }

  // E5, ADR-083 — "toute augmentation au-delà d'un seuil exige une validation
  // approver, jamais une décision unilatérale". Une baisse, ou une hausse sous
  // le seuil, s'applique immédiatement (admin/owner) : seul le dépassement
  // déclenche la mise en attente, jamais l'égalité au seuil lui-même.
  async proposeCreditLimit(
    customerId: string,
    newLimit: bigint,
    requestedByUserId: string,
    organizationId: string,
  ) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const customer = await scoped.customer.findFirstOrThrow({ where: { id: customerId, organizationId } });
    this.assertNotAnonymized(customer);
    const organization = await scoped.organization.findUniqueOrThrow({
      where: { id: customer.organizationId },
    });
    // H1, Grille §2 — même garde que merge(), "gestion client avancée" Pro+.
    if (!isAdvancedCustomerManagementAllowed(organization.commercialTier)) {
      throw new ForbiddenException(
        `La gestion de limite de crédit nécessite le palier pro ou supérieur (palier actuel : ${organization.commercialTier})`,
      );
    }
    const currentLimit = customer.creditLimit ?? 0n;
    const threshold = organization.creditLimitApprovalThreshold ?? DEFAULT_CREDIT_LIMIT_APPROVAL_THRESHOLD;
    const increase = newLimit - currentLimit;

    if (increase <= threshold) {
      // update par id, à travers le client scopé : la lecture juste au-dessus a
      // déjà établi l'appartenance avec { id, organizationId }, et
      // Customer.organizationId est immuable. Un updateMany + relecture
      // n'ajouterait pas de barrière, seulement un aller-retour et une valeur de
      // retour reconstruite.
      return scoped.customer.update({ where: { id: customerId }, data: { creditLimit: newLimit } });
    }

    return scoped.creditLimitChangeRequest.create({
      data: {
        customerId,
        organizationId: customer.organizationId,
        requestedByUserId,
        currentLimit,
        requestedLimit: newLimit,
      },
    });
  }

  // Même pattern qu'AuthService.resolveRecovery() (auth.service.ts) : transaction
  // updateMany filtrée sur status="pending" pour la sécurité de concurrence, et
  // interdiction que le demandeur résolve sa propre demande — c'est le sens même
  // de "jamais une décision unilatérale" (ADR-083). RolesGuard (@Roles("approver"))
  // garantit déjà le rôle du résolveur en amont, jamais revérifié ici.
  async resolveCreditLimitRequest(
    requestId: string,
    resolverUserId: string,
    decision: "approved" | "rejected",
    organizationId: string,
  ) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const request = await scoped.creditLimitChangeRequest.findFirstOrThrow({
      where: { id: requestId, organizationId },
    });

    if (request.requestedByUserId === resolverUserId) {
      throw new ConflictException("Vous ne pouvez pas résoudre votre propre demande de hausse de limite de crédit");
    }

    const resolvedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // RLS (rls-rollout.md, étape 1) — première ligne du bloc : le client scopé
      // ouvrirait une transaction imbriquée par opération.
      await setOrganizationScope(tx, organizationId);

      const claimed = await tx.creditLimitChangeRequest.updateMany({
        where: { id: requestId, organizationId, status: "pending" },
        data: { status: decision, resolvedAt, resolvedByUserId: resolverUserId },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Demande ${requestId} a déjà été résolue`);
      }

      if (decision === "approved") {
        // J2, ADR-116 — re-lu DANS la transaction : une demande en attente peut
        // avoir été créée AVANT l'anonymisation du client, et l'anonymisation
        // peut commiter entre le début de cette transaction et l'update.
        // L'approuver ré-écrirait `creditLimit` sur une ligne gelée, défaisant
        // l'effacement. Refuser (le rejet, lui, a déjà été posé ci-dessus).
        this.assertNotAnonymized(
          await tx.customer.findFirstOrThrow({
            where: { id: request.customerId, organizationId },
            select: { id: true, anonymizedAt: true },
          }),
        );
        // Même raison qu'ailleurs : la relecture scopée ci-dessus a déjà
        // établi l'appartenance.
        await tx.customer.update({ where: { id: request.customerId }, data: { creditLimit: request.requestedLimit } });
      }

      return { ...request, status: decision, resolvedAt, resolvedByUserId: resolverUserId };
    });
  }

  // E9, ADR-100 — chaque ligne traitée indépendamment (jamais de transaction
  // globale) : une ligne invalide ne doit jamais bloquer les autres. Dédoublonnage
  // par téléphone contre la base ET contre le lot en cours, jamais bloquant —
  // création systématique, possibleDuplicateOf renseigné pour résolution manuelle
  // ultérieure (merge(), E4), jamais de fusion automatique.
  async importCustomers(organizationId: string, rows: unknown[]): Promise<ImportRowResult[]> {
    const results: ImportRowResult[] = [];
    const parsedRows: { index: number; data: ImportCustomerRowDto }[] = [];
    const phonesInPayload = new Set<string>();

    rows.forEach((row, index) => {
      const parsed = importCustomerRowSchema.safeParse(row);
      if (!parsed.success) {
        results[index] = {
          index,
          status: "error",
          reason: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
          input: row,
        };
        return;
      }
      parsedRows.push({ index, data: parsed.data });
      if (parsed.data.phone) {
        phonesInPayload.add(parsed.data.phone);
      }
    });

    const existingMatches =
      phonesInPayload.size > 0
        ? await organizationScopedClient(this.prisma, organizationId).customer.findMany({
            // J2, ADR-116 — exclut les lignes anonymisées (gelées) du dédoublonnage.
            where: { organizationId, phone: { in: [...phonesInPayload] }, anonymizedAt: null },
          })
        : [];
    const phoneToExistingCustomerId = new Map(
      existingMatches.filter((c) => c.phone).map((c) => [c.phone as string, c.id]),
    );
    const phoneToBatchCustomerId = new Map<string, string>();

    for (const { index, data } of parsedRows) {
      const possibleDuplicateOf = data.phone
        ? phoneToBatchCustomerId.get(data.phone) ?? phoneToExistingCustomerId.get(data.phone) ?? null
        : null;

      const customer = await organizationScopedClient(this.prisma, organizationId).customer.create({
        data: {
          organizationId,
          name: data.name,
          phone: data.phone,
          nif: data.nif,
          creditLimit: data.creditLimit,
          notificationChannel: data.notificationChannel,
          possibleDuplicateOf,
        },
      });

      // .has() avant .set() : garde la PREMIÈRE occurrence du téléphone dans le lot
      // comme cible unique — sans cette garde, 3 lignes partageant le même
      // téléphone formeraient une chaîne (ligne3→ligne2→ligne1) au lieu que
      // toutes pointent vers la première occurrence.
      if (data.phone && !phoneToBatchCustomerId.has(data.phone)) {
        phoneToBatchCustomerId.set(data.phone, customer.id);
      }

      results[index] = { index, status: "created", customerId: customer.id, possibleDuplicateOf };
    }

    return results;
  }
}
