import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

import { MATCH_DATE_WINDOW_DAYS } from "./bank-reconciliation.constants";

// Lot rapprochement bancaire (ADR-052, ADR-117 provisoire) — moteur PUR : aucune
// dépendance NestJS / Prisma, aucun accès I/O. Testé isolément (bank-matching.spec.ts).
// Réutilisé par BankReconciliationService pour l'empreinte (import) et la
// suggestion (lecture).

const SEP = "‖"; // ‖ — séparateur de champs de l'empreinte, absent des libellés
const MS_PER_DAY = 86_400_000;

/**
 * Forme canonique d'un libellé, utilisée À LA FOIS pour l'empreinte de
 * dédoublonnage ET pour la recherche d'une référence de facture : minuscules,
 * accents retirés, tout ce qui n'est ni alphanumérique compressé en un espace
 * unique, bornes rognées.
 */
export function normalizeLabel(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marques diacritiques combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface FingerprintInput {
  organizationId: string;
  valueDate: Date;
  amountCentimes: bigint;
  rawLabel: string;
}

/**
 * Empreinte de dédoublonnage d'une ligne de relevé :
 * SHA-256(organizationId ‖ date de valeur ISO ‖ montant ‖ libellé normalisé), hex.
 * L'HEURE de valueDate n'entre pas dans l'empreinte (date seule) — c'est la
 * granularité des relevés bancaires.
 */
export function fingerprint(input: FingerprintInput): string {
  const canonical = [
    input.organizationId,
    input.valueDate.toISOString().slice(0, 10),
    input.amountCentimes.toString(),
    normalizeLabel(input.rawLabel),
  ].join(SEP);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

export type MatchConfidence = "strong" | "probable" | "weak";

export interface MatchSuggestion {
  invoiceId: string;
  confidence: MatchConfidence;
  reasons: string[];
}

export interface MatchableTransaction {
  valueDate: Date;
  amountCentimes: bigint;
  rawLabel: string;
}

export interface MatchableInvoice {
  id: string;
  number: string | null;
  certificationId: string | null;
  amountDue: bigint;
  issuedAt: Date | null;
}

const CONFIDENCE_ORDER: Record<MatchConfidence, number> = { strong: 0, probable: 1, weak: 2 };

function wholeDaysBetween(from: Date, to: Date): number {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((toDay - fromDay) / MS_PER_DAY);
}

// La facture est-elle émise dans la fenêtre précédant la date de valeur du
// virement (0 ≤ délai ≤ MATCH_DATE_WINDOW_DAYS) ? Un virement daté AVANT
// l'émission (délai négatif) n'est jamais un signal.
function isIssuedWithinWindow(issuedAt: Date | null, valueDate: Date): boolean {
  if (issuedAt === null) return false;
  const days = wholeDaysBetween(issuedAt, valueDate);
  return days >= 0 && days <= MATCH_DATE_WINDOW_DAYS;
}

/**
 * Classe les factures candidates pour une transaction non rapprochée. Ne renvoie
 * JAMAIS une suggestion sans au moins une raison. Tri : confiance décroissante,
 * puis écart de solde croissant.
 *
 * - montant exact ET référence dans le libellé  → "strong"
 * - un seul des deux signaux forts              → "probable"
 * - seulement la fenêtre de date                → "weak"
 * - aucun signal                                → pas de suggestion
 */
export function suggestMatches(
  tx: MatchableTransaction,
  candidates: readonly MatchableInvoice[],
): MatchSuggestion[] {
  const normalizedLabel = normalizeLabel(tx.rawLabel);

  const suggestions: MatchSuggestion[] = [];
  for (const invoice of candidates) {
    const reasons: string[] = [];

    const amountExact = invoice.amountDue === tx.amountCentimes;
    if (amountExact) {
      reasons.push("montant exact");
    }

    let referenceHit = false;
    for (const ref of [invoice.number, invoice.certificationId]) {
      const normalizedRef = ref ? normalizeLabel(ref) : "";
      if (normalizedRef.length > 0 && normalizedLabel.includes(normalizedRef)) {
        reasons.push(`référence ${ref} dans le libellé`);
        referenceHit = true;
        break;
      }
    }

    if (isIssuedWithinWindow(invoice.issuedAt, tx.valueDate)) {
      reasons.push("émise dans la fenêtre");
    }

    if (reasons.length === 0) {
      continue;
    }

    const strongSignals = (amountExact ? 1 : 0) + (referenceHit ? 1 : 0);
    const confidence: MatchConfidence =
      strongSignals === 2 ? "strong" : strongSignals === 1 ? "probable" : "weak";

    suggestions.push({ invoiceId: invoice.id, confidence, reasons });
  }

  return suggestions.sort((a, b) => {
    const byConfidence = CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence];
    if (byConfidence !== 0) return byConfidence;
    const invoiceA = candidates.find((c) => c.id === a.invoiceId)!;
    const invoiceB = candidates.find((c) => c.id === b.invoiceId)!;
    const gapA = invoiceA.amountDue - tx.amountCentimes;
    const gapB = invoiceB.amountDue - tx.amountCentimes;
    const absA = gapA < 0n ? -gapA : gapA;
    const absB = gapB < 0n ? -gapB : gapB;
    return absA < absB ? -1 : absA > absB ? 1 : 0;
  });
}
