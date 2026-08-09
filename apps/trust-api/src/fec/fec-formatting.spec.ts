import { describe, expect, it } from "vitest";
import { FEC_HEADER, formatFecAmount, formatFecDate, formatFecLine } from "./fec-formatting";

describe("FEC — formatage bas-niveau (F9, Article A47 A-1 du LPF)", () => {
  it("FEC_HEADER contient exactement les 18 colonnes légales, dans l'ordre", () => {
    expect(FEC_HEADER).toEqual([
      "JournalCode",
      "JournalLib",
      "EcritureNum",
      "EcritureDate",
      "CompteNum",
      "CompteLib",
      "CompAuxNum",
      "CompAuxLib",
      "PieceRef",
      "PieceDate",
      "EcritureLib",
      "Debit",
      "Credit",
      "EcritureLet",
      "DateLet",
      "ValidDate",
      "Montantdevise",
      "Idevise",
    ]);
  });

  it("formatFecDate convertit une Date en AAAAMMJJ", () => {
    expect(formatFecDate(new Date("2026-08-09T14:30:00.000Z"))).toBe("20260809");
  });

  it("formatFecAmount convertit des centimes GNF en GNF à 2 décimales", () => {
    expect(formatFecAmount(2_000_000n)).toBe("20000.00");
  });

  it("formatFecAmount renvoie une chaîne vide pour null (jamais 0.00 — colonne non concernée)", () => {
    expect(formatFecAmount(null)).toBe("");
  });

  it("formatFecLine joint les 18 champs par tabulation, colonnes auxiliaires toujours vides", () => {
    const line = formatFecLine({
      journalCode: "VE",
      journalLib: "Journal des ventes",
      ecritureNum: 1,
      ecritureDate: new Date("2026-08-09T00:00:00.000Z"),
      compteNum: "411",
      compteLib: "Clients",
      pieceRef: "FG-2026-000001",
      pieceDate: new Date("2026-08-09T00:00:00.000Z"),
      ecritureLib: "Facture FG-2026-000001",
      debit: 2_000_000n,
      credit: null,
      validDate: new Date("2026-08-09T00:00:00.000Z"),
    });

    expect(line.split("\t")).toEqual([
      "VE",
      "Journal des ventes",
      "1",
      "20260809",
      "411",
      "Clients",
      "",
      "",
      "FG-2026-000001",
      "20260809",
      "Facture FG-2026-000001",
      "20000.00",
      "",
      "",
      "",
      "20260809",
      "",
      "",
    ]);
  });
});
