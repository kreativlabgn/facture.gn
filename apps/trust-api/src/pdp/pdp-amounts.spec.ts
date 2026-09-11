import { describe, expect, it } from "vitest";
import { toCentimes } from "./pdp-amounts";

describe("toCentimes (ADR-107) — chaîne numérique GNF → centimes BigInt", () => {
  it("convertit un entier sans décimale", () => {
    expect(toCentimes("150000")).toBe(BigInt(15_000_000));
  });

  it("convertit zéro", () => {
    expect(toCentimes("0")).toBe(BigInt(0));
  });

  it("convertit deux décimales", () => {
    expect(toCentimes("8413213.14")).toBe(BigInt(841_321_314));
  });

  // Le piège classique de ce type de conversion : « 1.5 » vaut 1,50 GNF, donc
  // 150 centimes. Une implémentation qui concatène sans compléter rendrait 15.
  it("complète une décimale unique à droite — « 1.5 » vaut 150 centimes, jamais 15", () => {
    expect(toCentimes("1.5")).toBe(BigInt(150));
  });

  it("traite « .00 » comme zéro décimale", () => {
    expect(toCentimes("42.00")).toBe(BigInt(4200));
  });

  // LE test qui justifie l'existence du format chaîne. « 8.29 » multiplié par
  // 100 en IEEE-754 donne 828.9999999999999, jamais 829 — et une implémentation
  // qui tronquerait ce résultat perdrait un centime entier sur une pièce
  // fiscale. La conversion textuelle, elle, est exacte par construction.
  it("reste exact là où un flottant dérive", () => {
    const montant = "8.29";

    expect(Number(montant) * 100).not.toBe(829);
    expect(Math.trunc(Number(montant) * 100)).toBe(828);
    expect(toCentimes(montant)).toBe(BigInt(829));
  });

  // Au-delà de Number.MAX_SAFE_INTEGER : toute implémentation passant par un
  // `number` perdrait des unités entières, sans lever.
  it("supporte un montant au-delà de Number.MAX_SAFE_INTEGER", () => {
    expect(toCentimes("999999999999999")).toBe(BigInt("99999999999999900"));
  });

  describe("rejette ce qui n'est pas un montant fiscal transmissible", () => {
    // 3 décimales : un centime GNF est la plus petite unité, rien en dessous
    // n'est représentable — l'accepter reviendrait à arrondir en silence.
    it.each([
      ["trois décimales", "10.123"],
      ["montant négatif", "-1"],
      ["notation exponentielle", "1e5"],
      ["séparateur de milliers", "1,000"],
      ["espace", "1 000"],
      ["chaîne vide", ""],
      ["texte", "gratuit"],
      ["point sans décimale", "10."],
      ["décimale sans partie entière", ".5"],
      ["plus de 15 chiffres avant la virgule", "1234567890123456"],
    ])("%s : « %s »", (_libelle, valeur) => {
      expect(() => toCentimes(valeur)).toThrow(RangeError);
    });
  });
});
