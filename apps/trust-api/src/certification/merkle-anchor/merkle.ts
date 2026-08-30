import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// Arbre de Merkle RFC 6962 (Certificate Transparency), pur — aucun I/O.
//
// Séparation de domaine OBLIGATOIRE : feuille = SHA-256(0x00 ‖ d), nœud interne
// = SHA-256(0x01 ‖ gauche ‖ droite). Sans elle, une feuille de 64 octets serait
// interprétable comme la concaténation de deux hashes de nœuds enfants
// (attaque second-preimage).
//
// Découpage : à chaque niveau, `k` = la plus grande puissance de 2 STRICTEMENT
// inférieure à `n` ; sous-arbre gauche = les `k` premières feuilles, droit = le
// reste. Un nombre impair de feuilles n'est jamais dupliqué (contrairement à
// Bitcoin) — le sous-arbre droit est simplement plus petit.
//
// L'ORDRE des feuilles est celui reçu — l'appelant DOIT trier de façon
// déterministe (le registre trie par `invoice.hash` ASC).

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

function assertHash(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`hash Merkle invalide (attendu 64 hex / 32 octets) : ${hex.slice(0, 16)}…`);
  }
  return hexToBytes(hex);
}

export interface InclusionStep {
  siblingHex: string;
  /** Côté du SIBLING : "left" → nodeHash(sibling, courant) ; "right" → nodeHash(courant, sibling). */
  side: "left" | "right";
}

export function leafHash(dataHex: string): string {
  return bytesToHex(sha256(concat(LEAF_PREFIX, assertHash(dataHex))));
}

export function nodeHash(leftHex: string, rightHex: string): string {
  return bytesToHex(sha256(concat(NODE_PREFIX, assertHash(leftHex), assertHash(rightHex))));
}

/** Racine de Merkle des feuilles brutes (`invoice.hash`), dans l'ordre reçu. */
export function buildMerkleRoot(invoiceHashesHex: string[]): string {
  if (invoiceHashesHex.length === 0) {
    throw new Error("buildMerkleRoot : liste de feuilles vide");
  }
  return mth(invoiceHashesHex.map(leafHash));
}

/** Chemin d'inclusion de `targetHex` (une feuille brute), du bas vers le haut. */
export function buildInclusionProof(invoiceHashesHex: string[], targetHex: string): InclusionStep[] {
  const index = invoiceHashesHex.indexOf(targetHex);
  if (index === -1) {
    throw new Error("buildInclusionProof : feuille cible absente de la tranche");
  }
  return proof(invoiceHashesHex.map(leafHash), index);
}

/** Vérifie qu'une feuille brute est incluse sous `rootHex` via `proof`. */
export function verifyInclusionProof(targetHex: string, proof: InclusionStep[], rootHex: string): boolean {
  try {
    let current = leafHash(targetHex);
    for (const step of proof) {
      current = step.side === "left" ? nodeHash(step.siblingHex, current) : nodeHash(current, step.siblingHex);
    }
    return current === rootHex;
  } catch {
    return false;
  }
}

// ── interne ────────────────────────────────────────────────────────────────

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Plus grande puissance de 2 strictement < n (n ≥ 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle Tree Hash sur une liste de LEAF hashes déjà calculés. */
function mth(leafHashes: string[]): string {
  if (leafHashes.length === 1) return leafHashes[0];
  const k = splitPoint(leafHashes.length);
  return nodeHash(mth(leafHashes.slice(0, k)), mth(leafHashes.slice(k)));
}

function proof(leafHashes: string[], index: number): InclusionStep[] {
  if (leafHashes.length === 1) return [];
  const k = splitPoint(leafHashes.length);
  if (index < k) {
    // cible à gauche → sibling = racine du sous-arbre DROIT
    return [...proof(leafHashes.slice(0, k), index), { siblingHex: mth(leafHashes.slice(k)), side: "right" }];
  }
  // cible à droite → sibling = racine du sous-arbre GAUCHE
  return [...proof(leafHashes.slice(k), index - k), { siblingHex: mth(leafHashes.slice(0, k)), side: "left" }];
}
