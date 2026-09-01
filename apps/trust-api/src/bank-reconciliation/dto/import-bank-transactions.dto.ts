import { z } from "zod";

import { MAX_IMPORT_BATCH_SIZE } from "../bank-reconciliation.constants";

// Lot rapprochement bancaire (ADR-052, ADR-117 provisoire) — la PWA parse le
// fichier bancaire (CSV/OFX/MT940) et pousse ce contrat JSON stable. Le backend
// ne parse aucun fichier (cf. plan, "Alternatives écartées").
//
// Contrairement à l'import clients (E9, tolérant ligne à ligne), un relevé
// bancaire est atomique : une ligne mal formée rejette tout l'import (400), la
// PWA corrige et re-pousse — l'empreinte @unique rend le re-push idempotent.
export const importBankTransactionRowSchema = z.object({
  // Date de valeur (ISO). z.coerce.date() accepte "2026-08-20" comme
  // "2026-08-20T00:00:00.000Z" ; l'heure est ignorée par l'empreinte.
  valueDate: z.coerce.date(),
  // Centimes GNF, strictement positif : virements ENTRANTS uniquement.
  amountCentimes: z.coerce.bigint().positive(),
  rawLabel: z.string().min(1).max(2_000),
  counterpartyLabel: z.string().min(1).max(500).optional(),
  bankRef: z.string().min(1).max(200).optional(),
});

export type ImportBankTransactionRowDto = z.infer<typeof importBankTransactionRowSchema>;

export const importBankTransactionsSchema = z.object({
  importBatchLabel: z.string().min(1).max(200).optional(),
  transactions: z.array(importBankTransactionRowSchema).min(1).max(MAX_IMPORT_BATCH_SIZE),
});

export type ImportBankTransactionsDto = z.infer<typeof importBankTransactionsSchema>;
