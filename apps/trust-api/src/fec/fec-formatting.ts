// FEC — format légal standard (Article A47 A-1 du LPF), 18 colonnes tabulées,
// UTF-8. Adopté faute de spec FEC propre au projet (Backlog/DAT/CdC/ADR/ERD ne
// définissent que le nom "FEC", jamais les colonnes) — décision actée
// explicitement avec l'utilisateur (voir docs/plans/2026-08-09-fec-export.md).
export const FEC_HEADER = [
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
] as const;

export interface FecFields {
  journalCode: string;
  journalLib: string;
  ecritureNum: number;
  ecritureDate: Date;
  compteNum: string;
  compteLib: string;
  pieceRef: string;
  pieceDate: Date;
  ecritureLib: string;
  debit: bigint | null;
  credit: bigint | null;
  validDate: Date;
}

export function formatFecDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

// centimes GNF (100 centimes = 1 GNF, DAT) → GNF, 2 décimales — jamais "0.00"
// pour un montant absent (colonne Debit XOR Credit renseignée par écriture).
export function formatFecAmount(centimes: bigint | null): string {
  if (centimes === null) {
    return "";
  }
  const whole = centimes / 100n;
  const fraction = (centimes % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

// CompAuxNum/CompAuxLib/EcritureLet/DateLet/Montantdevise/Idevise toujours
// vides — aucun Customer individuel, aucun lettrage, aucune devise étrangère
// wired dans cette story (hors scope, voir plan).
export function formatFecLine(fields: FecFields): string {
  return [
    fields.journalCode,
    fields.journalLib,
    String(fields.ecritureNum),
    formatFecDate(fields.ecritureDate),
    fields.compteNum,
    fields.compteLib,
    "",
    "",
    fields.pieceRef,
    formatFecDate(fields.pieceDate),
    fields.ecritureLib,
    formatFecAmount(fields.debit),
    formatFecAmount(fields.credit),
    "",
    "",
    formatFecDate(fields.validDate),
    "",
    "",
  ].join("\t");
}
