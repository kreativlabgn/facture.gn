import { describe, expect, it, vi } from "vitest";
import {
  formatReportingSeriesNumber,
  PdpReportingNumberingService,
} from "./pdp-reporting-numbering.service";

describe("formatReportingSeriesNumber", () => {
  it("formate ZR-YYYY-NNNNNN sur six chiffres", () => {
    expect(formatReportingSeriesNumber(2026, 1)).toBe("ZR-2026-000001");
    expect(formatReportingSeriesNumber(2026, 4)).toBe("ZR-2026-000004");
    expect(formatReportingSeriesNumber(2026, 123_456)).toBe("ZR-2026-123456");
  });

  // Le préfixe est ce qui rend les deux numérotations impossibles à confondre à
  // l'œil nu. Un Z porte les DEUX : FG-YYYY-NNNNNN (Article 23, opposable) et
  // ZR-YYYY-NNNNNN (rang dans la suite des Z de caisse).
  it("ne peut pas être confondu avec un numéro légal Article 23", () => {
    expect(formatReportingSeriesNumber(2026, 7)).toMatch(/^ZR-/);
    expect(formatReportingSeriesNumber(2026, 7)).not.toMatch(/^FG-/);
  });

  // Un rang 0 signifierait « aucun Z émis » — l'écrire sur un document certifié
  // serait un mensonge silencieux. Même garde que formatInvoiceNumber.
  it("refuse un rang qui ne désigne aucun Z", () => {
    expect(() => formatReportingSeriesNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatReportingSeriesNumber(2026, -1)).toThrow(RangeError);
    expect(() => formatReportingSeriesNumber(2026, 1.5)).toThrow(RangeError);
  });
});

describe("PdpReportingNumberingService", () => {
  const tx = (lignes: unknown) => ({ $queryRaw: vi.fn().mockResolvedValue(lignes) }) as never;

  it("rend le rang suivant de la série de l'organisation", async () => {
    await expect(
      new PdpReportingNumberingService().nextNumber("org-1", 2026, tx([{ last_number: 4 }])),
    ).resolves.toBe("ZR-2026-000004");
  });

  // L'incrément est ATOMIQUE, en une seule instruction : c'est le verrou de
  // ligne posé par ON CONFLICT DO UPDATE qui sérialise deux consolidations
  // concurrentes. Un SELECT puis un UPDATE laisserait deux passages rendre le
  // même rang.
  it("incrémente par upsert atomique, jamais par lecture puis écriture", async () => {
    const transaction = tx([{ last_number: 1 }]);

    await new PdpReportingNumberingService().nextNumber("org-1", 2026, transaction);

    const sql = ((transaction as unknown as { $queryRaw: { mock: { calls: string[][][] } } }).$queryRaw
      .mock.calls[0][0] as string[]).join(" ? ");
    expect(sql).toContain("INSERT INTO pdp_reporting_sequence");
    expect(sql).toContain("ON CONFLICT (organization_id, year)");
    expect(sql).toContain("DO UPDATE SET last_number = pdp_reporting_sequence.last_number + 1");
    expect(sql).toContain("RETURNING last_number");
    // Le compteur légal n'est JAMAIS touché : les deux séries vivent dans deux
    // tables distinctes, dont l'une est opposable en contrôle fiscal.
    expect(sql).not.toContain("invoice_sequence");
  });

  // Sous RLS FORCÉE, un WITH CHECK refusé ne lève pas toujours : l'INSERT peut
  // simplement ne rien rendre. Propagé, l'undefined produirait
  // « ZR-2026-undefined » sur une facture certifiée.
  it("refuse de fabriquer un numéro quand l'upsert ne rend aucun rang", async () => {
    await expect(
      new PdpReportingNumberingService().nextNumber("org-1", 2026, tx([])),
    ).rejects.toThrow(/aucun rang rendu/);
  });
});
