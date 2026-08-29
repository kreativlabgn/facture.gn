import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import canonicalize from "canonicalize";

// Lot B, ADR-110 — sceau d'arrêté des comptes. Même primitive que
// certification.service.ts (SHA-256 sur JSON canonique RFC 8785). Les montants
// sont canonicalisés en STRING (pas Number()) : un total annuel peut dépasser
// Number.MAX_SAFE_INTEGER pour une très grande organisation, et le sceau ne
// doit jamais perdre de précision.
export interface FiscalSealInput {
  organizationId: string;
  year: number;
  lastInvoiceNumber: string | null;
  lastInvoiceHash: string | null;
  totalHt: bigint;
  totalTva: bigint;
  totalTtc: bigint;
  invoiceCount: number;
}

export function computeSealHash(input: FiscalSealInput): string {
  const canonical = canonicalize({
    organizationId: input.organizationId,
    year: input.year,
    lastInvoiceNumber: input.lastInvoiceNumber,
    lastInvoiceHash: input.lastInvoiceHash,
    totalHt: input.totalHt.toString(),
    totalTva: input.totalTva.toString(),
    totalTtc: input.totalTtc.toString(),
    invoiceCount: input.invoiceCount,
  });

  if (!canonical) {
    throw new Error("Échec de canonicalisation du sceau d'arrêté des comptes");
  }

  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}
