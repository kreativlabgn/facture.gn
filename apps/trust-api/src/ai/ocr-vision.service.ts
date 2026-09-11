import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { OcrDocument, OcrDocumentStatus, Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { resolveTaxRateBps } from "../invoices/tax-regime";
import type { ScanDocumentDto } from "./dto/scan-document.dto";
import { OCR_VISION_PROVIDER, type OcrInference, type OcrVisionProvider } from "./ocr-vision.provider";
import { OcrValidationService, type OcrEcart } from "./ocr-validation.service";
import { ocrExtractionSchema, type OcrExtraction } from "./schemas/ocr-extraction.schema";

// Orchestrateur du Hub Vision (ADR-122) : registre → modèle → double-garde →
// brouillon. Trois invariants, et tout le reste en découle :
//
//   1. L'ORGANISATION VIENT DU GARDE, JAMAIS DU CORPS. `organizationId` est la
//      valeur que RolesGuard a AUTORISÉE (@CurrentOrganizationId). Chaque
//      lecture passe par organizationScopedClient (RLS) ET porte le filtre
//      explicite `organizationId` dans son where — double clause, comme
//      partout ailleurs : le filtre applicatif reste l'isolation réelle tant
//      que la politique peut dormir (rôle propriétaire, base de test), et la
//      politique reste l'isolation réelle si un filtre est un jour oublié.
//
//   2. AUCUN BROUILLON SANS VERDICT CONFORME. Le seul chemin qui crée une
//      Invoice est la branche `conforme: true` de OcrValidationService, dans
//      une transaction qui pose AUSSI le lien ocr_document.invoice_id — même
//      ancre d'idempotence que la passerelle PDP : un crash entre les deux
//      laisserait sinon un brouillon orphelin, et le rejeu en créerait un
//      second.
//
//   3. LE VERDICT EST PERSISTÉ, PAS SEULEMENT RENDU. Un document en
//      DRAFT_PENDING_MANUAL_REVIEW porte ses écarts (reviewFindings) : c'est ce
//      que le commerçant relit, et ce que le support consulte quand il demande
//      « pourquoi ma facture n'est pas passée ».

export type OcrScanResult = {
  documentId: string;
  status: OcrDocumentStatus;
  invoiceId: string | null;
  /** Non null uniquement en DRAFT_PENDING_MANUAL_REVIEW. */
  findings: OcrEcart[] | null;
  /** Non null uniquement en REJECTED. */
  rejectionReason: string | null;
};

// Champs rendus par les lectures — jamais `extraction` ni `storageKey` en
// liste : le premier est volumineux, le second est une clé de stockage qui
// n'a rien à faire dans une réponse de liste.
const PROJECTION_LISTE = {
  id: true,
  status: true,
  invoiceId: true,
  totalHtCentimes: true,
  totalVatCentimes: true,
  totalTtcCentimes: true,
  saisieRegime: true,
  reviewFindings: true,
  rejectionReason: true,
  modelId: true,
  receivedAt: true,
  processedAt: true,
} satisfies Prisma.OcrDocumentSelect;

@Injectable()
export class OcrVisionService {
  private readonly logger = new Logger(OcrVisionService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly validation: OcrValidationService,
    @Inject(OCR_VISION_PROVIDER) private readonly provider: OcrVisionProvider,
  ) {}

  // ── Point d'entrée HTTP : enregistrer, lire, décider ───────────────────────
  async scanner(dto: ScanDocumentDto, organizationId: string, userId: string): Promise<OcrScanResult> {
    const document = await this.enregistrer(dto, organizationId, userId);

    // Un scan déjà tranché (inséré, en relecture, rejeté) se rend tel quel : la
    // PWA qui rejoue après un timeout 3G reçoit la même réponse, sans second
    // brouillon ni second appel au modèle. Seul un RECEIVED — le modèle n'a
    // jamais répondu, ou a échoué — repasse par l'inférence.
    if (document.status !== "RECEIVED") {
      return this.decrire(document);
    }

    const inference = await this.provider.extraire({ storageKey: dto.storageKey, mimeType: dto.mimeType });
    return this.traiter(document.id, organizationId, inference);
  }

  // ── Traitement d'une sortie de modèle — public, exercé sans modèle ─────────
  //
  // C'est ici que vivent la double-garde et l'insertion. Public et détaché de
  // `scanner()` pour être exerçable de bout en bout par le test d'intégration
  // (Postgres réel) sans point d'inférence : la décision serveur ne dépend
  // d'aucune propriété du modèle, seulement de ce qu'il a rendu.
  async traiter(documentId: string, organizationId: string, inference: OcrInference): Promise<OcrScanResult> {
    const scoped = organizationScopedClient(this.prisma, organizationId);

    const document = await scoped.ocrDocument.findFirst({ where: { id: documentId, organizationId } });
    if (!document) {
      // 404 générique — répondre autre chose confirmerait à un tiers que le
      // document existe chez une autre organisation (même oracle que ferme
      // RolesGuard).
      throw new NotFoundException("Document introuvable");
    }
    // Idempotence de l'insertion : un document déjà lié à un brouillon ne
    // repasse jamais par la création, quelle que soit la sortie rejouée.
    if (document.invoiceId) {
      return this.decrire(document);
    }

    const lecture = ocrExtractionSchema.safeParse(inference.sortie);
    if (!lecture.success) {
      // Le modèle a rendu un JSON hors contrat : rien n'a pu être lu, et rien
      // n'est inventé à sa place. Le document est à rescanner ; la raison est
      // persistée en clair pour le support.
      const raison = JSON.stringify(lecture.error.flatten().fieldErrors);
      const rejete = await scoped.ocrDocument.update({
        where: { id: documentId, organizationId },
        data: {
          status: "REJECTED",
          modelId: inference.modelId,
          rejectionReason: `Sortie du modèle hors contrat : ${raison}`,
          processedAt: new Date(),
        },
      });
      this.logger.warn(`Scan ${documentId} rejeté — sortie du modèle ${inference.modelId} hors contrat`);
      return this.decrire(rejete);
    }
    const extraction = lecture.data;

    // Le taux vient du RÉGIME de l'organisation, jamais du papier ni du modèle
    // (C4). C'est la seconde garde : une TVA lue qui ne correspond pas à ce
    // que l'organisation a le droit de facturer est un écart, pas une donnée.
    const organization = await scoped.organization.findFirstOrThrow({
      where: { id: organizationId },
      select: { regimeFiscal: true },
    });
    const taxRateBps = resolveTaxRateBps(organization.regimeFiscal);

    const verdict = this.validation.valider(extraction, taxRateBps);
    const projection = this.projeter(extraction, inference);

    if (!verdict.conforme) {
      const enRelecture = await scoped.ocrDocument.update({
        where: { id: documentId, organizationId },
        data: {
          ...projection,
          status: "DRAFT_PENDING_MANUAL_REVIEW",
          reviewFindings: verdict.ecarts as unknown as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      this.logger.log(
        `Scan ${documentId} en relecture manuelle — ${verdict.ecarts.length} écart(s) : ${verdict.ecarts.map((e) => e.code).join(", ")}`,
      );
      return this.decrire(enRelecture);
    }

    // ── Insertion automatique, LIÉE DANS LA MÊME TRANSACTION ────────────────
    // On n'appelle PAS InvoicesService.createDraft() — délibérément, pour la
    // même raison que la passerelle PDP : createDraft() applique la convention
    // TTC-first du parcours PWA (TTC = Σ quantité × prix, HT/TVA dérivés). Or
    // les trois totaux ici viennent d'être VÉRIFIÉS au centime près contre le
    // régime de l'organisation ; les faire recalculer par un second chemin,
    // c'est risquer qu'ils divergent d'une unité sous un autre arrondi. Les
    // montants écrits sont ceux que la double-garde a validés, jamais d'autres.
    const insere = await this.prisma.$transaction(async (tx) => {
      await setOrganizationScope(tx, organizationId);

      // VERROU DE LIGNE, avant toute écriture. Deux traitements du même
      // document peuvent courir en parallèle — la PWA rejoue son cliché sur
      // une seconde connexion pendant que le premier appel attend encore le
      // modèle ; les deux ont lu invoiceId = null plus haut. Sans ce verrou,
      // chacun créerait SON brouillon : invoice_id est @unique, mais deux
      // factures distinctes ne se heurtent à rien. Le second se bloque ici,
      // relit le lien que le premier vient de poser, et n'insère rien.
      const [verrou] = await tx.$queryRaw<{ invoice_id: string | null }[]>`
        SELECT invoice_id FROM ocr_document
        WHERE id = ${documentId} AND organization_id = ${organizationId}
        FOR UPDATE`;
      if (!verrou) {
        throw new NotFoundException("Document introuvable");
      }
      if (verrou.invoice_id) {
        return tx.ocrDocument.findFirstOrThrow({ where: { id: documentId, organizationId } });
      }

      const customerId = await this.resoudreClient(tx, organizationId, extraction.customer);

      const brouillon = await tx.invoice.create({
        data: {
          organizationId,
          documentType: "invoice",
          // Le cliché vient de la PWA : c'est bien ce canal, pas « api » (réservé
          // aux connecteurs authentifiés par clé, ADR-107).
          emissionChannel: "pwa",
          status: "draft",
          customerId,
          totalHt: verdict.montants.totalHt,
          totalTva: verdict.montants.totalTva,
          totalTtc: verdict.montants.totalTtc,
          amountDue: verdict.montants.totalTtc,
          cadreFacturation: "standard",
          lines: {
            create: extraction.lines.map((ligne) => ({
              description: ligne.description,
              quantity: ligne.quantity,
              unitPrice: ligne.unitPrice,
              taxRateBps,
              // ADR-108 — provenance du prix unitaire, telle que le modèle l'a
              // reconnue et telle que la garde 1 l'a vérifiée. Le rendu PDF lit
              // ce drapeau pour intituler « P.U. HT » ou « P.U. TTC ».
              saisieRegime: extraction.saisieRegime,
            })),
          },
        },
        select: { id: true },
      });

      return tx.ocrDocument.update({
        where: { id: documentId, organizationId },
        data: {
          ...projection,
          status: "AUTO_INSERTED",
          invoiceId: brouillon.id,
          processedAt: new Date(),
        },
      });
    });

    this.logger.log(`Scan ${documentId} inséré automatiquement — brouillon ${insere.invoiceId}`);
    return this.decrire(insere);
  }

  async findOne(documentId: string, organizationId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const document = await scoped.ocrDocument.findFirst({
      where: { id: documentId, organizationId },
      select: { ...PROJECTION_LISTE, extraction: true },
    });
    if (!document) {
      throw new NotFoundException("Document introuvable");
    }
    return document;
  }

  // La bannette : « mes scans, les plus récents d'abord », filtrable par statut
  // (DRAFT_PENDING_MANUAL_REVIEW = ceux qui attendent une main).
  async findAllByOrganization(organizationId: string, filtre: { status?: OcrDocumentStatus } = {}) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    return scoped.ocrDocument.findMany({
      where: { organizationId, ...(filtre.status ? { status: filtre.status } : {}) },
      select: PROJECTION_LISTE,
      orderBy: { receivedAt: "desc" },
      take: 100,
    });
  }

  // ── Registre, idempotent sur (organisation, empreinte) ─────────────────────
  private async enregistrer(dto: ScanDocumentDto, organizationId: string, userId: string): Promise<OcrDocument> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    try {
      return await scoped.ocrDocument.create({
        data: {
          // La valeur AUTORISÉE, jamais dto.organizationId : RolesGuard a déjà
          // établi qu'elles coïncident, et c'est celle-ci qui fait foi.
          organizationId,
          uploadedByUserId: userId,
          imageSha256: dto.imageSha256,
          storageKey: dto.storageKey,
        },
      });
    } catch (error) {
      // Sous RLS forcée Prisma ne peut pas nommer la colonne (target: null) —
      // isUniqueConstraintViolation accepte ce cas, voir prisma-errors.ts. La
      // table n'a que deux contraintes uniques et invoice_id est null à la
      // création : la collision ne peut être que l'empreinte.
      if (!isUniqueConstraintViolation(error, "image_sha256")) {
        throw error;
      }
      const existant = await scoped.ocrDocument.findFirst({
        where: { organizationId, imageSha256: dto.imageSha256 },
      });
      if (!existant) {
        // Collision sans ligne visible : impossible par construction (la
        // contrainte est composite avec organization_id, et ce scope est le
        // sien) — donc un état à faire remonter fort, jamais à masquer.
        throw error;
      }
      return existant;
    }
  }

  private projeter(extraction: OcrExtraction, inference: OcrInference) {
    return {
      modelId: inference.modelId,
      // La sortie BRUTE, telle que reçue — pas l'extraction parsée (dont les
      // BigInt ne se sérialisent pas et dont les clés inconnues ont été
      // élaguées). C'est la pièce à produire quand un commerçant conteste « ce
      // que la machine a lu ».
      extraction: inference.sortie as Prisma.InputJsonValue,
      totalHtCentimes: extraction.totals.totalHT,
      totalVatCentimes: extraction.totals.totalVAT,
      totalTtcCentimes: extraction.totals.totalTTC,
      saisieRegime: extraction.saisieRegime,
    };
  }

  // Même résolution que la passerelle PDP : par NIF s'il y en a un, sinon par
  // libellé, toujours DANS l'organisation. Double clause d'organisation, jamais
  // un findUnique : le scope RLS est posé, mais le filtre explicite reste
  // l'invariant.
  private async resoudreClient(
    tx: Prisma.TransactionClient,
    organizationId: string,
    customer: OcrExtraction["customer"],
  ): Promise<string | null> {
    if (!customer) {
      return null;
    }
    const existant = await tx.customer.findFirst({
      where: customer.nif ? { organizationId, nif: customer.nif } : { organizationId, name: customer.name },
      select: { id: true },
    });
    if (existant) {
      return existant.id;
    }
    const cree = await tx.customer.create({
      data: { organizationId, name: customer.name, nif: customer.nif ?? null },
      select: { id: true },
    });
    return cree.id;
  }

  private decrire(document: OcrDocument): OcrScanResult {
    return {
      documentId: document.id,
      status: document.status,
      invoiceId: document.invoiceId,
      findings:
        document.status === "DRAFT_PENDING_MANUAL_REVIEW" ? (document.reviewFindings as unknown as OcrEcart[]) : null,
      rejectionReason: document.status === "REJECTED" ? document.rejectionReason : null,
    };
  }
}
