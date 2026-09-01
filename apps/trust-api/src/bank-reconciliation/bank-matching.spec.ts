import { describe, expect, it } from "vitest";

import {
  fingerprint,
  normalizeLabel,
  suggestMatches,
  type MatchableInvoice,
} from "./bank-matching";

const ORG = "11111111-1111-1111-1111-111111111111";

function invoice(overrides: Partial<MatchableInvoice> = {}): MatchableInvoice {
  return {
    id: "inv-1",
    number: "FG-2026-000042",
    certificationId: "GN-12345678-2026-ABCDEF",
    amountDue: 1_500_000n,
    issuedAt: new Date("2026-08-01T09:00:00.000Z"),
    ...overrides,
  };
}

describe("normalizeLabel", () => {
  it("passe en minuscules, retire la ponctuation et les accents", () => {
    expect(normalizeLabel("VIR SEPA / FG-2026-000042 / SARL DÉLTA")).toBe(
      "vir sepa fg 2026 000042 sarl delta",
    );
  });

  it("compresse les espaces multiples et rogne les bornes", () => {
    expect(normalizeLabel("  ABC   --   DEF  ")).toBe("abc def");
  });
});

describe("fingerprint", () => {
  const base = {
    organizationId: ORG,
    valueDate: new Date("2026-08-20T00:00:00.000Z"),
    amountCentimes: 1_500_000n,
    rawLabel: "VIR RECU FG-2026-000042",
  };

  it("est déterministe et fait 64 caractères hex", () => {
    const a = fingerprint(base);
    const b = fingerprint({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("l'heure de la date de valeur ne change rien (date seule)", () => {
    expect(fingerprint({ ...base, valueDate: new Date("2026-08-20T23:59:59.000Z") })).toBe(
      fingerprint(base),
    );
  });

  it("deux montants différents → deux empreintes différentes", () => {
    expect(fingerprint({ ...base, amountCentimes: 1_500_001n })).not.toBe(fingerprint(base));
  });

  it("deux organisations différentes → deux empreintes différentes", () => {
    expect(fingerprint({ ...base, organizationId: "other-org" })).not.toBe(fingerprint(base));
  });
});

describe("suggestMatches", () => {
  const tx = {
    valueDate: new Date("2026-08-10T00:00:00.000Z"),
    amountCentimes: 1_500_000n,
    rawLabel: "VIR RECU / FG-2026-000042 / SARL DELTA",
  };

  it("montant exact + numéro dans le libellé → strong, deux raisons", () => {
    const [s] = suggestMatches(tx, [invoice()]);
    expect(s.confidence).toBe("strong");
    expect(s.reasons).toEqual(
      expect.arrayContaining(["montant exact", "référence FG-2026-000042 dans le libellé"]),
    );
  });

  it("montant exact seul → probable", () => {
    const [s] = suggestMatches(
      { ...tx, rawLabel: "VIR RECU SANS REFERENCE" },
      [invoice({ certificationId: null })],
    );
    expect(s.confidence).toBe("probable");
    expect(s.reasons).toContain("montant exact");
  });

  it("certificationId dans le libellé seul → probable", () => {
    const [s] = suggestMatches(
      { ...tx, amountCentimes: 999n, rawLabel: "paiement GN-12345678-2026-ABCDEF" },
      [invoice({ number: null })],
    );
    expect(s.confidence).toBe("probable");
    expect(s.reasons).toContain("référence GN-12345678-2026-ABCDEF dans le libellé");
  });

  it("émise il y a 10 j, aucun autre signal → weak", () => {
    const [s] = suggestMatches(
      { valueDate: new Date("2026-08-11T00:00:00.000Z"), amountCentimes: 42n, rawLabel: "rien" },
      [invoice({ number: null, certificationId: null, issuedAt: new Date("2026-08-01T00:00:00Z") })],
    );
    expect(s.confidence).toBe("weak");
    expect(s.reasons).toEqual(["émise dans la fenêtre"]);
  });

  it("émise il y a 40 j (hors fenêtre), aucun autre signal → aucune suggestion", () => {
    const result = suggestMatches(
      { valueDate: new Date("2026-09-10T00:00:00.000Z"), amountCentimes: 42n, rawLabel: "rien" },
      [invoice({ number: null, certificationId: null, issuedAt: new Date("2026-08-01T00:00:00Z") })],
    );
    expect(result).toEqual([]);
  });

  it("à confiance égale, trie par proximité de solde croissante", () => {
    // tx à 1 500 000 ; les deux factures matchent par référence (probable),
    // solde différent → la plus proche du montant du virement d'abord.
    const far = invoice({ id: "inv-far", certificationId: null, amountDue: 3_000_000n });
    const near = invoice({ id: "inv-near", certificationId: null, amountDue: 1_600_000n });
    const result = suggestMatches({ ...tx, amountCentimes: 1_500_000n }, [far, near]);
    expect(result.map((s) => s.invoiceId)).toEqual(["inv-near", "inv-far"]);
  });

  it("émise exactement à la limite de la fenêtre (30 j) → weak ; à 31 j → aucune suggestion", () => {
    const at30 = suggestMatches(
      { valueDate: new Date("2026-08-31T00:00:00Z"), amountCentimes: 1n, rawLabel: "x" },
      [invoice({ number: null, certificationId: null, issuedAt: new Date("2026-08-01T00:00:00Z") })],
    );
    expect(at30[0]?.confidence).toBe("weak");
    const at31 = suggestMatches(
      { valueDate: new Date("2026-09-01T00:00:00Z"), amountCentimes: 1n, rawLabel: "x" },
      [invoice({ number: null, certificationId: null, issuedAt: new Date("2026-08-01T00:00:00Z") })],
    );
    expect(at31).toEqual([]);
  });

  it("virement daté AVANT l'émission de la facture (délai négatif) → hors fenêtre", () => {
    const result = suggestMatches(
      { valueDate: new Date("2026-07-20T00:00:00Z"), amountCentimes: 1n, rawLabel: "x" },
      [invoice({ number: null, certificationId: null, issuedAt: new Date("2026-08-01T00:00:00Z") })],
    );
    expect(result).toEqual([]);
  });

  it("trie strong avant probable avant weak", () => {
    const strong = invoice({ id: "s" });
    const probableInv = invoice({ id: "p", number: null, certificationId: null, amountDue: 1_500_000n });
    const weakInv = invoice({
      id: "w",
      number: null,
      certificationId: null,
      amountDue: 42n,
      issuedAt: new Date("2026-08-05T00:00:00Z"),
    });
    const result = suggestMatches(tx, [weakInv, probableInv, strong]);
    expect(result.map((s) => s.invoiceId)).toEqual(["s", "p", "w"]);
  });
});
