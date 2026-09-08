import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { EtaxSyncProcessor } from "./etax-sync.processor";
import { ETAX_INVOICE_JOB, ETAX_SYNC_JOB } from "./etax.constants";
import type { EtaxDeclarationPayload } from "./etax-declaration";
import type { EtaxInvoicePayload } from "./etax-invoice";

const JOB_DATA: EtaxDeclarationPayload = {
  organizationId: "org-1",
  fiscalPeriodId: "closing-1",
  year: 2025,
  etaxNumber: "ETAX-42",
  totalHt: "1000000",
  totalTva: "180000",
  totalTtc: "1180000",
  taxRateBps: 1800,
  taxCode: "TVA-18",
  sealHash: "sceau-abc",
};

const FACTURE_DATA: EtaxInvoicePayload = {
  invoiceId: "inv-1",
  organizationId: "org-1",
  etaxNumberEmetteur: "ETAX-42",
  nifAcquereur: "PARTICULIER",
  numero: "FG-2026-000042",
  certificationId: "GN-12345678-2026-ABC123",
  totalHt: "1000000",
  totalTva: "180000",
  totalTtc: "1180000",
  taxRateBps: 1800,
  taxCode: "TVA-18",
  issuedAt: "2026-09-08T10:00:00.000Z",
  hash: "hash-facture",
};

const job = (name: string, data: unknown, attemptsMade = 0) =>
  ({ name, data, attemptsMade }) as never;

const processeur = (declaration: unknown, facture: unknown = { processTransmission: vi.fn() }) =>
  new EtaxSyncProcessor(declaration as never, facture as never);

describe("EtaxSyncProcessor — aiguillage", () => {
  it("délègue une déclaration d'exercice au service de déclaration", async () => {
    const declaration = {
      processDeclaration: vi.fn().mockResolvedValue({ submissionRef: "ACK-1", skipped: false }),
    };
    const facture = { processTransmission: vi.fn() };

    await expect(processeur(declaration, facture).process(job(ETAX_SYNC_JOB, JOB_DATA))).resolves.toEqual({
      submissionRef: "ACK-1",
      skipped: false,
    });
    expect(declaration.processDeclaration).toHaveBeenCalledWith(JOB_DATA);
    expect(facture.processTransmission).not.toHaveBeenCalled();
  });

  it("délègue une facture au service de transmission unitaire", async () => {
    const declaration = { processDeclaration: vi.fn() };
    const facture = {
      processTransmission: vi.fn().mockResolvedValue({ receiptNumber: "RECU-9", skipped: false }),
    };

    await expect(
      processeur(declaration, facture).process(job(ETAX_INVOICE_JOB, FACTURE_DATA)),
    ).resolves.toEqual({ receiptNumber: "RECU-9", skipped: false });
    expect(facture.processTransmission).toHaveBeenCalledWith(FACTURE_DATA);
    expect(declaration.processDeclaration).not.toHaveBeenCalled();
  });

  // LE TEST QUI PROTÈGE LA COHABITATION. Les deux types de job partagent la même
  // file : sans aiguillage, une facture serait passée à processDeclaration avec
  // un payload incompatible — erreur obscure, et cinq réessais pour rien.
  it("ne confond jamais une facture avec une déclaration d'exercice", async () => {
    const declaration = { processDeclaration: vi.fn() };
    await processeur(declaration).process(job(ETAX_INVOICE_JOB, FACTURE_DATA));
    expect(declaration.processDeclaration).not.toHaveBeenCalled();
  });

  // Rejouer cinq fois un job qu'on ne sait pas traiter n'a jamais fait
  // apparaître le code manquant : UnrecoverableError coupe le backoff.
  it("refuse définitivement un type de job inconnu", async () => {
    const p = processeur({ processDeclaration: vi.fn() });
    await expect(p.process(job("transmettre-quelque-chose", {}))).rejects.toThrow(UnrecoverableError);
  });

  it("refuse aussi un job sans nom", async () => {
    const p = processeur({ processDeclaration: vi.fn() });
    await expect(p.process(job("", JOB_DATA))).rejects.toThrow(UnrecoverableError);
  });
});

describe("EtaxSyncProcessor — remontée des échecs", () => {
  // Le processeur ne rattrape RIEN, à dessein : c'est l'exception qui remonte
  // qui fait échouer le job et déclenche le backoff exponentiel. La rattraper
  // ici marquerait le job « completed » alors que la DGI n'a rien reçu — soit
  // exactement la panne silencieuse que la file est censée empêcher.
  it("laisse remonter l'échec d'une déclaration", async () => {
    const declaration = {
      processDeclaration: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")),
    };
    await expect(processeur(declaration).process(job(ETAX_SYNC_JOB, JOB_DATA))).rejects.toThrow(/503/);
  });

  it("laisse remonter l'échec d'une transmission unitaire", async () => {
    const facture = {
      processTransmission: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")),
    };
    await expect(
      processeur({ processDeclaration: vi.fn() }, facture).process(job(ETAX_INVOICE_JOB, FACTURE_DATA)),
    ).rejects.toThrow(/503/);
  });
});
