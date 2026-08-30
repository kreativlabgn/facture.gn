import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { resolveNifForCertification, StubEd25519CertificationService } from "../certification/certification.service";
import { VerificationService } from "./verification.service";

// A3, ADR-026 — double de OrganizationSigningKeyService. Ne signe jamais
// réellement ici : verifyWithKey() délègue à un StubEd25519CertificationService
// réel (même précédent que le reste de ce fichier, "pas de mock crypto").
function createFakeSigningKeyService(certification: StubEd25519CertificationService, revokedAt: Date | null = null) {
  return {
    verifyWithKey: vi.fn(async (_signingKeyId: string, payload: any) => ({
      ...certification.certify(payload),
      revokedAt,
    })),
  };
}

function createFakePrisma(invoice: any, batchLeaves: { hash: string }[] = []) {
  return {
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      findMany: vi.fn().mockResolvedValue(batchLeaves),
    },
  };
}

// Facture réellement certifiée par le service Ed25519 (pas de mock crypto) — les tests
// d'intégrité doivent passer par la même canonicalisation FGN-Canon-v1 que l'émission.
// organizationNif: null simule une organisation sans NIF (B1/B4) — resolveNifForCertification()
// est appliqué ici exactement comme dans invoices.service.ts au moment réel de l'émission.
function issueGenuineInvoice(certification: StubEd25519CertificationService, organizationNif: string | null = "GN12345678") {
  const payload = {
    invoiceId: "inv-1",
    organizationNif: resolveNifForCertification(organizationNif),
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
    organization: { name: "Boutique Aissatou", nif: organizationNif },
    anchorBatchId: null as string | null,
    anchorBatch: null as Record<string, unknown> | null,
  };
}

describe("VerificationService", () => {
  it("rejette un certification_id inconnu avec un message générique (404, pas de 500 brut)", async () => {
    const prisma = createFakePrisma(null);
    const certification = new StubEd25519CertificationService();
    const service = new VerificationService(prisma as any, certification, createFakeSigningKeyService(certification) as any);

    await expect(service.verifyByCertificationId("GN-INCONNU-2026-000000")).rejects.toThrow(NotFoundException);
  });

  it("confirme l'intégrité d'une facture émise et non altérée", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification);
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification, createFakeSigningKeyService(certification) as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.integrityValid).toBe(true);
    expect(result.status).toBe("issued");
    expect(result.disputeStatus).toBe("none");
    expect(result.validatedByAdministration).toBe(false);
    expect(result.totalTtc).toBe("1500000");
    expect(result.organizationNif).toBe("GN12345678");
    // A4, ADR-025 — clé légataire globale (signingKeyId null) : aucun registre
    // de révocation dans ce repo pour ce mécanisme, toujours valide.
    expect(result.keyValidAtIssuance).toBe(true);
  });

  it("détecte une altération en base (hash stocké ne correspond plus aux champs recalculés) sans lever d'erreur HTTP", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification);
    invoice.totalTtc = 9_000_000n; // altéré après signature, hash/signature laissés inchangés
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification, createFakeSigningKeyService(certification) as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.integrityValid).toBe(false);
  });

  it("reste vérifiable pour une facture annulée (voided) — le statut est affiché honnêtement, pas bloqué", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification);
    invoice.status = "voided";
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification, createFakeSigningKeyService(certification) as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.status).toBe("voided");
    expect(result.integrityValid).toBe(true);
  });

  it("confirme l'intégrité d'une facture d'organisation sans NIF ET ne fuite jamais le placeholder interne (B1/B4)", async () => {
    const certification = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoice(certification, null);
    const prisma = createFakePrisma(invoice);
    const service = new VerificationService(prisma as any, certification, createFakeSigningKeyService(certification) as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.integrityValid).toBe(true);
    expect(result.organizationNif).toBeNull();
    expect(result.organizationNif).not.toBe("UNVERIFI");
  });
});

describe("VerificationService — factures signées par la clé propre de l'organisation (A3, ADR-026)", () => {
  // signingKeyId non-null : la clé légataire globale n'est JAMAIS utilisée pour
  // ce chemin (organizationKey est une instance DIFFÉRENTE, avec sa propre paire
  // de clés Ed25519) — prouve que la branche récupère bien la clé référencée par
  // l'invoice, pas la clé globale injectée par ailleurs dans le service.
  function issueGenuineInvoiceWithOwnKey(organizationKey: StubEd25519CertificationService) {
    const payload = {
      invoiceId: "inv-1",
      organizationNif: "GN12345678",
      number: "FG-2026-000001",
      totalTtc: 1_500_000n,
      issuedAt: "2026-08-08T10:00:00.000Z",
      previousHash: "GENESIS",
    };
    const result = organizationKey.certify(payload);

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
      signingKeyId: "signing-key-1",
      organization: { name: "Boutique Aissatou", nif: "GN12345678" },
    };
  }

  it("confirme l'intégrité via la clé propre de l'organisation, jamais la clé globale légataire", async () => {
    const legacyGlobalKey = new StubEd25519CertificationService();
    const organizationKey = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoiceWithOwnKey(organizationKey);
    const prisma = createFakePrisma(invoice);
    const signingKeyService = createFakeSigningKeyService(organizationKey);
    const service = new VerificationService(prisma as any, legacyGlobalKey, signingKeyService as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(signingKeyService.verifyWithKey).toHaveBeenCalledWith("signing-key-1", expect.anything());
    expect(result.integrityValid).toBe(true);
  });

  it("détecte une altération en base même pour une facture signée par la clé propre de l'organisation", async () => {
    const legacyGlobalKey = new StubEd25519CertificationService();
    const organizationKey = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoiceWithOwnKey(organizationKey);
    invoice.totalTtc = 9_000_000n; // altéré après signature
    const prisma = createFakePrisma(invoice);
    const signingKeyService = createFakeSigningKeyService(organizationKey);
    const service = new VerificationService(prisma as any, legacyGlobalKey, signingKeyService as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.integrityValid).toBe(false);
  });
});

describe("VerificationService — keyValidAtIssuance (A4, ADR-025)", () => {
  function issueGenuineInvoiceWithOwnKey(organizationKey: StubEd25519CertificationService, issuedAt = "2026-08-08T10:00:00.000Z") {
    const payload = {
      invoiceId: "inv-1",
      organizationNif: "GN12345678",
      number: "FG-2026-000001",
      totalTtc: 1_500_000n,
      issuedAt,
      previousHash: "GENESIS",
    };
    const result = organizationKey.certify(payload);

    return {
      id: payload.invoiceId,
      number: payload.number,
      certificationId: result.certificationId,
      status: "issued",
      disputeStatus: "none",
      validatedByAdministration: false,
      totalTtc: payload.totalTtc,
      issuedAt: new Date(issuedAt),
      previousHash: payload.previousHash,
      hash: result.hash,
      signature: Buffer.from(result.signature, "hex"),
      signingKeyId: "signing-key-1",
      organization: { name: "Boutique Aissatou", nif: "GN12345678" },
    };
  }

  it("keyValidAtIssuance = true quand la clé n'a jamais été révoquée", async () => {
    const organizationKey = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoiceWithOwnKey(organizationKey);
    const prisma = createFakePrisma(invoice);
    const signingKeyService = createFakeSigningKeyService(organizationKey, null);
    const service = new VerificationService(prisma as any, new StubEd25519CertificationService(), signingKeyService as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.keyValidAtIssuance).toBe(true);
    expect(signingKeyService.verifyWithKey).toHaveBeenCalledWith("signing-key-1", expect.anything());
  });

  it("keyValidAtIssuance = true quand la clé a été révoquée APRÈS l'émission — révocation jamais rétroactive (ADR-025)", async () => {
    const organizationKey = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoiceWithOwnKey(organizationKey, "2026-08-08T10:00:00.000Z");
    const prisma = createFakePrisma(invoice);
    const revokedAt = new Date("2026-08-20T00:00:00.000Z"); // après l'émission
    const signingKeyService = createFakeSigningKeyService(organizationKey, revokedAt);
    const service = new VerificationService(prisma as any, new StubEd25519CertificationService(), signingKeyService as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.keyValidAtIssuance).toBe(true);
    expect(result.integrityValid).toBe(true); // la révocation ne touche jamais l'intégrité
  });

  it("récupère le statut de révocation via verifyWithKey() uniquement — jamais un second aller-retour DB redondant sur ce endpoint public", async () => {
    const organizationKey = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoiceWithOwnKey(organizationKey);
    const prisma = createFakePrisma(invoice);
    const signingKeyService = createFakeSigningKeyService(organizationKey, null);
    const service = new VerificationService(prisma as any, new StubEd25519CertificationService(), signingKeyService as any);

    await service.verifyByCertificationId(invoice.certificationId);

    expect(signingKeyService.verifyWithKey).toHaveBeenCalledTimes(1);
  });

  it("keyValidAtIssuance = false quand la clé était déjà révoquée AVANT l'émission", async () => {
    const organizationKey = new StubEd25519CertificationService();
    const invoice = issueGenuineInvoiceWithOwnKey(organizationKey, "2026-08-20T10:00:00.000Z");
    const prisma = createFakePrisma(invoice);
    const revokedAt = new Date("2026-08-15T00:00:00.000Z"); // avant l'émission
    const signingKeyService = createFakeSigningKeyService(organizationKey, revokedAt);
    const service = new VerificationService(prisma as any, new StubEd25519CertificationService(), signingKeyService as any);

    const result = await service.verifyByCertificationId(invoice.certificationId);

    expect(result.keyValidAtIssuance).toBe(false);
  });

  describe("preuve d'inclusion Merkle (E1, ADR-115)", () => {
    it("anchor: null tant que la facture n'est pas scellée dans une tranche", async () => {
      const certification = new StubEd25519CertificationService();
      const invoice = issueGenuineInvoice(certification);
      const prisma = createFakePrisma(invoice);
      const service = new VerificationService(prisma as any, certification, {} as any);

      const result = await service.verifyByCertificationId(invoice.certificationId);

      expect(result.anchor).toBeNull();
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it("facture scellée : la preuve d'inclusion reconstruit la racine de la tranche", async () => {
      const { buildInclusionProof, buildMerkleRoot, verifyInclusionProof } = await import(
        "../certification/merkle-anchor/merkle"
      );
      const certification = new StubEd25519CertificationService();
      const invoice = issueGenuineInvoice(certification);
      // tranche = notre facture + 2 autres hashes
      const other1 = "aa".repeat(32);
      const other2 = "bb".repeat(32);
      const leaves = [{ hash: invoice.hash }, { hash: other1 }, { hash: other2 }].sort((a, b) =>
        a.hash.localeCompare(b.hash),
      );
      const merkleRoot = buildMerkleRoot(leaves.map((l) => l.hash));

      invoice.anchorBatchId = "batch-1";
      invoice.anchorBatch = {
        id: "batch-1",
        hourStart: new Date("2026-08-08T09:00:00.000Z"),
        merkleRoot,
        previousRoot: "GENESIS",
        anchorStatus: "pending",
        anchorRef: null,
        anchoredAt: null,
      };
      const prisma = createFakePrisma(invoice, leaves);
      const service = new VerificationService(prisma as any, certification, {} as any);

      const result = await service.verifyByCertificationId(invoice.certificationId);

      expect(result.anchor).not.toBeNull();
      expect(result.anchor!.merkleRoot).toBe(merkleRoot);
      expect(result.anchor!.previousRoot).toBe("GENESIS");
      expect(result.anchor!.externalAnchor.status).toBe("pending");
      // round-trip : la preuve exposée reconstruit bien la racine
      expect(
        verifyInclusionProof(invoice.hash, result.anchor!.inclusionProof, result.anchor!.merkleRoot),
      ).toBe(true);
      // cohérence avec un calcul indépendant
      expect(result.anchor!.inclusionProof).toEqual(
        buildInclusionProof(leaves.map((l) => l.hash), invoice.hash),
      );
    });
  });
});
