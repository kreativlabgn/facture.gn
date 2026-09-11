import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { PdpProcessor } from "./pdp.processor";
import { ETAX_INVOICING_UNITARY, ETAX_REPORTING_PERIODIC } from "./pdp.constants";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";

const PAYLOAD: PdpInvoicingJobPayload = {
  rawTransactionId: "11111111-2222-3333-4444-555555555555",
  organizationId: "org-1",
  clientUniqueId: "INV/2026/00042",
};

const RESULTAT = {
  rawTransactionId: PAYLOAD.rawTransactionId,
  invoiceId: "inv-1",
  certificationId: "GN-12345678-2026-ABC123",
  skipped: false,
};

const job = (name: string, data: unknown = PAYLOAD, attemptsMade = 0) =>
  ({ name, data, attemptsMade }) as never;

const processeur = (consolidation: unknown) => new PdpProcessor(consolidation as never);

describe("PdpProcessor — aiguillage sur job.name", () => {
  it("délègue un document unitaire au service de consolidation", async () => {
    const consolidation = { consolidateUnitary: vi.fn().mockResolvedValue(RESULTAT) };

    await expect(processeur(consolidation).process(job(ETAX_INVOICING_UNITARY))).resolves.toEqual(
      RESULTAT,
    );
    // Le payload est passé TEL QUEL : c'est le service qui relit la ligne
    // tampon, le processeur n'interprète jamais le document.
    expect(consolidation.consolidateUnitary).toHaveBeenCalledWith(PAYLOAD);
  });

  // LE TEST QUI PROTÈGE LE FLUX B2C. Un lot de caisse consolidé à l'unité
  // produirait une facture certifiée — et un numéro Article 23 consommé — par
  // micro-vente, là où la DGI attend un Z de caisse agrégé. Irréversible.
  it("ne consolide JAMAIS un lot e-reporting", async () => {
    const consolidation = { consolidateUnitary: vi.fn() };

    await expect(processeur(consolidation).process(job(ETAX_REPORTING_PERIODIC))).resolves.toBeNull();
    expect(consolidation.consolidateUnitary).not.toHaveBeenCalled();
  });

  // Le pendant : un lot e-reporting ne doit pas non plus mourir en
  // UnrecoverableError. La branche existe pour NE RIEN FAIRE explicitement — la
  // supprimer ferait perdre sans réessai le premier job du cron de regroupement.
  it("acquitte un lot e-reporting au lieu de le refuser", async () => {
    await expect(
      processeur({ consolidateUnitary: vi.fn() }).process(job(ETAX_REPORTING_PERIODIC)),
    ).resolves.not.toThrow();
  });

  // Rejouer cinq fois un job qu'on ne sait pas traiter n'a jamais fait
  // apparaître le code manquant : UnrecoverableError coupe le backoff.
  it("refuse définitivement un type de job inconnu", async () => {
    await expect(
      processeur({ consolidateUnitary: vi.fn() }).process(job("consolider-quelque-chose")),
    ).rejects.toThrow(UnrecoverableError);
  });

  it("refuse aussi un job sans nom", async () => {
    await expect(processeur({ consolidateUnitary: vi.fn() }).process(job(""))).rejects.toThrow(
      UnrecoverableError,
    );
  });

  // Garde de non-régression sur le nom lui-même : la valeur de la constante est
  // ce que PdpInvoiceService.enfiler() écrit dans Redis. La changer d'un côté
  // seulement laisserait les jobs déjà déposés tomber sur la branche inconnue.
  it("reconnaît exactement les noms enfilés par l'ingestion", async () => {
    const consolidation = { consolidateUnitary: vi.fn().mockResolvedValue(RESULTAT) };
    await expect(
      processeur(consolidation).process(job("etax-invoicing-unitary")),
    ).resolves.toEqual(RESULTAT);
  });
});

describe("PdpProcessor — remontée des échecs", () => {
  // Le processeur ne rattrape RIEN, à dessein : c'est l'exception qui remonte
  // qui fait échouer le job et déclenche le backoff exponentiel. La rattraper
  // ici marquerait le job « completed » alors que rien n'a été certifié.
  it("laisse remonter une panne passagère du service", async () => {
    const consolidation = {
      consolidateUnitary: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")),
    };

    await expect(processeur(consolidation).process(job(ETAX_INVOICING_UNITARY))).rejects.toThrow(
      /503/,
    );
  });

  it("laisse remonter un refus définitif sans le convertir", async () => {
    const consolidation = {
      consolidateUnitary: vi
        .fn()
        .mockRejectedValue(new UnrecoverableError("Document PDP refusé définitivement : 400")),
    };

    await expect(processeur(consolidation).process(job(ETAX_INVOICING_UNITARY))).rejects.toThrow(
      UnrecoverableError,
    );
  });
});
