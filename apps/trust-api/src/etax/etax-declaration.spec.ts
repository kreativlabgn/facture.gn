import { describe, expect, it } from "vitest";
import { buildEtaxDeclaration, resolveTaxCode } from "./etax-declaration";

const CLOTURE = {
  id: "closing-1",
  organizationId: "org-1",
  year: 2025,
  totalHt: 1_000_000n,
  totalTva: 180_000n,
  totalTtc: 1_180_000n,
  sealHash: "sceau-abc",
};

describe("resolveTaxCode — code de régime transmis à la DGI", () => {
  it("normal_tva déclare sous TVA-18", () => {
    expect(resolveTaxCode("normal_tva")).toBe("TVA-18");
  });

  // Les trois régimes à 0 bps remplissent trois cases différentes chez la DGI :
  // un forfaitaire TPU, un assujetti sans TVA et une association exonérée ne
  // sont pas la même déclaration. Les fondre en un code unique « 0 % »
  // produirait des déclarations formellement fausses.
  it("les trois régimes à 0 % gardent des codes DISTINCTS", () => {
    const codes = [
      resolveTaxCode("tpu"),
      resolveTaxCode("normal_sans_tva"),
      resolveTaxCode("non_assujetti_association"),
    ];
    expect(new Set(codes).size).toBe(3);
    expect(codes).toEqual(["TPU", "HORS-TVA", "EXO-ASSO"]);
  });
});

describe("buildEtaxDeclaration", () => {
  it("transmet les montants et le taux du régime de l'organisation", () => {
    const payload = buildEtaxDeclaration(CLOTURE, { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" });

    expect(payload).toEqual({
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
    });
  });

  // BullMQ écrit `data` en JSON dans Redis, et JSON.stringify(1n) LÈVE. main.ts
  // pose bien un BigInt.prototype.toJSON global, mais ce patch n'existe ni dans
  // les tests ni dans un worker sorti dans son propre process : la conversion
  // doit tenir sans lui. Ce test échouerait si les montants restaient bigint.
  it("le payload est sérialisable en JSON sans dépendre du patch global BigInt", () => {
    const payload = buildEtaxDeclaration(CLOTURE, { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" });

    const toJSON = (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON;
    delete (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON;
    try {
      expect(() => JSON.stringify(payload)).not.toThrow();
      expect(JSON.parse(JSON.stringify(payload)).totalTtc).toBe("1180000");
    } finally {
      if (toJSON) (BigInt.prototype as unknown as { toJSON?: unknown }).toJSON = toJSON;
    }
  });

  // Chaîne et non Number : un total annuel peut dépasser 2^53 francs guinéens
  // (~9·10^15, soit ~9 millions de milliards GNF). Un Number perdrait de la
  // précision SILENCIEUSEMENT, sur une déclaration fiscale.
  it("les montants sont des chaînes, jamais des Number", () => {
    const payload = buildEtaxDeclaration(
      { ...CLOTURE, totalTtc: 9_007_199_254_740_993n },
      { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" },
    );

    expect(typeof payload.totalTtc).toBe("string");
    expect(payload.totalTtc).toBe("9007199254740993");
    expect(Number(payload.totalTtc).toString()).not.toBe(payload.totalTtc);
  });

  it("refuse de construire une déclaration sans numéro eTax", () => {
    expect(() => buildEtaxDeclaration(CLOTURE, { etaxNumber: null, regimeFiscal: "normal_tva" })).toThrow(
      /sans numéro eTax/,
    );
  });
});
