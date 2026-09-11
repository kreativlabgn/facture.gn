import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OcrValidationService } from "./ocr-validation.service";
import { UnconfiguredOcrVisionProvider, type OcrVisionProvider } from "./ocr-vision.provider";
import { OcrVisionService } from "./ocr-vision.service";
import type { ScanDocumentDto } from "./dto/scan-document.dto";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "user-1";
const DOC_ID = "doc-1";
const SHA = "a".repeat(64);

const COMMANDE: ScanDocumentDto = {
  organizationId: ORG,
  imageSha256: SHA,
  storageKey: "scans/2026/09/carnet-0042.jpg",
  mimeType: "image/jpeg",
};

// Sortie de modèle conforme : carnet HT_FIRST, TVA 18 %.
const SORTIE_CONFORME = {
  customer: { name: "Boutique Fatoumata", nif: "123456789" },
  saisieRegime: "HT_FIRST",
  lines: [
    { description: "Sacs de riz 50 kg", quantity: 2, unitPrice: "50000000", lineTotal: "100000000" },
    { description: "Bidons d'huile 20 L", quantity: 3, unitPrice: "10000000", lineTotal: "30000000" },
  ],
  totals: { totalHT: "130000000", totalVAT: "23400000", totalTTC: "153400000" },
};

// Un centime de TVA en trop.
const SORTIE_ECART = {
  ...SORTIE_CONFORME,
  totals: { totalHT: "130000000", totalVAT: "23400001", totalTTC: "153400001" },
};

const INFERENCE = (sortie: unknown) => ({ modelId: "vision-gn-v1", sortie });

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    organizationId: ORG,
    uploadedByUserId: USER,
    imageSha256: SHA,
    storageKey: COMMANDE.storageKey,
    status: "RECEIVED",
    invoiceId: null,
    reviewFindings: null,
    rejectionReason: null,
    ...overrides,
  };
}

// P2002 telle que Prisma la rend SOUS RLS FORCÉE : target à null (voir
// prisma-errors.ts). C'est la forme réelle en production.
function collisionRls() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: null } });
}

// organizationScopedClient() appelle `$extends` ; il rend ici le client
// LUI-MÊME pour que les mocks de modèle restent partagés. `$transaction`
// interactive exécute le callback avec ce même client.
function fakePrisma(overrides: Record<string, unknown> = {}) {
  const p: any = {
    ocrDocument: {
      create: vi.fn().mockResolvedValue(document()),
      findFirst: vi.fn().mockResolvedValue(document()),
      findMany: vi.fn().mockResolvedValue([]),
      // Rend ce qu'on lui a demandé d'écrire, fusionné au document.
      update: vi.fn(async ({ data }: any) => document(data)),
    },
    organization: { findFirstOrThrow: vi.fn().mockResolvedValue({ regimeFiscal: "normal_tva" }) },
    invoice: { create: vi.fn().mockResolvedValue({ id: "inv-1" }) },
    customer: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "cust-1" }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    // Le verrou FOR UPDATE : par défaut, personne n'a encore lié de brouillon.
    $queryRaw: vi.fn().mockResolvedValue([{ invoice_id: null }]),
    $transaction: vi.fn(async (fn: any) => fn(p)),
    ...overrides,
  };
  p.$extends = vi.fn(() => p);
  return p;
}

function fakeProvider(sortie: unknown = SORTIE_CONFORME): OcrVisionProvider & { extraire: ReturnType<typeof vi.fn> } {
  return { extraire: vi.fn().mockResolvedValue(INFERENCE(sortie)) };
}

describe("OcrVisionService (ADR-122)", () => {
  let prisma: any;
  let provider: ReturnType<typeof fakeProvider>;
  let service: OcrVisionService;

  beforeEach(() => {
    prisma = fakePrisma();
    provider = fakeProvider();
    service = new OcrVisionService(prisma, new OcrValidationService(), provider);
  });

  // ── Chemin nominal : conforme → brouillon lié ─────────────────────────────

  it("insère un brouillon lié quand la double-garde valide la lecture", async () => {
    const resultat = await service.scanner(COMMANDE, ORG, USER);

    expect(resultat.status).toBe("AUTO_INSERTED");
    expect(resultat.invoiceId).toBe("inv-1");
    expect(resultat.findings).toBeNull();

    // Le registre est créé avec l'organisation AUTORISÉE et l'auteur du cliché.
    expect(prisma.ocrDocument.create).toHaveBeenCalledWith({
      data: { organizationId: ORG, uploadedByUserId: USER, imageSha256: SHA, storageKey: COMMANDE.storageKey },
    });
    expect(provider.extraire).toHaveBeenCalledWith({ storageKey: COMMANDE.storageKey, mimeType: "image/jpeg" });

    // Le brouillon porte les montants VALIDÉS, le canal PWA, et chaque ligne
    // hérite du régime de saisie reconnu (ADR-108) et du taux du RÉGIME.
    const creation = prisma.invoice.create.mock.calls[0][0].data;
    expect(creation).toMatchObject({
      organizationId: ORG,
      status: "draft",
      emissionChannel: "pwa",
      customerId: "cust-1",
      totalHt: BigInt(130_000_000),
      totalTva: BigInt(23_400_000),
      totalTtc: BigInt(153_400_000),
      amountDue: BigInt(153_400_000),
    });
    expect(creation.lines.create).toEqual([
      expect.objectContaining({ quantity: 2, unitPrice: BigInt(50_000_000), taxRateBps: 1800, saisieRegime: "HT_FIRST" }),
      expect.objectContaining({ quantity: 3, unitPrice: BigInt(10_000_000), taxRateBps: 1800, saisieRegime: "HT_FIRST" }),
    ]);

    // Le lien est posé dans la MÊME transaction, scope RLS posé en tête.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    const liaison = prisma.ocrDocument.update.mock.calls.at(-1)[0];
    expect(liaison.where).toEqual({ id: DOC_ID, organizationId: ORG });
    expect(liaison.data).toMatchObject({
      status: "AUTO_INSERTED",
      invoiceId: "inv-1",
      modelId: "vision-gn-v1",
      extraction: SORTIE_CONFORME,
      totalHtCentimes: BigInt(130_000_000),
      saisieRegime: "HT_FIRST",
    });
  });

  it("réutilise le client existant par NIF plutôt que d'en créer un second", async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: "cust-existant" });

    await service.scanner(COMMANDE, ORG, USER);

    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, nif: "123456789" },
      select: { id: true },
    });
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.invoice.create.mock.calls[0][0].data.customerId).toBe("cust-existant");
  });

  it("résout un client sans NIF par libellé, et laisse customerId null pour une vente anonyme", async () => {
    const anonyme = { ...SORTIE_CONFORME, customer: undefined };
    provider.extraire.mockResolvedValueOnce(INFERENCE({ ...SORTIE_CONFORME, customer: { name: "Client comptoir" } }));
    await service.scanner(COMMANDE, ORG, USER);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, name: "Client comptoir" },
      select: { id: true },
    });

    provider.extraire.mockResolvedValueOnce(INFERENCE(anonyme));
    await service.scanner(COMMANDE, ORG, USER);
    expect(prisma.invoice.create.mock.calls.at(-1)[0].data.customerId).toBeNull();
  });

  // ── Un centime → relecture, AUCUN brouillon ───────────────────────────────

  it("bascule en DRAFT_PENDING_MANUAL_REVIEW sur un centime d'écart, sans créer de brouillon", async () => {
    provider = fakeProvider(SORTIE_ECART);
    service = new OcrVisionService(prisma, new OcrValidationService(), provider);

    const resultat = await service.scanner(COMMANDE, ORG, USER);

    expect(resultat.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(resultat.invoiceId).toBeNull();
    expect(resultat.findings).toEqual([
      { code: "TVA_REGIME", chemin: "totals.totalVAT", attendu: "23400000", constate: "23400001" },
    ]);

    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Le verdict est PERSISTÉ, avec la projection des montants lus.
    const relecture = prisma.ocrDocument.update.mock.calls[0][0];
    expect(relecture.where).toEqual({ id: DOC_ID, organizationId: ORG });
    expect(relecture.data).toMatchObject({
      status: "DRAFT_PENDING_MANUAL_REVIEW",
      reviewFindings: resultat.findings,
      totalVatCentimes: BigInt(23_400_001),
    });
  });

  it("bascule en relecture quand le régime de l'organisation (TPU) contredit la TVA lue", async () => {
    prisma.organization.findFirstOrThrow.mockResolvedValue({ regimeFiscal: "tpu" });

    const resultat = await service.scanner(COMMANDE, ORG, USER);

    expect(resultat.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(resultat.findings?.[0]).toMatchObject({ code: "TVA_REGIME", attendu: "0" });
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  // ── Sortie hors contrat → REJECTED ────────────────────────────────────────

  it("rejette une sortie de modèle hors contrat, en persistant la raison", async () => {
    provider = fakeProvider({ lines: "n'importe quoi" });
    service = new OcrVisionService(prisma, new OcrValidationService(), provider);

    const resultat = await service.scanner(COMMANDE, ORG, USER);

    expect(resultat.status).toBe("REJECTED");
    expect(resultat.rejectionReason).toContain("hors contrat");
    expect(resultat.findings).toBeNull();
    expect(prisma.organization.findFirstOrThrow).not.toHaveBeenCalled();
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.ocrDocument.update.mock.calls[0][0].data).toMatchObject({ status: "REJECTED", modelId: "vision-gn-v1" });
  });

  // ── Idempotence du scan ───────────────────────────────────────────────────

  it("rend le verdict déjà tranché sur un rejeu du même cliché, sans rappeler le modèle", async () => {
    const ecarts = [{ code: "TOTAL_TTC", chemin: "totals.totalTTC", attendu: "1", constate: "2" }];
    prisma.ocrDocument.create.mockRejectedValue(collisionRls());
    prisma.ocrDocument.findFirst.mockResolvedValue(
      document({ status: "DRAFT_PENDING_MANUAL_REVIEW", reviewFindings: ecarts }),
    );

    const resultat = await service.scanner(COMMANDE, ORG, USER);

    expect(resultat.status).toBe("DRAFT_PENDING_MANUAL_REVIEW");
    expect(resultat.findings).toEqual(ecarts);
    expect(provider.extraire).not.toHaveBeenCalled();
    expect(prisma.ocrDocument.findFirst).toHaveBeenCalledWith({ where: { organizationId: ORG, imageSha256: SHA } });
  });

  it("repasse par le modèle sur un rejeu d'un scan resté RECEIVED (le modèle n'avait pas répondu)", async () => {
    prisma.ocrDocument.create.mockRejectedValue(collisionRls());

    const resultat = await service.scanner(COMMANDE, ORG, USER);

    expect(provider.extraire).toHaveBeenCalledTimes(1);
    expect(resultat.status).toBe("AUTO_INSERTED");
  });

  it("relaie une collision sans ligne visible plutôt que de la masquer", async () => {
    prisma.ocrDocument.create.mockRejectedValue(collisionRls());
    prisma.ocrDocument.findFirst.mockResolvedValue(null);

    await expect(service.scanner(COMMANDE, ORG, USER)).rejects.toMatchObject({ code: "P2002" });
  });

  it("relaie toute erreur qui n'est pas une collision d'unicité", async () => {
    prisma.ocrDocument.create.mockRejectedValue(new Error("connexion perdue"));

    await expect(service.scanner(COMMANDE, ORG, USER)).rejects.toThrow("connexion perdue");
    expect(provider.extraire).not.toHaveBeenCalled();
  });

  it("laisse le document en RECEIVED et relaie l'erreur quand le modèle échoue — rescannable", async () => {
    provider.extraire.mockRejectedValue(new ServiceUnavailableException("modèle indisponible"));

    await expect(service.scanner(COMMANDE, ORG, USER)).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.ocrDocument.update).not.toHaveBeenCalled();
  });

  // ── traiter() : étanchéité et idempotence de l'insertion ──────────────────

  it("traiter() refuse (404 générique) un document hors du scope de l'organisation", async () => {
    prisma.ocrDocument.findFirst.mockResolvedValue(null);

    await expect(service.traiter(DOC_ID, ORG, INFERENCE(SORTIE_CONFORME))).rejects.toThrow(NotFoundException);
    expect(prisma.ocrDocument.findFirst).toHaveBeenCalledWith({ where: { id: DOC_ID, organizationId: ORG } });
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("traiter() ne crée jamais un second brouillon pour un document déjà lié", async () => {
    prisma.ocrDocument.findFirst.mockResolvedValue(document({ status: "AUTO_INSERTED", invoiceId: "inv-deja" }));

    const resultat = await service.traiter(DOC_ID, ORG, INFERENCE(SORTIE_CONFORME));

    expect(resultat.invoiceId).toBe("inv-deja");
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.ocrDocument.update).not.toHaveBeenCalled();
  });

  // La course fermée par le verrou de ligne : un traitement concurrent a posé
  // le lien pendant que celui-ci attendait le modèle. Il relit, n'insère rien.
  it("traiter() n'insère rien quand le verrou FOR UPDATE révèle un brouillon posé entre-temps", async () => {
    prisma.$queryRaw.mockResolvedValue([{ invoice_id: "inv-du-gagnant" }]);
    prisma.ocrDocument.findFirstOrThrow = vi
      .fn()
      .mockResolvedValue(document({ status: "AUTO_INSERTED", invoiceId: "inv-du-gagnant" }));

    const resultat = await service.traiter(DOC_ID, ORG, INFERENCE(SORTIE_CONFORME));

    expect(resultat.invoiceId).toBe("inv-du-gagnant");
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.ocrDocument.update).not.toHaveBeenCalled();
  });

  it("traiter() rend 404 si la ligne a disparu sous le verrou", async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.traiter(DOC_ID, ORG, INFERENCE(SORTIE_CONFORME))).rejects.toThrow(NotFoundException);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  // ── Lectures ──────────────────────────────────────────────────────────────

  it("findOne() porte la double clause id + organizationId et rend 404 hors scope", async () => {
    prisma.ocrDocument.findFirst.mockResolvedValueOnce(document());
    await expect(service.findOne(DOC_ID, ORG)).resolves.toMatchObject({ id: DOC_ID });
    expect(prisma.ocrDocument.findFirst.mock.calls[0][0].where).toEqual({ id: DOC_ID, organizationId: ORG });

    prisma.ocrDocument.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne(DOC_ID, ORG)).rejects.toThrow(NotFoundException);
  });

  it("findAllByOrganization() filtre toujours sur l'organisation, et sur le statut s'il est demandé", async () => {
    await service.findAllByOrganization(ORG);
    expect(prisma.ocrDocument.findMany.mock.calls[0][0].where).toEqual({ organizationId: ORG });

    await service.findAllByOrganization(ORG, { status: "DRAFT_PENDING_MANUAL_REVIEW" });
    expect(prisma.ocrDocument.findMany.mock.calls[1][0].where).toEqual({
      organizationId: ORG,
      status: "DRAFT_PENDING_MANUAL_REVIEW",
    });
  });
});

describe("UnconfiguredOcrVisionProvider", () => {
  it("répond 503 explicite tant qu'aucun point d'inférence n'est câblé — jamais un RECEIVED silencieux", async () => {
    await expect(new UnconfiguredOcrVisionProvider().extraire()).rejects.toThrow(ServiceUnavailableException);
  });
});
