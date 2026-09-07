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

// `chaine` alimente les deux lectures de verifyChainContinuity() :
//   • count()     → nombre d'AUTRES factures se déclarant tête de chaîne ;
//   • findFirst() → le prédécesseur désigné par previousHash, ou null.
// Défauts choisis pour que les tests antérieurs restent inchangés : une facture
// GENESIS seule dans son organisation est une chaîne valide.
function createFakePrisma(
  invoice: any,
  batchLeaves: { hash: string }[] = [],
  chaine: { autresTetes?: number; predecesseur?: any } = {},
) {
  return {
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      findMany: vi.fn().mockResolvedValue(batchLeaves),
      count: vi.fn().mockResolvedValue(chaine.autresTetes ?? 0),
      findFirst: vi.fn().mockResolvedValue(chaine.predecesseur ?? null),
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
    organizationId: "org-1",
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

// ADR-118/e1 — continuité du registre. Distincte de l'intégrité : toutes les
// factures de ce bloc sont RÉELLEMENT certifiées (pas de mock crypto), donc
// integrityValid vaut true partout — c'est bien chainValid, et lui seul, qui
// distingue une chaîne saine d'un registre forké.
describe("VerificationService — continuité de la chaîne (ADR-118/e1)", () => {
  // Fabrique une facture N certifiée, chaînée sur le hash fourni.
  function factureChainee(certification: StubEd25519CertificationService, previousHash: string) {
    const payload = {
      invoiceId: "inv-2",
      organizationNif: resolveNifForCertification("GN12345678"),
      number: "FG-2026-000002",
      totalTtc: 2_000_000n,
      issuedAt: "2026-08-09T10:00:00.000Z",
      previousHash,
    };
    const result = certification.certify(payload);
    return {
      id: payload.invoiceId,
      organizationId: "org-1",
      number: payload.number,
      certificationId: result.certificationId,
      status: "issued",
      disputeStatus: "none",
      validatedByAdministration: false,
      totalTtc: payload.totalTtc,
      issuedAt: new Date(payload.issuedAt),
      previousHash,
      hash: result.hash,
      signature: Buffer.from(result.signature, "hex"),
      signingKeyId: null as string | null,
      organization: { name: "Boutique Aissatou", nif: "GN12345678" },
      anchorBatchId: null as string | null,
      anchorBatch: null as Record<string, unknown> | null,
    };
  }

  it("chaîne parfaite : le prédécesseur existe et son hash recalculé recolle", async () => {
    const certification = new StubEd25519CertificationService();
    const predecesseur = issueGenuineInvoice(certification);
    const cible = factureChainee(certification, predecesseur.hash);
    const prisma = createFakePrisma(cible, [], { predecesseur });
    const service = new VerificationService(
      prisma as never,
      certification,
      createFakeSigningKeyService(certification) as never,
    );

    const resultat = await service.verifyByCertificationId(cible.certificationId);

    expect(resultat.integrityValid).toBe(true);
    expect(resultat.chainValid).toBe(true);
    expect(resultat.chainError).toBeNull();
  });

  it("maillon manquant : aucune facture émise ne porte le hash précédent", async () => {
    const certification = new StubEd25519CertificationService();
    const cible = factureChainee(certification, "hash-d-un-predecesseur-disparu");
    const prisma = createFakePrisma(cible, [], { predecesseur: null });
    const service = new VerificationService(
      prisma as never,
      certification,
      createFakeSigningKeyService(certification) as never,
    );

    const resultat = await service.verifyByCertificationId(cible.certificationId);

    // La signature de la facture CIBLE reste parfaite : c'est le registre qui
    // est cassé, pas le document. Les deux verdicts doivent diverger.
    expect(resultat.integrityValid).toBe(true);
    expect(resultat.chainValid).toBe(false);
    expect(resultat.chainError).toMatch(/Rupture de graphe en amont/);
  });

  it("prédécesseur ALTÉRÉ : sa colonne hash a été maquillée pour coller au maillon", async () => {
    const certification = new StubEd25519CertificationService();
    const predecesseur = issueGenuineInvoice(certification);
    const cible = factureChainee(certification, predecesseur.hash);
    // L'attaquant modifie le montant du prédécesseur mais laisse sa colonne
    // `hash` intacte : la recherche par hash le trouve toujours, et sans
    // recalcul le maillon paraîtrait sain.
    const predecesseurAltere = { ...predecesseur, totalTtc: 9_999_999n };
    const prisma = createFakePrisma(cible, [], { predecesseur: predecesseurAltere });
    const service = new VerificationService(
      prisma as never,
      certification,
      createFakeSigningKeyService(certification) as never,
    );

    const resultat = await service.verifyByCertificationId(cible.certificationId);

    expect(resultat.integrityValid).toBe(true);
    expect(resultat.chainValid).toBe(false);
    expect(resultat.chainError).toMatch(/hash recalculé du prédécesseur/);
  });

  it("registre FORKÉ : deux factures se déclarent tête de chaîne (cicatrice du bug 5e4f203)", async () => {
    const certification = new StubEd25519CertificationService();
    const cible = issueGenuineInvoice(certification); // previousHash === "GENESIS"
    const prisma = createFakePrisma(cible, [], { autresTetes: 1 });
    const service = new VerificationService(
      prisma as never,
      certification,
      createFakeSigningKeyService(certification) as never,
    );

    const resultat = await service.verifyByCertificationId(cible.certificationId);

    expect(resultat.integrityValid).toBe(true);
    expect(resultat.chainValid).toBe(false);
    expect(resultat.chainError).toMatch(/tête de chaîne/);
    // Ce cas n'a AUCUN maillon manquant : la règle « vérifier le prédécesseur
    // quand previousHash !== GENESIS » ne l'aurait jamais vu.
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("tête de chaîne LÉGITIME : seule facture GENESIS de son organisation", async () => {
    const certification = new StubEd25519CertificationService();
    const cible = issueGenuineInvoice(certification);
    const prisma = createFakePrisma(cible, [], { autresTetes: 0 });
    const service = new VerificationService(
      prisma as never,
      certification,
      createFakeSigningKeyService(certification) as never,
    );

    const resultat = await service.verifyByCertificationId(cible.certificationId);

    expect(resultat.chainValid).toBe(true);
    expect(resultat.chainError).toBeNull();
  });

  it("coût borné : jamais plus d'une lecture de prédécesseur, quelle que soit la chaîne", async () => {
    const certification = new StubEd25519CertificationService();
    const predecesseur = issueGenuineInvoice(certification);
    const cible = factureChainee(certification, predecesseur.hash);
    const prisma = createFakePrisma(cible, [], { predecesseur });
    const service = new VerificationService(
      prisma as never,
      certification,
      createFakeSigningKeyService(certification) as never,
    );

    await service.verifyByCertificationId(cible.certificationId);

    // Un endpoint public ne doit jamais remonter la chaîne : ce serait O(n) et
    // donc un levier de déni de service.
    expect(prisma.invoice.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.invoice.count).not.toHaveBeenCalled();
  });
});

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
        asOf: new Date("2026-08-08T10:00:00.000Z"),
        coverageFrom: new Date("2026-08-08T08:15:00.000Z"),
        merkleRoot,
        previousRoot: "GENESIS",
        leafCount: leaves.length,
        anchorStatus: "pending",
        anchorProof: null,
        anchorRef: null,
        anchoredAt: null,
      };
      const prisma = createFakePrisma(invoice, leaves);
      const service = new VerificationService(prisma as any, certification, {} as any);

      const result = await service.verifyByCertificationId(invoice.certificationId);

      expect(result.anchor).not.toBeNull();
      expect(result.anchor!.merkleRoot).toBe(merkleRoot);
      expect(result.anchor!.previousRoot).toBe("GENESIS");
      expect(result.anchor!.asOf).toBe("2026-08-08T10:00:00.000Z");
      expect(result.anchor!.coverageFrom).toBe("2026-08-08T08:15:00.000Z");
      expect(result.anchor!.leafCount).toBe(3);
      // la racine reconstruite depuis les feuilles vivantes recolle avec merkleRoot immuable
      expect(result.anchor!.integrityConsistent).toBe(true);
      expect(result.anchor!.externalAnchor.status).toBe("pending");
      expect(result.anchor!.externalAnchor.proof).toBeNull();
      // round-trip : la preuve exposée reconstruit bien la racine
      expect(
        verifyInclusionProof(invoice.hash, result.anchor!.inclusionProof, result.anchor!.merkleRoot),
      ).toBe(true);
      // cohérence avec un calcul indépendant
      expect(result.anchor!.inclusionProof).toEqual(
        buildInclusionProof(leaves.map((l) => l.hash), invoice.hash),
      );
    });

    it("integrityConsistent = false quand une facture-sœur de la tranche a divergé (feuille altérée)", async () => {
      const { buildMerkleRoot } = await import("../certification/merkle-anchor/merkle");
      const certification = new StubEd25519CertificationService();
      const invoice = issueGenuineInvoice(certification);
      const other1 = "aa".repeat(32);
      const other2 = "bb".repeat(32);
      const sealedLeaves = [invoice.hash, other1, other2].sort((a, b) => a.localeCompare(b));
      const merkleRoot = buildMerkleRoot(sealedLeaves);

      invoice.anchorBatchId = "batch-1";
      invoice.anchorBatch = {
        id: "batch-1",
        asOf: new Date("2026-08-08T10:00:00.000Z"),
        coverageFrom: new Date("2026-08-08T08:15:00.000Z"),
        merkleRoot,
        previousRoot: "GENESIS",
        leafCount: 3,
        anchorStatus: "pending",
        anchorProof: null,
        anchorRef: null,
        anchoredAt: null,
      };
      // une feuille-sœur a changé en base depuis le scellement
      const tamperedLeaves = [{ hash: invoice.hash }, { hash: "cc".repeat(32) }, { hash: other2 }].sort((a, b) =>
        a.hash.localeCompare(b.hash),
      );
      const prisma = createFakePrisma(invoice, tamperedLeaves);
      const service = new VerificationService(prisma as any, certification, {} as any);

      const result = await service.verifyByCertificationId(invoice.certificationId);

      expect(result.anchor!.integrityConsistent).toBe(false);
      expect(result.anchor!.inclusionProof).toEqual([]);
    });
  });
});
