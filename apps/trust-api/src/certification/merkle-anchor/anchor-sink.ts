import { Injectable } from "@nestjs/common";

// Lot E1 — seam d'ancrage externe. Le registre Merkle produit des racines ;
// un `AnchorSink` les publie sur un support hors du contrôle de facture.gn
// (Bitcoin via RPC, IPFS+Cloudflare per DAT, MinIO WORM…). Ces sinks réels
// seront des providers alternatifs désignés par env, dans un module optionnel
// — construits à la phase d'exploitation. Par défaut : Noop.
export const ANCHOR_SINK = Symbol("ANCHOR_SINK");

export interface AnchorReceipt {
  /** Preuve opaque (base64) — .ots, CID+chemin, txid+bloc… selon le sink. */
  proof: string;
  /** Référence lisible : txid Bitcoin, CID IPFS, clé objet… */
  ref: string;
  /** Horodatage EXTERNE confirmé (bloc Bitcoin, timestamp IPFS…). */
  anchoredAt: Date;
}

export interface AnchorSink {
  readonly name: string;
  /**
   * Ancre `rootHex` (32 octets). Retourne un `AnchorReceipt` si l'ancrage est
   * confirmé, `null` si l'opération est en cours (le flush réessaiera).
   * DOIT être idempotent : rappeler avec la même racine ne double rien.
   */
  anchor(rootHex: string, batchId: string): Promise<AnchorReceipt | null>;
}

/** Défaut : n'ancre jamais rien, la tranche reste `pending` indéfiniment. */
@Injectable()
export class NoopAnchorSink implements AnchorSink {
  readonly name = "noop";

  anchor(_rootHex: string, _batchId: string): Promise<AnchorReceipt | null> {
    return Promise.resolve(null);
  }
}
