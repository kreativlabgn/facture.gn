import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

// J2, ADR-116 — helpers purs pour le sous-module data-rights.
//
// Le format canonique d'un numéro dans ce repo est `+224` suivi de 8 ou 9
// chiffres (msisdnSchema, ADR-087) : `Customer.phone` et `UserPhone.msisdn`
// sont TOUJOURS stockés sous cette forme (validés à l'écriture). La résolution
// d'une personne par téléphone doit donc ramener l'entrée à cette même forme
// avant toute comparaison.

const CANONICAL = /^\+224\d{8,9}$/;

/**
 * Ramène les écritures usuelles d'un numéro guinéen à la forme canonique
 * `+224XXXXXXXX(X)` (celle stockée en base). Lève si le résultat n'est pas un
 * numéro guinéen valide — jamais de comparaison sur une entrée douteuse.
 */
export function normalizeMsisdn(raw: string): string {
  const digitsOnly = raw.replace(/[^\d+]/g, "");
  let national = digitsOnly.replace(/^\+/, "");

  if (national.startsWith("00224")) national = national.slice(5);
  else if (national.startsWith("224")) national = national.slice(3);
  else if (national.startsWith("0")) national = national.slice(1);

  const candidate = `+224${national}`;
  if (!CANONICAL.test(candidate)) {
    throw new Error(`numéro de téléphone guinéen invalide : « ${raw} »`);
  }
  return candidate;
}

/** SHA-256 hex du numéro normalisé — jamais le numéro en clair dans le registre. */
export function hashMsisdn(rawOrCanonical: string): string {
  const canonical = normalizeMsisdn(rawOrCanonical);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

export interface SubjectInvoiceSummary {
  number: string | null;
  certificationId: string | null;
  documentType: string;
  status: string;
  disputeStatus: string;
  issuedAt: string | null;
  totalTtc: string;
}

export interface SubjectCustomerRecord {
  customerId: string;
  organizationId: string;
  name: string;
  phone: string | null;
  nif: string | null;
  notificationChannel: string;
  anonymizedAt: string | null;
  createdAt: string;
  invoices: SubjectInvoiceSummary[];
}

export interface SubjectAccountRecord {
  userId: string;
  name: string;
  preferredLanguage: string;
  phones: string[];
}

export interface SubjectDataExport {
  generatedAt: string;
  subjectPhoneHash: string;
  scope: "organization" | "platform";
  customers: SubjectCustomerRecord[];
  account: SubjectAccountRecord | null;
}
