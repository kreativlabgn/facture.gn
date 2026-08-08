import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { StubEd25519CertificationService } from "../certification/certification.service";
import { VerificationService } from "./verification.service";

function createFakePrisma(invoice: any) {
  return {
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
    },
  };
}

// Facture réellement certifiée par le service Ed25519 (pas de mock crypto) — les tests
// d'intégrité doivent passer par la même canonicalisation FGN-Canon-v1 que l'émission.
function issueGenuineInvoice(certification: StubEd25519CertificationService) {
  const payload = {
    invoiceId: "inv-1",
    organizationNif: "GN12345678",
    number: "FG-2026-000001",
    totalTtc: 1_500_000n,
    issuedAt: "2026-08-08T10:00:00.000Z",
    previousHash: "GENESIS",
  };
  const result = certification.certify(payload);

  return {
    id: payload.invoiceId,
    number: payload.number,
    certificationId: result.certificationId,
    status: "issued",
    disputeStatus: "none",
    validatedByAdministration: false,
    totalTtc: payload.totalTtc,
    issuedAt: new Date(payload.issuedAt),
    previousHash: payload.previousHash,
    hash: result.hash,
    signature: Buffer.from(result.signature, "hex"),
    organization: { name: "Boutique Aissatou", nif: payload.organizationNif },
  };
}

describe("VerificationService", () => {
  it("rejette un certification_id inconnu avec un message générique (404, pas de 500 brut)", async () => {
    const prisma = createFakePrisma(null);
    const certification = new StubEd25519CertificationService();
    const service = new VerificationService(prisma as any, certification);

    await expect(service.verifyByCertificationId("GN-INCONNU-2026-000000")).rejects.toThrow(NotFoundException);
  });

  it("confirme l'intégrité d'une facture émise et non altérée", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification);
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.integrityValid).toBe(true);
    expect(result.status).toBe("issued");
    expect(result.disputeStatus).toBe("none");
    expect(result.validatedByAdministration).toBe(false);
    expect(result.totalTtc).toBe("1500000");
    expect(result.organizationNif).toBe("GN12345678");
  });

  it("détecte une altération en base (hash stocké ne correspond plus aux champs recalculés) sans lever d'erreur HTTP", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification);
    invoice.totalTtc = 9_000_000n; // altéré après signature, hash/signature laissés inchangés
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.integrityValid).toBe(false);
  });

  it("reste vérifiable pour une facture annulée (voided) — le statut est affiché honnêtement, pas bloqué", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification);
    invoice.status = "voided";
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.status).toBe("voided");
    expect(result.integrityValid).toBe(true);
  });
});
