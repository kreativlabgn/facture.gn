import { describe, expect, it } from "vitest";
import {
  resolveNifForCertification,
  StubEd25519CertificationService,
  UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER,
} from "./certification.service";

describe("StubEd25519CertificationService", () => {
  it("certifie la première facture d'une organisation avec chain.prev = GENESIS", () => {
    const service = new StubEd25519CertificationService();

    const result = service.certify({
      invoiceId: "inv-001",
      organizationNif: "GN12345678",
      number: "FG-2026-000001",
      totalTtc: 1_500_000n,
      issuedAt: "2026-08-08T10:00:00.000Z",
      previousHash: "GENESIS",
    });

    expect(result.previousHash).toBe("GENESIS");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.certificationId).toBe(`GN-GN123456-2026-${result.hash.slice(0, 6).toUpperCase()}`);
  });

  it("chaîne la facture suivante sur le hash de la précédente", () => {
    const service = new StubEd25519CertificationService();

    const first = service.certify({
      invoiceId: "inv-001",
      organizationNif: "GN12345678",
      number: "FG-2026-000001",
      totalTtc: 1_500_000n,
      issuedAt: "2026-08-08T10:00:00.000Z",
      previousHash: "GENESIS",
    });

    const second = service.certify({
      invoiceId: "inv-002",
      organizationNif: "GN12345678",
      number: "FG-2026-000002",
      totalTtc: 2_000_000n,
      issuedAt: "2026-08-08T11:00:00.000Z",
      previousHash: first.hash,
    });

    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it("produit un hash et un certification_id déterministes pour un même payload", () => {
    const service = new StubEd25519CertificationService();

    const payload = {
      invoiceId: "inv-003",
      organizationNif: "GN99999999",
      number: "FG-2026-000003",
      totalTtc: 500_000n,
      issuedAt: "2026-08-08T12:00:00.000Z",
      previousHash: "GENESIS",
    };

    const a = service.certify(payload);
    const b = service.certify(payload);

    expect(a.hash).toBe(b.hash);
    expect(a.certificationId).toBe(b.certificationId);
  });

  it("signe le hash avec une signature Ed25519 vérifiable par la clé publique du service", () => {
    const service = new StubEd25519CertificationService();

    const result = service.certify({
      invoiceId: "inv-004",
      organizationNif: "GN11112222",
      number: "FG-2026-000004",
      totalTtc: 750_000n,
      issuedAt: "2026-08-08T13:00:00.000Z",
      previousHash: "GENESIS",
    });

    expect(service.verify(result)).toBe(true);
  });

  it("rejette un montant dépassant Number.MAX_SAFE_INTEGER (FGN-Canon-v1 exige un entier JSON exact)", () => {
    const service = new StubEd25519CertificationService();

    expect(() =>
      service.certify({
        invoiceId: "inv-005",
        organizationNif: "GN11112222",
        number: "FG-2026-000005",
        totalTtc: 9_007_199_254_740_993n,
        issuedAt: "2026-08-08T14:00:00.000Z",
        previousHash: "GENESIS",
      }),
    ).toThrow(RangeError);
  });
});

describe("resolveNifForCertification — organisation sans NIF (B1/B4, ADR-035)", () => {
  it("retourne un placeholder fixe de 8 caractères quand le NIF est null", () => {
    expect(resolveNifForCertification(null)).toBe(UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER);
    expect(UNVERIFIED_ORGANIZATION_NIF_PLACEHOLDER).toHaveLength(8);
  });

  it("retourne le NIF inchangé quand il est renseigné — jamais un placeholder pour une organisation vérifiée", () => {
    expect(resolveNifForCertification("GN12345678")).toBe("GN12345678");
  });
});
