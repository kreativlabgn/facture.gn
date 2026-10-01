import { describe, expect, it, vi } from "vitest";
import { AiController } from "./ai.controller";
import { listScansQuerySchema, scanDocumentSchema } from "./dto/scan-document.dto";

const ORG = "11111111-1111-4111-8111-111111111111";
const COMMANDE = {
  organizationId: ORG,
  imageSha256: "b".repeat(64),
  storageKey: "scans/2026/09/carnet-0042.jpg",
  mimeType: "image/jpeg" as const,
};

const COMMANDE_AUDIO = {
  organizationId: ORG,
  audioSha256: "c".repeat(64),
  storageKey: "audio-notes/2026/09/note-0001.ogg",
  mimeType: "audio/ogg" as const,
};

function controleur() {
  const ocrVision = {
    scanner: vi.fn().mockResolvedValue({ documentId: "doc-1", status: "AUTO_INSERTED" }),
    recevoirAudio: vi.fn().mockResolvedValue({ documentId: "doc-audio-1", status: "RECEIVED" }),
    findAllByOrganization: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue({ id: "doc-1" }),
  };
  return { controller: new AiController(ocrVision as any), ocrVision };
}

describe("AiController /ai/ocr/scans (ADR-122)", () => {
  // L'organisation passée au service est celle que RolesGuard a AUTORISÉE, et
  // l'auteur est celui du JWT — jamais une valeur du corps.
  it("POST délègue au service avec l'organisation résolue par le garde et l'utilisateur courant", async () => {
    const { controller, ocrVision } = controleur();

    await controller.scanner({ ...COMMANDE, organizationId: "org-du-corps" }, ORG, { id: "user-1" });

    expect(ocrVision.scanner).toHaveBeenCalledWith({ ...COMMANDE, organizationId: "org-du-corps" }, ORG, "user-1");
  });

  it("GET liste avec le filtre de statut optionnel", async () => {
    const { controller, ocrVision } = controleur();

    await controller.findAll({ organizationId: ORG, status: "DRAFT_PENDING_MANUAL_REVIEW" });

    expect(ocrVision.findAllByOrganization).toHaveBeenCalledWith(ORG, { status: "DRAFT_PENDING_MANUAL_REVIEW" });
  });

  it("GET :id délègue avec l'organisation résolue depuis le document par le garde", async () => {
    const { controller, ocrVision } = controleur();

    await controller.findOne("doc-1", ORG);

    expect(ocrVision.findOne).toHaveBeenCalledWith("doc-1", ORG);
  });
});

describe("AiController /ai/ocr/audio-notes (plan 2026-09-16, OCR multicanal)", () => {
  // Même garde exacte que POST /ai/ocr/scans : organisation AUTORISÉE par
  // RolesGuard, auteur du JWT — jamais une valeur du corps.
  it("POST délègue au service avec l'organisation résolue par le garde et l'utilisateur courant", async () => {
    const { controller, ocrVision } = controleur();

    await controller.recevoirAudio({ ...COMMANDE_AUDIO, organizationId: "org-du-corps" }, ORG, { id: "user-1" });

    expect(ocrVision.recevoirAudio).toHaveBeenCalledWith({ ...COMMANDE_AUDIO, organizationId: "org-du-corps" }, ORG, "user-1");
  });
});

describe("scanDocumentSchema", () => {
  it("accepte une commande complète", () => {
    expect(scanDocumentSchema.safeParse(COMMANDE).success).toBe(true);
  });

  it("refuse une empreinte qui n'est pas un SHA-256 hexadécimal minuscule", () => {
    for (const imageSha256 of ["B".repeat(64), "a".repeat(63), "zz" + "a".repeat(62)]) {
      expect(scanDocumentSchema.safeParse({ ...COMMANDE, imageSha256 }).success).toBe(false);
    }
  });

  it("refuse un type MIME hors images et PDF", () => {
    expect(scanDocumentSchema.safeParse({ ...COMMANDE, mimeType: "text/html" }).success).toBe(false);
  });

  it("refuse un organizationId qui n'est pas un uuid", () => {
    expect(scanDocumentSchema.safeParse({ ...COMMANDE, organizationId: "org-1" }).success).toBe(false);
  });
});

describe("listScansQuerySchema", () => {
  it("accepte un filtre de statut connu et refuse un statut inconnu", () => {
    expect(listScansQuerySchema.safeParse({ organizationId: ORG, status: "REJECTED" }).success).toBe(true);
    expect(listScansQuerySchema.safeParse({ organizationId: ORG, status: "draft" }).success).toBe(false);
  });
});
