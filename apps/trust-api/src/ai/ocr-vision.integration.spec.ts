import { createHash, randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrismaClient, setOrganizationScope, type PrismaClient } from "@facture-gn/db";
import { OcrValidationService } from "./ocr-validation.service";
import type { OcrVisionProvider } from "./ocr-vision.provider";
import { OcrVisionService } from "./ocr-vision.service";
import type { ScanDocumentDto } from "./dto/scan-document.dto";

// Crash-test d'intégration RÉEL du Hub Vision (ADR-122) — nécessite un Postgres
// JOIGNABLE. Il prouve deux choses qu'aucun test unitaire ne peut prouver :
//
//   1. ÉTANCHÉITÉ. Une PME ne peut ni lire, ni traiter, ni faire insérer un
//      document hors de son organizationScope — et la table ocr_document est
//      bien enrôlée dans le registre RLS (ENABLE + FORCE + politique
//      org_isolation), vérifié dans pg_class / pg_policies, pas supposé.
//   2. INTERCEPTION. Un calcul de taxe faux d'UN centime est arrêté par le
//      serveur : le document passe en DRAFT_PENDING_MANUAL_REVIEW, ses écarts
//      sont persistés, et AUCUNE ligne n'apparaît dans invoice. Ce sont les
//      vraies contraintes et la vraie transaction qui tranchent.
//
// ── SUR LE RÔLE DE CONNEXION ────────────────────────────────────────────────
// En local, DATABASE_URL est le superutilisateur `postgres` : il BYPASSE la
// RLS (rolbypassrls), donc la politique est dormante et seule la double
// clause applicative (organizationId dans chaque where) isole. C'est
// précisément ce que la suite exerce en toutes circonstances. Le test qui
// vérifie la politique ELLE-MÊME endosse le rôle applicatif NOBYPASSRLS
// (facture_app, étape 2 du runbook) par SET LOCAL ROLE le temps d'une
// transaction : pas de second DATABASE_URL, pas de mot de passe, et un vert
// qui prouve quelque chose. Il se dérobe seulement si le rôle n'existe pas.
//
// ── POURQUOI UNE SONDE, ET PAS `describe.runIf(Boolean(DATABASE_URL))` ───────
// Même raison que pdp-invoice.integration.spec.ts : DATABASE_URL est toujours
// défini (packages/db/.env), sa présence ne dit rien de la joignabilité. Le
// SELECT 1 tranche ; la sonde vit dans beforeAll parce qu'un `await` de plus
// haut niveau ne compile pas en CommonJS (TS1378).
//
// ── FLAKE CONNU SOUS CHARGE COMPLÈTE DE LA SUITE ─────────────────────────────
// Ce fichier est correct — aucun bug logique. Confirmé vert en isolation ET en
// run combiné des 5 specs d'intégration Postgres du dépôt ; l'instabilité
// n'apparaît que quand TOUTE la suite trust-api tourne d'un coup (contention
// du pool de connexions Postgres local, pas un problème de CI dimensionnée
// correctement ni de charge normale). Si ce test échoue isolément ou en petit
// groupe, c'est un vrai bug à corriger — ne pas l'imputer à ce flake sans
// d'abord le reproduire hors charge complète.
let baseJoignable = false;

function sha256(contenu: string): string {
  return createHash("sha256").update(contenu).digest("hex");
}

function commande(cliche: string): ScanDocumentDto {
  return {
    // Renseigné pour la forme du DTO : le service n'en lit JAMAIS la valeur.
    organizationId: "00000000-0000-4000-8000-000000000000",
    imageSha256: sha256(cliche),
    storageKey: `scans/test/${cliche}.jpg`,
    mimeType: "image/jpeg",
  };
}

// Carnet pro HT_FIRST, TVA 18 % : 2 × 500 000,00 + 3 × 100 000,00 = 1 300 000,00
// HT ; TVA 234 000,00 ; TTC 1 534 000,00.
const LECTURE_CONFORME = {
  customer: { name: "Boutique Fatoumata" },
  saisieRegime: "HT_FIRST",
  lines: [
    { description: "Sacs de riz 50 kg", quantity: 2, unitPrice: "50000000", lineTotal: "100000000" },
    { description: "Bidons d'huile 20 L", quantity: 3, unitPrice: "10000000", lineTotal: "30000000" },
  ],
  totals: { totalHT: "130000000", totalVAT: "23400000", totalTTC: "153400000" },
};

// Un centime de TVA en trop ; HT + TVA = TTC reste vrai, seule la garde 2 voit.
const LECTURE_TVA_FAUSSE = {
  ...LECTURE_CONFORME,
  totals: { totalHT: "130000000", totalVAT: "23400001", totalTTC: "153400001" },
};

describe("Hub Vision — étanchéité RLS et interception des taxes (Postgres réel)", () => {
  let prisma: PrismaClient;
  let provider: OcrVisionProvider & { extraire: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };
  let service: OcrVisionService;
  let userId: string;
  let orgA: string;
  let orgB: string;

  async function creerOrganisation(nom: string, regimeFiscal: "normal_tva" | "tpu") {
    const org = await prisma.organization.create({
      data: { name: nom, regimeFiscal, legalForm: "commercial", nif: `NIF-OCR-${randomUUID()}` },
    });
    return org.id;
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    try {
      await prisma.$queryRaw`SELECT 1`;
      baseJoignable = true;
    } catch {
      return;
    }

    const user = await prisma.user.create({ data: { name: `Scanneur Madina ${randomUUID()}` } });
    userId = user.id;
    orgA = await creerOrganisation("Boutique A (TVA)", "normal_tva");
    orgB = await creerOrganisation("Voisine B (TPU)", "tpu");

    provider = { extraire: vi.fn().mockResolvedValue({ modelId: "vision-gn-test", sortie: LECTURE_CONFORME }) };
    // La file ocr-pipeline (plan 2026-09-16) n'est PAS exercée par ce test —
    // il couvre le chemin photo (scanner()/traiter()), synchrone, qui n'enfile
    // jamais rien. Un faux Queue suffit à satisfaire le constructeur.
    queue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
    service = new OcrVisionService(prisma, new OcrValidationService(), provider, queue as never);
  });

  beforeEach((contexte) => {
    if (!baseJoignable) {
      contexte.skip();
    }
    provider.extraire.mockClear();
  });

  afterAll(async () => {
    if (!baseJoignable) {
      return;
    }
    const orgs = [orgA, orgB];
    await prisma.ocrDocument.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.invoiceLine.deleteMany({ where: { invoice: { organizationId: { in: orgs } } } });
    await prisma.invoice.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.customer.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // ── 1. La table est bien dans le registre RLS ─────────────────────────────

  it("ocr_document est sous ROW LEVEL SECURITY, FORCÉE, avec la politique org_isolation", async () => {
    const [table] = await prisma.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'ocr_document'`;
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const politiques = await prisma.$queryRaw<{ policyname: string; cmd: string }[]>`
      SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ocr_document'`;
    expect(politiques).toEqual([{ policyname: "org_isolation", cmd: "ALL" }]);
  });

  // ── 2. Chemin nominal, pour avoir de quoi tester l'étanchéité ─────────────

  it("insère un brouillon lié dans l'organisation A quand la lecture est conforme au centime", async () => {
    const resultat = await service.scanner(commande("carnet-A-0001"), orgA, userId);

    expect(resultat.status).toBe("AUTO_INSERTED");
    expect(resultat.invoiceId).not.toBeNull();

    const brouillon = await prisma.invoice.findUniqueOrThrow({
      where: { id: resultat.invoiceId! },
      include: { lines: true, ocrDocument: true },
    });
    expect(brouillon.organizationId).toBe(orgA);
    expect(brouillon.status).toBe("draft");
    expect(brouillon.emissionChannel).toBe("pwa");
    expect(brouillon.totalHt).toBe(BigInt(130_000_000));
    expect(brouillon.totalTva).toBe(BigInt(23_400_000));
    expect(brouillon.totalTtc).toBe(BigInt(153_400_000));
    expect(brouillon.lines).toHaveLength(2);
    expect(brouillon.lines.every((l) => l.saisieRegime === "HT_FIRST" && l.taxRateBps === 1800)).toBe(true);
    // L'ancre d'idempotence est posée : le registre pointe vers ce brouillon.
    expect(brouillon.ocrDocument?.id).toBe(resultat.documentId);
    expect(brouillon.ocrDocument?.status).toBe("AUTO_INSERTED");
  });

  // ── 3. Étanchéité : B ne voit, ne traite, ne fait insérer RIEN chez A ─────

  it("une PME ne peut pas lire un document scanné par une autre organisation (404 générique)", async () => {
    const docA = await prisma.ocrDocument.findFirstOrThrow({ where: { organizationId: orgA } });

    await expect(service.findOne(docA.id, orgB)).rejects.toThrow(NotFoundException);
    // Et la bannette de B ne le liste pas.
    const bannetteB = await service.findAllByOrganization(orgB);
    expect(bannetteB.map((d) => d.id)).not.toContain(docA.id);
  });

  it("une PME ne peut pas faire traiter — donc insérer — un document d'une autre organisation", async () => {
    const docA = await prisma.ocrDocument.findFirstOrThrow({ where: { organizationId: orgA } });
    const facturesAvant = await prisma.invoice.count();

    await expect(
      service.traiter(docA.id, orgB, { modelId: "vision-gn-test", sortie: LECTURE_CONFORME }),
    ).rejects.toThrow(NotFoundException);

    expect(await prisma.invoice.count()).toBe(facturesAvant);
    // Le document de A n'a pas bougé.
    const relu = await prisma.ocrDocument.findUniqueOrThrow({ where: { id: docA.id } });
    expect(relu.organizationId).toBe(orgA);
    expect(relu.status).toBe("AUTO_INSERTED");
  });

  // Le même cliché soumis par B atterrit CHEZ B, jamais chez A : la contrainte
  // d'idempotence est composite avec l'organisation. Et B étant en TPU, la TVA
  // lue sur le papier est un écart — aucun brouillon chez B non plus.
  it("le même cliché soumis par la voisine crée SON registre, dans SON scope, et son régime TPU intercepte la TVA", async () => {
    const resultat = await service.scanner(commande("carnet-A-0001"), orgB, userId);

    expect(resultat.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(resultat.invoiceId).toBeNull();
    expect(resultat.findings).toEqual([
      { code: "TVA_REGIME", chemin: "totals.totalVAT", attendu: "0", constate: "23400000" },
    ]);

    const registres = await prisma.ocrDocument.findMany({
      where: { imageSha256: sha256("carnet-A-0001") },
      orderBy: { receivedAt: "asc" },
    });
    expect(registres.map((r) => r.organizationId)).toEqual([orgA, orgB]);
    expect(await prisma.invoice.count({ where: { organizationId: orgB } })).toBe(0);
  });

  // La politique ELLE-MÊME, sans le filtre applicatif. Le superutilisateur
  // bypasse la RLS ; on endosse donc le rôle applicatif NOBYPASSRLS le temps
  // d'une transaction (SET LOCAL ROLE — permis au superutilisateur, sans mot de
  // passe), on pose le scope B, et on demande la ligne de A par son id SEUL.
  // Si la politique dort, la ligne revient : c'est exactement la fuite que ce
  // test doit voir. Se dérobe seulement si le rôle n'existe pas sur cette base
  // (étape 2 du runbook non jouée).
  it("sous le rôle applicatif FORCE RLS, le scope B ne voit pas la ligne de A même sans filtre explicite", async (contexte) => {
    const [role] = await prisma.$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'facture_app'`;
    if (!role || role.rolbypassrls) {
      contexte.skip();
    }

    const docA = await prisma.ocrDocument.findFirstOrThrow({ where: { organizationId: orgA } });
    const docB = await prisma.ocrDocument.findFirstOrThrow({ where: { organizationId: orgB } });

    const { vuDeB, sienne } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE facture_app`;
      await setOrganizationScope(tx, orgB);
      return {
        vuDeB: await tx.ocrDocument.findFirst({ where: { id: docA.id } }),
        sienne: await tx.ocrDocument.findFirst({ where: { id: docB.id } }),
      };
    });

    expect(vuDeB).toBeNull();
    expect(sienne?.id).toBe(docB.id);
  });

  // ── 4. Interception d'un calcul de taxe erroné ────────────────────────────

  it("un centime de TVA en trop bascule le scan en DRAFT_PENDING_MANUAL_REVIEW, écarts persistés, aucune facture", async () => {
    provider.extraire.mockResolvedValueOnce({ modelId: "vision-gn-test", sortie: LECTURE_TVA_FAUSSE });
    const facturesAvant = await prisma.invoice.count({ where: { organizationId: orgA } });

    const resultat = await service.scanner(commande("carnet-A-0002"), orgA, userId);

    expect(resultat.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(resultat.invoiceId).toBeNull();
    expect(resultat.findings).toEqual([
      { code: "TVA_REGIME", chemin: "totals.totalVAT", attendu: "23400000", constate: "23400001" },
    ]);

    // Ce que la base a retenu — pas seulement ce que le service a rendu.
    const registre = await prisma.ocrDocument.findUniqueOrThrow({ where: { id: resultat.documentId } });
    expect(registre.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(registre.invoiceId).toBeNull();
    expect(registre.reviewFindings).toEqual(resultat.findings);
    expect(registre.totalVatCentimes).toBe(BigInt(23_400_001));
    expect(registre.saisieRegime).toBe("HT_FIRST");
    expect(registre.extraction).toEqual(LECTURE_TVA_FAUSSE);
    expect(registre.modelId).toBe("vision-gn-test");
    expect(registre.processedAt).not.toBeNull();

    expect(await prisma.invoice.count({ where: { organizationId: orgA } })).toBe(facturesAvant);
  });

  it("un rejeu du scan en relecture rend le même verdict sans rappeler le modèle ni rien insérer", async () => {
    const facturesAvant = await prisma.invoice.count({ where: { organizationId: orgA } });

    const rejeu = await service.scanner(commande("carnet-A-0002"), orgA, userId);

    expect(rejeu.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(provider.extraire).not.toHaveBeenCalled();
    expect(await prisma.invoice.count({ where: { organizationId: orgA } })).toBe(facturesAvant);
  });

  // ── 5. Idempotence sous concurrence — la vraie contrainte et le vrai verrou ─

  it("10 scans concurrents du même cliché ne produisent qu'UN registre et qu'UN brouillon", async () => {
    const resultats = await Promise.all(
      Array.from({ length: 10 }, () => service.scanner(commande("carnet-A-0003"), orgA, userId)),
    );

    // Aucune requête n'a échoué, toutes désignent le MÊME document.
    expect(new Set(resultats.map((r) => r.documentId)).size).toBe(1);
    expect(resultats.every((r) => r.status === "AUTO_INSERTED")).toBe(true);

    const registres = await prisma.ocrDocument.findMany({
      where: { organizationId: orgA, imageSha256: sha256("carnet-A-0003") },
    });
    expect(registres).toHaveLength(1);

    // UN SEUL brouillon, et toutes les réponses le désignent : c'est le verrou
    // FOR UPDATE qui a sérialisé les traitements arrivés en RECEIVED.
    expect(new Set(resultats.map((r) => r.invoiceId))).toEqual(new Set([registres[0].invoiceId]));
  });

  // ── 6. Idempotence AUDIO_PWA / WHATSAPP_TEXT — nouveaux index uniques
  // (plan 2026-09-16, OCR multicanal). Complète la section 5 ci-dessus (photo)
  // pour les deux sources neuves, contre le VRAI Postgres et les VRAIES
  // contraintes @@unique([organizationId, audioSha256]) / whatsappMessageId
  // (@unique global) posées par la migration 20260916150000.

  it("l'index unique (organizationId, audioSha256) rejette un doublon brut, indépendamment du repli applicatif du service", async () => {
    const audioSha256 = sha256("note-vocale-doublon-raw");
    await prisma.ocrDocument.create({
      data: { organizationId: orgA, uploadedByUserId: userId, source: "AUDIO_PWA", audioSha256, storageKey: "audio/x.ogg" },
    });

    await expect(
      prisma.ocrDocument.create({
        data: { organizationId: orgA, uploadedByUserId: userId, source: "AUDIO_PWA", audioSha256, storageKey: "audio/y.ogg" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // La même empreinte audio chez la voisine B n'entre jamais en collision —
    // la contrainte est composite avec l'organisation, même précédent qu'imageSha256.
    await expect(
      prisma.ocrDocument.create({
        data: { organizationId: orgB, uploadedByUserId: userId, source: "AUDIO_PWA", audioSha256, storageKey: "audio/z.ogg" },
      }),
    ).resolves.toMatchObject({ organizationId: orgB });
  });

  it("l'index unique GLOBAL sur whatsappMessageId rejette un doublon même à travers deux organisations distinctes", async () => {
    const whatsappMessageId = `wamid.integration-${randomUUID()}`;
    await prisma.ocrDocument.create({
      data: {
        organizationId: orgA,
        uploadedByUserId: userId,
        source: "WHATSAPP_TEXT",
        whatsappMessageId,
        customerPhone: "+224620000001",
        textBrut: "Facture pour Amadou, 1 sac de riz à 500000 GNF",
      },
    });

    // Contrairement à audioSha256/imageSha256, whatsappMessageId N'EST PAS
    // composite avec organizationId (espace d'identifiants de Meta) : la
    // MÊME valeur chez une AUTRE organisation heurte aussi la contrainte.
    await expect(
      prisma.ocrDocument.create({
        data: {
          organizationId: orgB,
          uploadedByUserId: userId,
          source: "WHATSAPP_TEXT",
          whatsappMessageId,
          customerPhone: "+224620000002",
          textBrut: "Facture pour Fatoumata, 1 sac de riz à 500000 GNF",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("recevoirAudio() : rejeu concurrent du même audioSha256 ne produit qu'UN registre AUDIO_PWA (verrou/contrainte réels)", async () => {
    const commandeAudio = {
      organizationId: orgA,
      audioSha256: sha256("note-vocale-concurrente"),
      storageKey: "audio/note-vocale-concurrente.ogg",
      mimeType: "audio/ogg" as const,
    };

    const resultats = await Promise.all(Array.from({ length: 5 }, () => service.recevoirAudio(commandeAudio, orgA, userId)));

    expect(new Set(resultats.map((r) => r.documentId)).size).toBe(1);
    const registres = await prisma.ocrDocument.findMany({
      where: { organizationId: orgA, audioSha256: commandeAudio.audioSha256 },
    });
    expect(registres).toHaveLength(1);
    expect(registres[0].source).toBe("AUDIO_PWA");
  });

  it("recevoirMessageWhatsapp() : rejeu concurrent du même wamid ne produit qu'UN registre WHATSAPP_TEXT (verrou/contrainte réels)", async () => {
    const whatsappMessageId = `wamid.integration-concurrent-${randomUUID()}`;
    const entree = {
      organizationId: orgA,
      uploadedByUserId: userId,
      whatsappMessageId,
      customerPhone: "+224620000003",
      kind: "text" as const,
      texte: "Facture pour Amadou, 1 sac de riz à 500000 GNF",
    };

    const resultats = await Promise.all(Array.from({ length: 5 }, () => service.recevoirMessageWhatsapp(entree)));

    expect(new Set(resultats.map((r) => r.documentId)).size).toBe(1);
    const registres = await prisma.ocrDocument.findMany({ where: { whatsappMessageId } });
    expect(registres).toHaveLength(1);
    expect(registres[0].organizationId).toBe(orgA);
  });

  // ── 7. Étanchéité RLS — vérifiée aussi pour les sources neuves, pas
  // seulement IMAGE_SCAN (blast radius de l'extension du modèle).

  it("une PME ne voit ni ne liste le document AUDIO_PWA/WHATSAPP_TEXT d'une autre organisation", async () => {
    const docAudioA = await prisma.ocrDocument.findFirstOrThrow({ where: { organizationId: orgA, source: "AUDIO_PWA" } });
    const docWhatsappA = await prisma.ocrDocument.findFirstOrThrow({ where: { organizationId: orgA, source: "WHATSAPP_TEXT" } });

    await expect(service.findOne(docAudioA.id, orgB)).rejects.toThrow(NotFoundException);
    await expect(service.findOne(docWhatsappA.id, orgB)).rejects.toThrow(NotFoundException);

    const bannetteB = await service.findAllByOrganization(orgB);
    expect(bannetteB.map((d) => d.id)).not.toContain(docAudioA.id);
    expect(bannetteB.map((d) => d.id)).not.toContain(docWhatsappA.id);
  });
});
