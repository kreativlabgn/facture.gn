import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PdpController } from "./pdp.controller";
import type { CreatePdpInvoiceDto } from "./dto/create-pdp-invoice.dto";
import type { PdpIngestionResult } from "./pdp-invoice.service";

const CLIENT = { organizationId: "org-1", apiKeyId: "key-1" };
const PAYLOAD_BRUT = { clientUniqueId: "INV/2026/00042", totalHT: "1000000" };

const DTO = {
  clientUniqueId: "INV/2026/00042",
  transactionType: "b2b",
  totalHT: BigInt(100_000_000),
  totalVAT: BigInt(18_000_000),
  issueDate: new Date("2026-09-09T10:00:00.000Z"),
} as unknown as CreatePdpInvoiceDto;

function resultat(overrides: Partial<PdpIngestionResult> = {}): PdpIngestionResult {
  return {
    outcome: "accepted",
    transactionId: "raw-1",
    clientUniqueId: "INV/2026/00042",
    flow: "e_invoicing",
    status: "pending",
    receipt: null,
    ...overrides,
  };
}

function fakeResponse() {
  return { status: vi.fn().mockReturnThis() };
}

function controleur(ingestResult: PdpIngestionResult) {
  const pdpInvoiceService = { ingest: vi.fn().mockResolvedValue(ingestResult) };
  return { controller: new PdpController(pdpInvoiceService as any), pdpInvoiceService };
}

describe("PdpController POST /api/v1/pdp/invoices (ADR-107)", () => {
  // 202 et non 200 : le travail est ACCEPTÉ, pas terminé. Le connecteur doit
  // pouvoir distinguer les deux — c'est sur ce code qu'il décide de rejouer.
  it("répond 202 Accepted pour un document nouveau", async () => {
    const { controller } = controleur(resultat());
    const response = fakeResponse();

    await controller.createInvoice(DTO, PAYLOAD_BRUT, CLIENT, response as any);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
  });

  // L'exigence explicite du cahier des charges : un rejeu déjà traité rend
  // 200 OK synchrone, avec le reçu existant.
  it("répond 200 OK pour un rejeu, en joignant le reçu existant", async () => {
    const recu = {
      certificationId: "GN-12345678-2026-ABC123",
      invoiceId: "inv-1",
      verificationUrl: "https://verify.facture.gn/GN-12345678-2026-ABC123",
      qrCode: "data:image/png;base64,AAAA",
    };
    const { controller } = controleur(resultat({ outcome: "duplicate", status: "certified", receipt: recu }));
    const response = fakeResponse();

    const rendu = await controller.createInvoice(DTO, PAYLOAD_BRUT, CLIENT, response as any);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(rendu.receipt).toEqual(recu);
  });

  it("rend le résultat du service tel quel", async () => {
    const attendu = resultat();
    const { controller } = controleur(attendu);

    const rendu = await controller.createInvoice(DTO, PAYLOAD_BRUT, CLIENT, fakeResponse() as any);

    expect(rendu).toBe(attendu);
  });

  // Le corps BRUT, et non le DTO reconstruit, est ce qui part à l'archivage :
  // c'est la pièce à produire si un client conteste ce que son ERP a envoyé.
  it("transmet au service le DTO validé ET le corps brut, distinctement", async () => {
    const { controller, pdpInvoiceService } = controleur(resultat());

    await controller.createInvoice(DTO, PAYLOAD_BRUT, CLIENT, fakeResponse() as any);

    expect(pdpInvoiceService.ingest).toHaveBeenCalledWith(DTO, CLIENT, PAYLOAD_BRUT);
  });

  // L'identité du connecteur vient du garde, jamais du corps.
  it("passe le connecteur résolu par le garde, jamais une valeur du payload", async () => {
    const { controller, pdpInvoiceService } = controleur(resultat());

    await controller.createInvoice(
      DTO,
      { ...PAYLOAD_BRUT, organizationId: "org-de-la-victime" },
      CLIENT,
      fakeResponse() as any,
    );

    expect(pdpInvoiceService.ingest).toHaveBeenCalledWith(expect.anything(), CLIENT, expect.anything());
  });
});
