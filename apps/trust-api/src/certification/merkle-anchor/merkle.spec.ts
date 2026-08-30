import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildInclusionProof, buildMerkleRoot, leafHash, verifyInclusionProof } from "./merkle";

// Oracle indépendant (node:crypto brut) de l'arbre RFC 6962 — séparation de
// domaine 0x00 (feuille) / 0x01 (nœud interne), découpage à la plus grande
// puissance de 2 < n.
const oLeaf = (hex: string) =>
  createHash("sha256").update(Buffer.concat([Buffer.from([0x00]), Buffer.from(hex, "hex")])).digest("hex");
const oNode = (a: string, b: string) =>
  createHash("sha256")
    .update(Buffer.concat([Buffer.from([0x01]), Buffer.from(a, "hex"), Buffer.from(b, "hex")]))
    .digest("hex");
function oracleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 1) return leafHashes[0];
  let k = 1;
  while (k * 2 < leafHashes.length) k *= 2;
  return oNode(oracleRoot(leafHashes.slice(0, k)), oracleRoot(leafHashes.slice(k)));
}

const H = (n: number) => n.toString(16).padStart(2, "0").repeat(32); // 32-octet hex distinct

describe("merkle (RFC 6962)", () => {
  it("leafHash = SHA-256(0x00 ‖ hash brut)", () => {
    expect(leafHash(H(0))).toBe(oLeaf(H(0)));
  });

  it("racine d'une seule feuille = son leafHash", () => {
    expect(buildMerkleRoot([H(7)])).toBe(oLeaf(H(7)));
  });

  it.each([2, 3, 4, 5, 8, 13])("racine de %i feuilles = oracle RFC 6962", (n) => {
    const hashes = Array.from({ length: n }, (_, i) => H(i + 1));
    const expected = oracleRoot(hashes.map(oLeaf));
    expect(buildMerkleRoot(hashes)).toBe(expected);
  });

  it("est déterministe (même entrée → même racine) et sensible à l'ordre", () => {
    const a = [H(1), H(2), H(3)];
    expect(buildMerkleRoot(a)).toBe(buildMerkleRoot([...a]));
    expect(buildMerkleRoot([H(1), H(2), H(3)])).not.toBe(buildMerkleRoot([H(2), H(1), H(3)]));
  });

  it.each([1, 2, 3, 4, 7, 8, 16])(
    "preuve d'inclusion : round-trip pour chaque feuille d'un arbre de %i",
    (n) => {
      const hashes = Array.from({ length: n }, (_, i) => H(i + 1));
      const root = buildMerkleRoot(hashes);
      for (const target of hashes) {
        const proof = buildInclusionProof(hashes, target);
        expect(verifyInclusionProof(target, proof, root)).toBe(true);
      }
    },
  );

  it("preuve d'inclusion : faux si on altère la cible / un sibling / la racine", () => {
    const hashes = [H(1), H(2), H(3), H(4), H(5)];
    const root = buildMerkleRoot(hashes);
    const proof = buildInclusionProof(hashes, H(3));

    expect(verifyInclusionProof(H(3), proof, root)).toBe(true);
    expect(verifyInclusionProof(H(99), proof, root)).toBe(false); // cible altérée
    expect(verifyInclusionProof(H(3), proof, H(42))).toBe(false); // racine altérée
    const tampered = proof.map((s, i) => (i === 0 ? { ...s, siblingHex: H(42) } : s));
    expect(verifyInclusionProof(H(3), tampered, root)).toBe(false); // sibling altéré
  });

  it("rejette une liste vide et un hex invalide", () => {
    expect(() => buildMerkleRoot([])).toThrow();
    expect(() => buildMerkleRoot(["xyz"])).toThrow();
    expect(() => leafHash("00")).toThrow(); // pas 32 octets
    expect(() => buildInclusionProof([H(1), H(2)], H(9))).toThrow(); // cible absente
  });
});
