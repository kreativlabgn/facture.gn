import type { RegimeFiscal } from "@facture-gn/db";
import { resolveTaxRateBps } from "../invoices/tax-regime";

// Chantier 5, étape 3 — construction du payload de déclaration. Fonctions PURES,
// hors Nest et hors BullMQ : c'est la partie qu'on veut pouvoir raisonner et
// tester sans Redis ni base.

// ── Codes de taxe légaux ────────────────────────────────────────────────────
// Le code accompagne la déclaration pour dire à eTax SOUS QUEL RÉGIME les
// montants sont déclarés. Dérivé de regimeFiscal, jamais saisi : c'est la même
// discipline que resolveTaxRateBps (C4, ADR-033 — « jamais un taux TVA plat »),
// et pour la même raison, un régime mal déclaré est une fausse déclaration.
//
// Les trois régimes à 0 bps ne sont PAS interchangeables du point de vue de la
// DGI — un forfaitaire TPU, un assujetti sans TVA et une association exonérée
// remplissent trois cases différentes. Les fondre en un seul code « 0 % »
// produirait des déclarations formellement fausses.
const TAX_CODE_BY_REGIME: Record<RegimeFiscal, string> = {
  normal_tva: "TVA-18",
  tpu: "TPU",
  normal_sans_tva: "HORS-TVA",
  non_assujetti_association: "EXO-ASSO",
};

export function resolveTaxCode(regimeFiscal: RegimeFiscal): string {
  return TAX_CODE_BY_REGIME[regimeFiscal];
}

// ── Payload du job ──────────────────────────────────────────────────────────
// BullMQ sérialise `data` en JSON pour l'écrire dans Redis. Les montants sont
// des BigInt (ADR-014, entiers GNF) et `JSON.stringify(1n)` LÈVE. main.ts pose
// bien un BigInt.prototype.toJSON global, mais s'y fier serait fragile : ce
// patch n'existe pas dans les tests, ni dans un worker qu'on sortirait un jour
// dans son propre process. La conversion est donc EXPLICITE ici, et le type le
// dit — `string`, pas `bigint`.
//
// NOMMAGE : les montants s'appellent totalHt/totalTva/totalTtc, PAS
// « totalHtBps ». Dans ce dépôt le suffixe Bps désigne uniquement un taux en
// points de base (taxRateBps = 1800 pour 18 %). L'appliquer à un montant en
// francs guinéens inviterait tôt ou tard quelqu'un à diviser par 100. Le taux,
// lui, est bien transmis — sous son vrai nom, à côté.
export interface EtaxDeclarationPayload {
  organizationId: string;
  fiscalPeriodId: string;
  year: number;
  etaxNumber: string;
  /** Montants en francs guinéens entiers, sérialisés en chaîne (jamais un Number :
   *  au-delà de 2^53 un total annuel perdrait de la précision silencieusement). */
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  /** Taux appliqué, en points de base (1800 = 18 %). */
  taxRateBps: number;
  /** Code de régime légal — voir TAX_CODE_BY_REGIME. */
  taxCode: string;
  /** Sceau OHADA de la clôture (computeSealHash). Sert de CLÉ D'IDEMPOTENCE
   *  auprès d'eTax : deux envois du même exercice portent le même sceau, ce qui
   *  permet au guichet de reconnaître un doublon. Déterministe et déjà calculé —
   *  aucune raison d'inventer un identifiant de plus. */
  sealHash: string;
}

export interface FiscalPeriodClosingLike {
  id: string;
  organizationId: string;
  year: number;
  totalHt: bigint;
  totalTva: bigint;
  totalTtc: bigint;
  sealHash: string;
}

/** Assemble le payload à partir de la clôture consolidée et de l'organisation.
 *  Lève si le numéro eTax manque : une déclaration sans identifiant fiscal n'a
 *  aucun destinataire chez la DGI — mieux vaut un échec net à la construction
 *  qu'un envoi qu'eTax rejettera sans qu'on sache pourquoi. */
export function buildEtaxDeclaration(
  closing: FiscalPeriodClosingLike,
  organization: { etaxNumber: string | null; regimeFiscal: RegimeFiscal },
): EtaxDeclarationPayload {
  if (!organization.etaxNumber) {
    throw new Error(
      `Organisation ${closing.organizationId} sans numéro eTax — déclaration de l'exercice ${closing.year} impossible`,
    );
  }

  return {
    organizationId: closing.organizationId,
    fiscalPeriodId: closing.id,
    year: closing.year,
    etaxNumber: organization.etaxNumber,
    totalHt: closing.totalHt.toString(),
    totalTva: closing.totalTva.toString(),
    totalTtc: closing.totalTtc.toString(),
    taxRateBps: resolveTaxRateBps(organization.regimeFiscal),
    taxCode: resolveTaxCode(organization.regimeFiscal),
    sealHash: closing.sealHash,
  };
}
