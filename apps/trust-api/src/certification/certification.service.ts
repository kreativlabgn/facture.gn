import canonicalize from "canonicalize";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// Profil de canonicalisation FGN-Canon-v1 (DAT §5.1) :
// RFC 8785 JCS + clés ASCII uniquement + montants/taux exclusivement entiers.
export interface CertifiablePayload {
  invoiceId: string;
  organizationNif: string;
  number: string;
  totalTtc: bigint;
  issuedAt: string;
  previousHash: string;
}

export interface CertificationResult {
  hash: string;
  previousHash: string;
  certificationId: string;
  signature: string;
}

export interface CertificationService {
  certify(payload: CertifiablePayload): CertificationResult;
  verify(result: CertificationResult): boolean;
}

function canonicalizePayload(payload: CertifiablePayload): string {
  if (!Number.isSafeInteger(Number(payload.totalTtc))) {
    throw new RangeError(
      "totalTtc dépasse Number.MAX_SAFE_INTEGER — FGN-Canon-v1 exige un entier JSON exact",
    );
  }

  const canonical = canonicalize({
    invoiceId: payload.invoiceId,
    organizationNif: payload.organizationNif,
    number: payload.number,
    totalTtc: Number(payload.totalTtc),
    issuedAt: payload.issuedAt,
    previousHash: payload.previousHash,
  });

  if (!canonical) {
    throw new Error("Échec de canonicalisation FGN-Canon-v1");
  }

  return canonical;
}

function computeHash(payload: CertifiablePayload): string {
  const canonical = canonicalizePayload(payload);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

function buildCertificationId(payload: CertifiablePayload, hash: string): string {
  const nif8 = payload.organizationNif.slice(0, 8).toUpperCase();
  const year = payload.issuedAt.slice(0, 4);
  const hash6 = hash.slice(0, 6).toUpperCase();
  return `GN-${nif8}-${year}-${hash6}`;
}

// TODO(Cert-Engine Rust) : stub de bootstrap en Node — cible 12k signatures/s
// en isolation Rust (DAT §1). Interface stable pour permettre la migration
// sans changer les appelants (organizations/invoices services).
export class StubEd25519CertificationService implements CertificationService {
  private readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;

  constructor(privateKey?: Uint8Array) {
    this.privateKey = privateKey ?? ed25519.utils.randomPrivateKey();
    this.publicKey = ed25519.getPublicKey(this.privateKey);
  }

  certify(payload: CertifiablePayload): CertificationResult {
    const hash = computeHash(payload);
    const signature = bytesToHex(ed25519.sign(hexToBytes(hash), this.privateKey));

    return {
      hash,
      previousHash: payload.previousHash,
      certificationId: buildCertificationId(payload, hash),
      signature,
    };
  }

  verify(result: CertificationResult): boolean {
    return ed25519.verify(hexToBytes(result.signature), hexToBytes(result.hash), this.publicKey);
  }
}
