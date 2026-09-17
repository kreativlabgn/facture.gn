import { Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import type { OcrDocument, OcrDocumentStatus, Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { isUniqueConstraintViolation } from "../common/prisma-errors";
import { resolveTaxRateBps } from "../invoices/tax-regime";
import type { CustomersService } from "../customers/customers.service";
import type { ScanDocumentDto } from "./dto/scan-document.dto";
import type { ScanAudioDto } from "./dto/scan-audio.dto";
import { emissionChannelForSource } from "./ocr-document-source";
import { OCR_PIPELINE_JOBS, OCR_PIPELINE_JOB_OPTIONS, OCR_PIPELINE_QUEUE, type OcrPipelineJobPayload } from "./ocr-pipeline.constants";
import { OCR_VISION_PROVIDER, type OcrInference, type OcrVisionProvider } from "./ocr-vision.provider";
import { OcrValidationService, type OcrEcart } from "./ocr-validation.service";
import { ocrExtractionSchema, type OcrExtraction } from "./schemas/ocr-extraction.schema";

// Plan 2026-09-16 (OCR multicanal), étape 2 — ce que recevoirMessageWhatsapp()
// accepte du guichet WhatsApp (whatsapp/whatsapp-inbound.service.ts), APRÈS
// résolution d'expéditeur, opt-in et anti-abus : jamais construit ailleurs.
export type RecevoirMessageWhatsappInput = {
  organizationId: string;
  uploadedByUserId: string;
  /** wamid Meta — idempotence, @unique GLOBAL sur ocr_document. */
  whatsappMessageId: string;
  /** Numéro de l'expéditeur (msisdn), déjà vérifié par le guichet WhatsApp. */
  customerPhone: string;
} & (
  | { kind: "text"; texte: string }
  | { kind: "audio"; storageKey: string; mimeType: string }
);

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
  // Additif (plan 2026-09-16, OCR multicanal) — pour un futur front qui doit
  // savoir afficher le badge de source (photo/vocal/WhatsApp) et citer le
  // texte source d'une note vocale ou d'un message WhatsApp (OcrReviewAlert).
  source: true,
  textBrut: true,
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
    @InjectQueue(OCR_PIPELINE_QUEUE) private readonly pipelineQueue: Queue<OcrPipelineJobPayload>,
    // Plan 2026-09-16 (OCR multicanal), étape 2 — EN DERNIÈRE POSITION et
    // @Optional(), même précédent que ReferralsService dans
    // OrganizationsService : les tests de ce fichier construisent le service
    // positionnellement, l'insérer plus haut décalerait tous leurs arguments.
    // Absent, la résolution du client par numéro WhatsApp (traiter()) est
    // simplement sautée — repli sur le comportement historique
    // (extraction.customer seul). En application complète, CustomersModule
    // étant importé par AiModule, le service est injecté.
    @Optional() private readonly customers?: CustomersService,
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

  // ── Point d'entrée HTTP : AUDIO_PWA, ASYNCHRONE (plan 2026-09-16) ──────────
  //
  // N'APPELLE AUCUN PROVIDER — contrairement à scanner(). Le budget d'une
  // requête HTTP tiendrait mal DEUX appels réseau séquentiels (transcription
  // PUIS extraction, clarification 4 du plan) sur la 3G dégradée précisément
  // visée par l'usage "dicter au micro". Le rôle de cette méthode s'arrête à
  // l'accusé de réception : enregistrer, puis enfiler TRANSCRIBE_AND_EXTRACT
  // sur la file ocr-pipeline — OcrPipelineProcessor fait le reste.
  async recevoirAudio(dto: ScanAudioDto, organizationId: string, userId: string): Promise<OcrScanResult> {
    const document = await this.enregistrerAudio(dto, organizationId, userId);

    // Même garde que scanner() : un document déjà tranché (inséré, en
    // relecture, rejeté — y compris REJECTED par épuisement des tentatives,
    // clarification 3) se rend tel quel, sans second enregistrement ni second
    // enfilement. Seul un RECEIVED — jamais traité, ou dont l'enfilement
    // précédent a échoué (Redis injoignable) — réenfile.
    if (document.status !== "RECEIVED") {
      return this.decrire(document);
    }

    try {
      await this.pipelineQueue.add(
        OCR_PIPELINE_JOBS.TRANSCRIBE_AND_EXTRACT,
        { documentId: document.id, organizationId, mimeType: dto.mimeType },
        { ...OCR_PIPELINE_JOB_OPTIONS },
      );
    } catch (error) {
      // 503 SYNCHRONE — c'est le seul endroit du pipeline audio où la requête
      // d'origine peut encore répondre (clarification 3) : le document reste
      // RECEIVED, non lié à aucun job, et rejouer la MÊME requête (même
      // audioSha256) retombe ici et réenfile.
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Échec d'enfilement de la note vocale ${document.id} — Redis injoignable`, err.stack ?? err.message);
      throw new ServiceUnavailableException("Impossible d'enfiler la note vocale pour traitement — la requête est à rejouer");
    }

    this.logger.log(`Note vocale ${document.id} enregistrée et enfilée — organisation ${organizationId}`);
    return this.decrire(document);
  }

  // ── Point d'entrée guichet WhatsApp : WHATSAPP_TEXT/WHATSAPP_VOICE ─────────
  // (plan 2026-09-16, étape 2) — appelé UNIQUEMENT par
  // whatsapp/whatsapp-inbound.service.ts, APRÈS résolution d'expéditeur,
  // opt-in (organization.whatsappOcrEnabled) et anti-abus : cette méthode ne
  // revérifie RIEN de tout cela, elle fait confiance à son appelant exactement
  // comme recevoirAudio() fait confiance à RolesGuard.
  //
  // ASYNCHRONE, même raisonnement que recevoirAudio() : un texte enfile
  // EXTRACT_FROM_TEXT (pas de transcription à attendre), un audio enfile
  // TRANSCRIBE_AND_EXTRACT (le même job qu'AUDIO_PWA, réutilisé tel quel).
  //
  // IDEMPOTENTE sur whatsappMessageId — Meta relivre un webhook si notre
  // réponse HTTP n'est pas arrivée à temps ; enregistrerWhatsapp() ci-dessous
  // porte cette garantie au niveau base (contrainte @unique), pas seulement au
  // niveau du guichet appelant (défense en profondeur).
  async recevoirMessageWhatsapp(input: RecevoirMessageWhatsappInput): Promise<OcrScanResult> {
    const document = await this.enregistrerWhatsapp(input);

    // Même garde que scanner()/recevoirAudio() : un document déjà tranché se
    // rend tel quel, sans second enregistrement ni second enfilement.
    if (document.status !== "RECEIVED") {
      return this.decrire(document);
    }

    const jobName = input.kind === "text" ? OCR_PIPELINE_JOBS.EXTRACT_FROM_TEXT : OCR_PIPELINE_JOBS.TRANSCRIBE_AND_EXTRACT;
    try {
      await this.pipelineQueue.add(
        jobName,
        { documentId: document.id, organizationId: input.organizationId, mimeType: input.kind === "audio" ? input.mimeType : undefined },
        { ...OCR_PIPELINE_JOB_OPTIONS },
      );
    } catch (error) {
      // 503 SYNCHRONE — même contrat que recevoirAudio() : le document reste
      // RECEIVED, non lié à aucun job. Contrairement au chemin PWA, la
      // requête d'ORIGINE ici est le webhook Meta lui-même : un 503 à ce
      // stade fait échouer whatsapp-inbound.controller.ts, dont Meta relivra
      // le webhook — même mécanisme de rejeu, porté par Meta plutôt que par
      // l'utilisateur.
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Échec d'enfilement du message WhatsApp ${document.id} — Redis injoignable`, err.stack ?? err.message);
      throw new ServiceUnavailableException("Impossible d'enfiler le message WhatsApp pour traitement — la requête est à rejouer");
    }

    this.logger.log(`Message WhatsApp ${document.id} enregistré et enfilé — organisation ${input.organizationId}`);
    return this.decrire(document);
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

    // ── Repli WhatsApp : le numéro de l'expéditeur, jamais prioritaire ──────
    // Plan 2026-09-16, étape 2. document.customerPhone n'est posé QUE pour
    // WHATSAPP_TEXT/WHATSAPP_VOICE (nul pour IMAGE_SCAN/AUDIO_PWA, donc ce
    // bloc est un no-op pour le chemin photo). Quand le modèle a explicitement
    // déclaré un client (nom, NIF) dans le message, cette déclaration reste la
    // source la plus fiable : le numéro identifie le MEMBRE qui a dicté le
    // message, pas nécessairement l'acheteur facturé. Ce n'est donc qu'un
    // REPLI, résolu ICI, AVANT la transaction d'insertion — resolveByPhone()
    // (customers.service.ts) ouvre SA PROPRE transaction (verrou consultatif) ;
    // l'appeler DANS le $transaction ci-dessous imbriquerait deux transactions
    // interactives sur la même connexion, ce que Prisma ne supporte pas
    // correctement (risque de blocage derrière le verrou FOR UPDATE posé plus
    // bas). @Optional() : sans CustomersService injecté (tests unitaires qui
    // construisent le service sans ce dernier argument), ce repli est
    // simplement sauté — comportement historique inchangé.
    const clientWhatsapp =
      !extraction.customer && document.customerPhone && this.customers
        ? await this.customers.resolveByPhone(organizationId, document.customerPhone)
        : null;

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

      // clientWhatsapp, déjà résolu plus haut (repli, jamais prioritaire),
      // prime sur resoudreClient() UNIQUEMENT parce qu'il n'est jamais posé
      // quand extraction.customer existe (voir le bloc de résolution ci-dessus) —
      // ce n'est donc jamais un écrasement d'un client explicitement déclaré.
      const customerId = clientWhatsapp ? clientWhatsapp.id : await this.resoudreClient(tx, organizationId, extraction.customer);

      const brouillon = await tx.invoice.create({
        data: {
          organizationId,
          documentType: "invoice",
          // Plan 2026-09-16 (OCR multicanal) — le canal dépend de LA SOURCE du
          // document (photo/dictée PWA vs message WhatsApp), jamais un
          // littéral en dur : emissionChannelForSource() est la fonction pure
          // qui porte cette décision, exhaustive sur OcrDocumentSource. Jamais
          // « api » (réservé aux connecteurs authentifiés par clé, ADR-107).
          emissionChannel: emissionChannelForSource(document.source),
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

  // ── Registre AUDIO_PWA, idempotent sur (organisation, empreinte) ──────────
  //
  // Même patron exact qu'enregistrer() — PAS d'appel provider ici,
  // contrairement au chemin photo : ce registre est ce qui rend
  // recevoirAudio() idempotent sur un rejeu du même audioSha256.
  private async enregistrerAudio(dto: ScanAudioDto, organizationId: string, userId: string): Promise<OcrDocument> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    try {
      return await scoped.ocrDocument.create({
        data: {
          organizationId,
          uploadedByUserId: userId,
          source: "AUDIO_PWA",
          audioSha256: dto.audioSha256,
          storageKey: dto.storageKey,
        },
      });
    } catch (error) {
      // Même repli que enregistrer() : sous RLS forcée, Prisma ne peut pas
      // nommer la colonne en conflit (target: null) — isUniqueConstraintViolation
      // l'accepte. La table porte deux contraintes uniques sur une empreinte
      // (image_sha256, audio_sha256) : la colonne nommée ici lève l'ambiguïté
      // pour les tests, la production retombe sur le repli documenté.
      if (!isUniqueConstraintViolation(error, "audio_sha256")) {
        throw error;
      }
      const existant = await scoped.ocrDocument.findFirst({
        where: { organizationId, audioSha256: dto.audioSha256 },
      });
      if (!existant) {
        throw error;
      }
      return existant;
    }
  }

  // ── Registre WHATSAPP_TEXT/WHATSAPP_VOICE, idempotent sur whatsappMessageId ─
  // (plan 2026-09-16, étape 2) — PAS d'appel provider ici (comme
  // enregistrerAudio()) : la branche texte pose textBrut DIRECTEMENT (aucune
  // transcription à attendre), la branche audio pose storageKey (la
  // transcription est le rôle d'OcrPipelineService, via TRANSCRIBE_AND_EXTRACT).
  private async enregistrerWhatsapp(input: RecevoirMessageWhatsappInput): Promise<OcrDocument> {
    const scoped = organizationScopedClient(this.prisma, input.organizationId);
    try {
      return await scoped.ocrDocument.create({
        data: {
          organizationId: input.organizationId,
          uploadedByUserId: input.uploadedByUserId,
          source: input.kind === "text" ? "WHATSAPP_TEXT" : "WHATSAPP_VOICE",
          whatsappMessageId: input.whatsappMessageId,
          customerPhone: input.customerPhone,
          ...(input.kind === "text" ? { textBrut: input.texte } : { storageKey: input.storageKey }),
        },
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error, "whatsapp_message_id")) {
        throw error;
      }
      // whatsapp_message_id est UNIQUE GLOBAL (schema.prisma) — pas composite
      // avec organizationId, contrairement à image_sha256/audio_sha256 : la
      // relecture porte donc sur le CLIENT NON SCOPÉ (même raisonnement que
      // organizations.service.ts pour les collisions NIF/RCCM/eTax GLOBALES).
      // Aucune fuite inter-tenant : cette valeur n'est jamais fournie par un
      // appelant, seulement par notre propre guichet WhatsApp après
      // vérification de signature (voir la migration 20260916150000).
      const existant = await this.prisma.ocrDocument.findUnique({
        where: { whatsappMessageId: input.whatsappMessageId },
      });
      if (!existant) {
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
