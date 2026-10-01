import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OcrPipelineService } from "./ocr-pipeline.service";

const ORG = "org-1";
const DOC_ID = "doc-1";
const USER_ID = "user-1";
const PAYLOAD = { documentId: DOC_ID, organizationId: ORG, mimeType: "audio/ogg" };

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    organizationId: ORG,
    uploadedByUserId: USER_ID,
    source: "AUDIO_PWA",
    audioSha256: "a".repeat(64),
    storageKey: "audio-notes/org-1/note.ogg",
    textBrut: null,
    // Jamais posé hors WHATSAPP_TEXT/WHATSAPP_VOICE (plan 2026-09-16, étape 2).
    customerPhone: null,
    status: "RECEIVED",
    invoiceId: null,
    rejectionReason: null,
    ...overrides,
  };
}

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const p: any = {
    ocrDocument: {
      findFirst: vi.fn().mockResolvedValue(document()),
      update: vi.fn(async ({ data }: any) => document(data)),
    },
    userPhone: {
      findFirst: vi.fn().mockResolvedValue({ id: "phone-1", userId: USER_ID, msisdn: "+224622334455", isPrimary: true }),
    },
    ...overrides,
  };
  p.$extends = vi.fn(() => p);
  return p;
}

function fakeStt(texte = "deux sacs de riz cinquante kilos") {
  return { transcrire: vi.fn().mockResolvedValue({ modelId: "whisper-gn-2026.09", texte }) };
}

function fakeTextExtraction(sortie: unknown = { ok: true }) {
  return { extraire: vi.fn().mockResolvedValue({ modelId: "vision-gn-2026.09", sortie }) };
}

function fakeOcrVision(resultat: unknown = { documentId: DOC_ID, status: "AUTO_INSERTED", invoiceId: "inv-1", findings: null, rejectionReason: null }) {
  return { traiter: vi.fn().mockResolvedValue(resultat) };
}

function fakeNotificationProvider() {
  return { send: vi.fn().mockResolvedValue({ success: true }) };
}

function compteur() {
  return { inc: vi.fn() };
}

describe("OcrPipelineService.transcribeAndExtract (plan 2026-09-16, OCR multicanal)", () => {
  let prisma: any;
  let stt: ReturnType<typeof fakeStt>;
  let textExtraction: ReturnType<typeof fakeTextExtraction>;
  let ocrVision: ReturnType<typeof fakeOcrVision>;
  let smsProvider: ReturnType<typeof fakeNotificationProvider>;
  let whatsappProvider: ReturnType<typeof fakeNotificationProvider>;
  let rejections: ReturnType<typeof compteur>;
  let service: OcrPipelineService;

  beforeEach(() => {
    prisma = fakePrisma();
    stt = fakeStt();
    textExtraction = fakeTextExtraction();
    ocrVision = fakeOcrVision();
    smsProvider = fakeNotificationProvider();
    whatsappProvider = fakeNotificationProvider();
    rejections = compteur();
    service = new OcrPipelineService(prisma, stt as never, textExtraction as never, ocrVision as never, smsProvider as never, whatsappProvider as never, rejections as never);
  });

  // ── Chemin nominal ──────────────────────────────────────────────────────

  it("transcrit, persiste textBrut, extrait, puis appelle traiter() avec l'inférence issue de l'extraction texte", async () => {
    const resultat = await service.transcribeAndExtract(PAYLOAD, { attemptsMade: 0, attempts: 3 });

    expect(stt.transcrire).toHaveBeenCalledWith({ storageKey: "audio-notes/org-1/note.ogg", mimeType: "audio/ogg" });
    const ecriture = prisma.ocrDocument.update.mock.calls[0][0];
    expect(ecriture.where).toEqual({ id: DOC_ID, organizationId: ORG });
    expect(ecriture.data).toEqual({ textBrut: "deux sacs de riz cinquante kilos" });

    expect(textExtraction.extraire).toHaveBeenCalledWith({ texte: "deux sacs de riz cinquante kilos" });
    expect(ocrVision.traiter).toHaveBeenCalledWith(DOC_ID, ORG, { modelId: "vision-gn-2026.09", sortie: { ok: true } });
    expect(resultat).toMatchObject({ status: "AUTO_INSERTED", invoiceId: "inv-1" });
  });

  it("ne rappelle jamais SttProvider quand textBrut est déjà persisté (reprise après un échec d'extraction)", async () => {
    prisma.ocrDocument.findFirst.mockResolvedValue(document({ textBrut: "déjà transcrit" }));

    await service.transcribeAndExtract(PAYLOAD, { attemptsMade: 1, attempts: 3 });

    expect(stt.transcrire).not.toHaveBeenCalled();
    expect(prisma.ocrDocument.update).not.toHaveBeenCalled();
    expect(textExtraction.extraire).toHaveBeenCalledWith({ texte: "déjà transcrit" });
  });

  it("EXTRACT_FROM_TEXT (lot suivant) : jamais exercé ici — TRANSCRIBE_AND_EXTRACT n'appelle OcrTextExtractionProvider qu'APRÈS la transcription", async () => {
    await service.transcribeAndExtract(PAYLOAD, { attemptsMade: 0, attempts: 3 });
    const ordreAppelStt = stt.transcrire.mock.invocationCallOrder[0];
    const ordreAppelExtraction = textExtraction.extraire.mock.invocationCallOrder[0];
    expect(ordreAppelStt).toBeLessThan(ordreAppelExtraction);
  });

  it("lève 404 générique quand le document est introuvable dans le scope de l'organisation", async () => {
    prisma.ocrDocument.findFirst.mockResolvedValue(null);

    await expect(service.transcribeAndExtract(PAYLOAD, { attemptsMade: 0, attempts: 3 })).rejects.toThrow(NotFoundException);
    expect(stt.transcrire).not.toHaveBeenCalled();
  });

  // ── Échec transitoire : JAMAIS avalé avant l'épuisement ────────────────────

  it("laisse REMONTER un échec SttProvider transitoire tant qu'il reste des tentatives — jamais avalé", async () => {
    stt.transcrire.mockRejectedValue(new ServiceUnavailableException("Hub STT indisponible"));

    await expect(service.transcribeAndExtract(PAYLOAD, { attemptsMade: 0, attempts: 3 })).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.ocrDocument.update).not.toHaveBeenCalled();
    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(whatsappProvider.send).not.toHaveBeenCalled();
    expect(rejections.inc).not.toHaveBeenCalled();
  });

  it("laisse REMONTER un échec OcrTextExtractionProvider transitoire tant qu'il reste des tentatives", async () => {
    textExtraction.extraire.mockRejectedValue(new ServiceUnavailableException("Hub Vision indisponible"));

    await expect(service.transcribeAndExtract(PAYLOAD, { attemptsMade: 1, attempts: 3 })).rejects.toThrow(ServiceUnavailableException);
    expect(rejections.inc).not.toHaveBeenCalled();
  });

  // ── Dernière tentative épuisée : REJECTED + notification best-effort ──────

  it("sur la dernière tentative épuisée, rejette définitivement le document et notifie l'uploader (SMS + WhatsApp), sans lever", async () => {
    stt.transcrire.mockRejectedValue(new ServiceUnavailableException("Hub STT indisponible"));

    const resultat = await service.transcribeAndExtract(PAYLOAD, { attemptsMade: 2, attempts: 3 });

    expect(resultat.status).toBe("REJECTED");
    expect(resultat.rejectionReason).toContain("3 tentatives");
    expect(resultat.findings).toBeNull();

    const ecriture = prisma.ocrDocument.update.mock.calls[0][0];
    expect(ecriture.where).toEqual({ id: DOC_ID, organizationId: ORG });
    expect(ecriture.data).toMatchObject({ status: "REJECTED" });
    expect(ecriture.data.rejectionReason).toContain("reprenez la note vocale");
    expect(ecriture.data.processedAt).toBeInstanceOf(Date);

    expect(prisma.userPhone.findFirst).toHaveBeenCalledWith({ where: { userId: USER_ID, isPrimary: true } });
    expect(smsProvider.send).toHaveBeenCalledWith("+224622334455", expect.stringContaining("reprenez la note vocale"));
    expect(whatsappProvider.send).toHaveBeenCalledWith("+224622334455", expect.stringContaining("reprenez la note vocale"));
    expect(rejections.inc).toHaveBeenCalledWith({ source: "AUDIO_PWA" });
  });

  it("l'échec de la notification elle-même ne remonte JAMAIS — le document reste REJECTED tel qu'écrit", async () => {
    stt.transcrire.mockRejectedValue(new ServiceUnavailableException("Hub STT indisponible"));
    smsProvider.send.mockRejectedValue(new Error("passerelle SMS en panne"));
    whatsappProvider.send.mockRejectedValue(new Error("passerelle WhatsApp en panne"));

    const resultat = await service.transcribeAndExtract(PAYLOAD, { attemptsMade: 2, attempts: 3 });

    expect(resultat.status).toBe("REJECTED");
  });

  it("aucun numéro primaire pour l'uploader : rejette quand même le document, sans lever", async () => {
    prisma.userPhone.findFirst.mockResolvedValue(null);
    stt.transcrire.mockRejectedValue(new ServiceUnavailableException("Hub STT indisponible"));

    const resultat = await service.transcribeAndExtract(PAYLOAD, { attemptsMade: 2, attempts: 3 });

    expect(resultat.status).toBe("REJECTED");
    expect(smsProvider.send).not.toHaveBeenCalled();
    expect(whatsappProvider.send).not.toHaveBeenCalled();
  });
});

// ── EXTRACT_FROM_TEXT : WHATSAPP_TEXT (plan 2026-09-16, étape 2) ────────────
//
// Même service, même contrat d'échec (transitoire → remonte ; épuisement →
// REJECTED + notification best-effort via gererEchec(), partagé sans
// modification avec transcribeAndExtract()) — seule la source diffère :
// extrait DIRECTEMENT depuis document.textBrut, JAMAIS SttProvider.
const TEXT_PAYLOAD = { documentId: DOC_ID, organizationId: ORG };

describe("OcrPipelineService.extractFromText (plan 2026-09-16, étape 2)", () => {
  let prisma: any;
  let stt: ReturnType<typeof fakeStt>;
  let textExtraction: ReturnType<typeof fakeTextExtraction>;
  let ocrVision: ReturnType<typeof fakeOcrVision>;
  let smsProvider: ReturnType<typeof fakeNotificationProvider>;
  let whatsappProvider: ReturnType<typeof fakeNotificationProvider>;
  let rejections: ReturnType<typeof compteur>;
  let service: OcrPipelineService;

  beforeEach(() => {
    prisma = fakePrisma({
      ocrDocument: {
        findFirst: vi.fn().mockResolvedValue(
          document({ source: "WHATSAPP_TEXT", textBrut: "Facture pour Amadou, 2 sacs de riz à 500000 GNF", customerPhone: "+224620000000" }),
        ),
        update: vi.fn(async ({ data }: any) => document(data)),
      },
    });
    stt = fakeStt();
    textExtraction = fakeTextExtraction();
    ocrVision = fakeOcrVision();
    smsProvider = fakeNotificationProvider();
    whatsappProvider = fakeNotificationProvider();
    rejections = compteur();
    service = new OcrPipelineService(prisma, stt as never, textExtraction as never, ocrVision as never, smsProvider as never, whatsappProvider as never, rejections as never);
  });

  it("appelle OcrTextExtractionProvider avec document.textBrut, JAMAIS SttProvider", async () => {
    const resultat = await service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 0, attempts: 3 });

    expect(textExtraction.extraire).toHaveBeenCalledWith({ texte: "Facture pour Amadou, 2 sacs de riz à 500000 GNF" });
    expect(stt.transcrire).not.toHaveBeenCalled();
    expect(ocrVision.traiter).toHaveBeenCalledWith(DOC_ID, ORG, { modelId: "vision-gn-2026.09", sortie: { ok: true } });
    expect(resultat).toMatchObject({ status: "AUTO_INSERTED", invoiceId: "inv-1" });
  });

  it("lève 404 générique quand le document est introuvable dans le scope de l'organisation", async () => {
    prisma.ocrDocument.findFirst.mockResolvedValue(null);

    await expect(service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 0, attempts: 3 })).rejects.toThrow(NotFoundException);
    expect(textExtraction.extraire).not.toHaveBeenCalled();
  });

  it("laisse REMONTER un échec OcrTextExtractionProvider transitoire tant qu'il reste des tentatives — jamais avalé", async () => {
    textExtraction.extraire.mockRejectedValue(new ServiceUnavailableException("Hub Vision indisponible"));

    await expect(service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 0, attempts: 3 })).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.ocrDocument.update).not.toHaveBeenCalled();
    expect(rejections.inc).not.toHaveBeenCalled();
  });

  it("sur la dernière tentative épuisée, rejette définitivement le document et notifie l'uploader, sans lever", async () => {
    textExtraction.extraire.mockRejectedValue(new ServiceUnavailableException("Hub Vision indisponible"));

    const resultat = await service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 2, attempts: 3 });

    expect(resultat.status).toBe("REJECTED");
    expect(resultat.rejectionReason).toContain("3 tentatives");
    expect(rejections.inc).toHaveBeenCalledWith({ source: "WHATSAPP_TEXT" });
  });
});

// ── Notification WhatsApp différenciée par verdict (tâche 28) ──────────────
//
// UNIQUEMENT pour les documents WHATSAPP_TEXT/WHATSAPP_VOICE, envoyée sur le
// numéro de l'EXPÉDITEUR (document.customerPhone) — jamais pour AUDIO_PWA
// (aucune conversation WhatsApp en cours à répondre), et jamais sur le
// chemin d'échec définitif (déjà couvert par gererEchec()/notifierEchecDefinitif(),
// inchangé).
describe("OcrPipelineService — notification WhatsApp différenciée par verdict", () => {
  let prisma: any;
  let stt: ReturnType<typeof fakeStt>;
  let textExtraction: ReturnType<typeof fakeTextExtraction>;
  let smsProvider: ReturnType<typeof fakeNotificationProvider>;
  let whatsappProvider: ReturnType<typeof fakeNotificationProvider>;

  function build(source: "WHATSAPP_TEXT" | "WHATSAPP_VOICE" | "AUDIO_PWA", resultatTraiter: unknown) {
    prisma = fakePrisma({
      ocrDocument: {
        findFirst: vi.fn().mockResolvedValue(
          document({ source, textBrut: "Facture pour Amadou, 2 sacs de riz à 500000 GNF", customerPhone: "+224620000000" }),
        ),
        update: vi.fn(async ({ data }: any) => document(data)),
      },
    });
    stt = fakeStt();
    textExtraction = fakeTextExtraction();
    smsProvider = fakeNotificationProvider();
    whatsappProvider = fakeNotificationProvider();
    const ocrVision = { traiter: vi.fn().mockResolvedValue(resultatTraiter) };
    return {
      service: new OcrPipelineService(prisma, stt as never, textExtraction as never, ocrVision as never, smsProvider as never, whatsappProvider as never, compteur() as never),
      ocrVision,
    };
  }

  it.each([
    ["AUTO_INSERTED", { documentId: DOC_ID, status: "AUTO_INSERTED", invoiceId: "inv-1", findings: null, rejectionReason: null }, /brouillon/i],
    [
      "DRAFT_PENDING_MANUAL_REVIEW",
      { documentId: DOC_ID, status: "DRAFT_PENDING_MANUAL_REVIEW", invoiceId: null, findings: [], rejectionReason: null },
      /exemple de message attendu/i,
    ],
    [
      "REJECTED",
      { documentId: DOC_ID, status: "REJECTED", invoiceId: null, findings: null, rejectionReason: "hors contrat" },
      /exemple de message attendu/i,
    ],
  ])("envoie un message WhatsApp différencié pour le verdict %s (WHATSAPP_TEXT)", async (_status, resultatTraiter, motif) => {
    const { service } = build("WHATSAPP_TEXT", resultatTraiter);

    await service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 0, attempts: 3 });

    expect(whatsappProvider.send).toHaveBeenCalledWith("+224620000000", expect.stringMatching(motif));
    expect(smsProvider.send).not.toHaveBeenCalled();
  });

  it("n'envoie AUCUN message différencié par verdict pour AUDIO_PWA (pas de conversation WhatsApp en cours)", async () => {
    const { service } = build("AUDIO_PWA", {
      documentId: DOC_ID,
      status: "AUTO_INSERTED",
      invoiceId: "inv-1",
      findings: null,
      rejectionReason: null,
    });
    prisma.ocrDocument.findFirst.mockResolvedValue(document({ source: "AUDIO_PWA", textBrut: "peu importe", customerPhone: null }));

    await service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 0, attempts: 3 });

    expect(whatsappProvider.send).not.toHaveBeenCalled();
  });

  it("l'échec d'envoi de la notification différenciée ne remonte JAMAIS — le verdict est déjà acquis", async () => {
    whatsappProvider.send.mockRejectedValue(new Error("passerelle WhatsApp en panne"));
    const { service } = build("WHATSAPP_TEXT", {
      documentId: DOC_ID,
      status: "AUTO_INSERTED",
      invoiceId: "inv-1",
      findings: null,
      rejectionReason: null,
    });

    await expect(service.extractFromText(TEXT_PAYLOAD, { attemptsMade: 0, attempts: 3 })).resolves.toMatchObject({
      status: "AUTO_INSERTED",
    });
  });

  it("prépare le même point d'extension pour transcribeAndExtract() (WHATSAPP_VOICE, Étape 3) — même mécanisme, déjà générique", async () => {
    const { service } = build("WHATSAPP_VOICE", {
      documentId: DOC_ID,
      status: "AUTO_INSERTED",
      invoiceId: "inv-1",
      findings: null,
      rejectionReason: null,
    });
    prisma.ocrDocument.findFirst.mockResolvedValue(
      document({ source: "WHATSAPP_VOICE", storageKey: "whatsapp-media/x.ogg", customerPhone: "+224620000000" }),
    );

    await service.transcribeAndExtract({ documentId: DOC_ID, organizationId: ORG, mimeType: "audio/ogg" }, { attemptsMade: 0, attempts: 3 });

    expect(whatsappProvider.send).toHaveBeenCalledWith("+224620000000", expect.stringMatching(/brouillon/i));
  });
});
