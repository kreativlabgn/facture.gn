import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppMediaRelayIndisponible } from "./whatsapp-media-relay.service";
import type { WhatsAppInboundMessage } from "./dto/whatsapp-webhook.dto";

const PHONE = "+224620000000";
const FROM_RAW = "224620000000"; // Meta envoie le numéro SANS le "+".
const ORG = "org-1";
const USER_ID = "user-1";

function textMessage(overrides: Partial<WhatsAppInboundMessage> = {}): WhatsAppInboundMessage {
  return {
    from: FROM_RAW,
    id: "wamid.abc-1",
    type: "text",
    text: { body: "Facture pour Amadou, 2 sacs de riz à 500000 GNF" },
    ...overrides,
  } as WhatsAppInboundMessage;
}

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    userPhone: {
      findUnique: vi.fn().mockResolvedValue({ id: "phone-1", userId: USER_ID, msisdn: PHONE, verifiedAt: new Date() }),
    },
    organizationMember: {
      findMany: vi.fn().mockResolvedValue([{ id: "member-1", organizationId: ORG, userId: USER_ID, role: "cashier", revokedAt: null }]),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: ORG, whatsappOcrEnabled: true }),
    },
    ocrDocument: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function fakeWhatsappProvider() {
  return { send: vi.fn().mockResolvedValue({ success: true }) };
}

function fakeAbuseGuard(autorise = true) {
  return { estAutorise: vi.fn().mockResolvedValue(autorise) };
}

function fakeOcrVision() {
  return { recevoirMessageWhatsapp: vi.fn().mockResolvedValue({ documentId: "doc-1", status: "RECEIVED", invoiceId: null, findings: null, rejectionReason: null }) };
}

function fakeMediaRelay() {
  return { relayer: vi.fn().mockResolvedValue({ storageKey: "whatsapp/org-1/wamid.audio-1", mimeType: "audio/ogg" }) };
}

describe("WhatsAppInboundService — résolution expéditeur (clarification 6 du plan 2026-09-16)", () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let whatsapp: ReturnType<typeof fakeWhatsappProvider>;
  let abuseGuard: ReturnType<typeof fakeAbuseGuard>;
  let ocrVision: ReturnType<typeof fakeOcrVision>;
  let mediaRelay: ReturnType<typeof fakeMediaRelay>;
  let service: WhatsAppInboundService;

  beforeEach(() => {
    prisma = fakePrisma();
    whatsapp = fakeWhatsappProvider();
    abuseGuard = fakeAbuseGuard();
    ocrVision = fakeOcrVision();
    mediaRelay = fakeMediaRelay();
    service = new WhatsAppInboundService(
      prisma as never,
      whatsapp as never,
      abuseGuard as never,
      ocrVision as never,
      mediaRelay as never,
    );
  });

  // ── Chemin heureux texte ────────────────────────────────────────────────

  it("chemin heureux texte : délègue à OcrVisionService.recevoirMessageWhatsapp avec les bons champs", async () => {
    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadedByUserId: USER_ID,
      whatsappMessageId: "wamid.abc-1",
      customerPhone: PHONE,
      kind: "text",
      texte: "Facture pour Amadou, 2 sacs de riz à 500000 GNF",
    });
    // Chemin heureux : aucune réponse WhatsApp immédiate n'est due ICI — le
    // verdict différencié part depuis le pipeline asynchrone (OcrPipelineService),
    // pas depuis ce guichet d'entrée.
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  // ── Numéro inconnu / non vérifié : MÊME message, littéralement ─────────

  it("numéro totalement inconnu → message générique d'inscription", async () => {
    prisma.userPhone.findUnique.mockResolvedValue(null);

    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send.mock.calls[0][0]).toBe(PHONE);
  });

  it("numéro connu mais JAMAIS vérifié → EXACTEMENT le même message littéral qu'un numéro inconnu (anti-fuite, invariant testé par égalité de chaîne)", async () => {
    // Cas 1 : numéro inconnu.
    prisma.userPhone.findUnique.mockResolvedValueOnce(null);
    await service.traiterMessage(textMessage({ id: "wamid.cas-1" }));
    const messageNumeroInconnu = whatsapp.send.mock.calls[0][1];

    // Cas 2 : numéro connu, verifiedAt: null.
    prisma.userPhone.findUnique.mockResolvedValueOnce({ id: "phone-1", userId: USER_ID, msisdn: PHONE, verifiedAt: null });
    await service.traiterMessage(textMessage({ id: "wamid.cas-2" }));
    const messageNonVerifie = whatsapp.send.mock.calls[1][1];

    expect(messageNonVerifie).toBe(messageNumeroInconnu);
    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
  });

  // ── 0 ou plusieurs organisations actives ────────────────────────────────

  it("zéro OrganizationMember actif → message \"ouvrez l'app\", jamais le message d'inscription générique", async () => {
    prisma.organizationMember.findMany.mockResolvedValue([]);

    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });

  it("plusieurs OrganizationMember actifs (multi-organisation, hors scope) → message \"ouvrez l'app\"", async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { id: "m1", organizationId: "org-1", userId: USER_ID, role: "cashier", revokedAt: null },
      { id: "m2", organizationId: "org-2", userId: USER_ID, role: "owner", revokedAt: null },
    ]);

    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });

  // ── Rôle insuffisant : message DISTINCT, explicite ──────────────────────

  it("membre actif hors ROLES_SAISIE → message DISTINCT du message générique (identité confirmée, expliquer pourquoi ne fuit rien)", async () => {
    prisma.organizationMember.findMany.mockResolvedValue([
      { id: "m1", organizationId: ORG, userId: USER_ID, role: "auditor", revokedAt: null },
    ]);

    // Message générique de référence (numéro inconnu).
    prisma.userPhone.findUnique.mockResolvedValueOnce(null);
    await service.traiterMessage(textMessage({ id: "wamid.ref" }));
    const messageGenerique = whatsapp.send.mock.calls[0][1];

    await service.traiterMessage(textMessage({ id: "wamid.role-insuffisant" }));
    const messageRoleInsuffisant = whatsapp.send.mock.calls[1][1];

    expect(messageRoleInsuffisant).not.toBe(messageGenerique);
    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin", "accountant_internal", "cashier", "field_agent"])(
    "le rôle %s (ROLES_SAISIE) passe la garde de rôle",
    async (role) => {
      prisma.organizationMember.findMany.mockResolvedValue([
        { id: "m1", organizationId: ORG, userId: USER_ID, role, revokedAt: null },
      ]);

      await service.traiterMessage(textMessage());

      expect(ocrVision.recevoirMessageWhatsapp).toHaveBeenCalledTimes(1);
    },
  );

  // ── Canal désactivé ──────────────────────────────────────────────────────

  it("organization.whatsappOcrEnabled === false → message explicite \"activez le canal\", AUCUN appel à OcrVisionService", async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: ORG, whatsappOcrEnabled: false });

    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });

  // ── Anti-abus ────────────────────────────────────────────────────────────

  it("plafond horaire dépassé → message \"réessayez plus tard\", AUCUN appel à OcrVisionService", async () => {
    abuseGuard.estAutorise.mockResolvedValue(false);

    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(abuseGuard.estAutorise).toHaveBeenCalledWith(ORG);
  });

  // ── Déduplication wamid ────────────────────────────────────────────────

  it("message déjà vu (whatsappMessageId déjà en base) → PAS de second appel à recevoirMessageWhatsapp, réponse 200 silencieuse (aucun message WhatsApp sortant)", async () => {
    prisma.ocrDocument.findUnique.mockResolvedValue({ id: "doc-existant", whatsappMessageId: "wamid.abc-1" });

    await service.traiterMessage(textMessage());

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it("un wamid déjà vu ne déclenche PAS de second appel à abuseGuard.estAutorise — la déduplication passe AVANT l'anti-abus, sans quoi une redélivraison Meta consommerait deux fois le quota", async () => {
    prisma.ocrDocument.findUnique.mockResolvedValue({ id: "doc-existant", whatsappMessageId: "wamid.abc-1" });

    await service.traiterMessage(textMessage());

    expect(abuseGuard.estAutorise).not.toHaveBeenCalled();
  });

  // ── Type de message non supporté ────────────────────────────────────────

  it("type de message non supporté (image) → réponse pédagogique, jamais un crash", async () => {
    await service.traiterMessage(textMessage({ type: "image", text: undefined } as never));

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });

  // ── Audio (Étape 3 du plan 2026-09-16) ──────────────────────────────────

  it("chemin heureux audio : relaie le média puis délègue à OcrVisionService.recevoirMessageWhatsapp avec la storageKey rendue par le relais", async () => {
    await service.traiterMessage(
      textMessage({ id: "wamid.audio-1", type: "audio", text: undefined, audio: { id: "media-1", mime_type: "audio/ogg" } } as never),
    );

    expect(mediaRelay.relayer).toHaveBeenCalledWith({
      organizationId: ORG,
      whatsappMessageId: "wamid.audio-1",
      mediaId: "media-1",
    });
    expect(ocrVision.recevoirMessageWhatsapp).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadedByUserId: USER_ID,
      whatsappMessageId: "wamid.audio-1",
      customerPhone: PHONE,
      kind: "audio",
      storageKey: "whatsapp/org-1/wamid.audio-1",
      // Le mimeType déclaré par le WEBHOOK (message.audio.mime_type), pas
      // celui rendu par le relais — voir le commentaire de la branche audio.
      mimeType: "audio/ogg",
    });
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it("échec du relais média (WhatsAppMediaRelayIndisponible) → message dédié envoyé, recevoirMessageWhatsapp PAS appelé", async () => {
    mediaRelay.relayer.mockRejectedValue(new WhatsAppMediaRelayIndisponible("Hub STT injoignable"));

    await service.traiterMessage(
      textMessage({ id: "wamid.audio-echec", type: "audio", text: undefined, audio: { id: "media-1", mime_type: "audio/ogg" } } as never),
    );

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(whatsapp.send.mock.calls[0][0]).toBe(PHONE);
    // Message DÉDIÉ, distinct de MESSAGE_TYPE_NON_SUPPORTE — un échec du
    // relais n'est pas un type de message non géré, c'est une panne transitoire.
    expect(whatsapp.send.mock.calls[0][1]).toContain("relais audio est temporairement indisponible");
  });

  it("une exception INATTENDUE du relais (pas WhatsAppMediaRelayIndisponible) remonte — jamais travestie en message générique", async () => {
    mediaRelay.relayer.mockRejectedValue(new Error("bug de programmation"));

    await expect(
      service.traiterMessage(
        textMessage({ id: "wamid.audio-bug", type: "audio", text: undefined, audio: { id: "media-1", mime_type: "audio/ogg" } } as never),
      ),
    ).rejects.toThrow("bug de programmation");

    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  // ── Format de numéro hors norme ──────────────────────────────────────────

  it("un \"from\" qui ne normalise pas en +224XXXXXXXXX → repli fail-closed sur le message générique", async () => {
    await service.traiterMessage(textMessage({ from: "not-a-phone-number" }));

    expect(prisma.userPhone.findUnique).not.toHaveBeenCalled();
    expect(ocrVision.recevoirMessageWhatsapp).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledTimes(1);
  });
});
