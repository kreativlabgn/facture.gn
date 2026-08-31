import { describe, expect, it } from "vitest";

import { hashMsisdn, normalizeMsisdn } from "./subject-data";

describe("normalizeMsisdn", () => {
  it("ramène toutes les écritures usuelles d'un numéro guinéen à la forme canonique +224XXXXXXXX", () => {
    for (const raw of [
      "+224620001122",
      "+224 620 00 11 22",
      "224620001122",
      "00224620001122",
      "0620001122",
      "620001122",
      "(+224)620-00-11-22",
    ]) {
      expect(normalizeMsisdn(raw)).toBe("+224620001122");
    }
  });

  it("accepte un numéro à 9 chiffres après l'indicatif (mobiles récents)", () => {
    expect(normalizeMsisdn("+224612345678")).toBe("+224612345678");
    expect(normalizeMsisdn("0 612 345 678")).toBe("+224612345678");
  });

  it("rejette un numéro non guinéen ou incomplet", () => {
    for (const bad of ["+33612345678", "123", "", "  ", "+224abc00000", "+2241234"]) {
      expect(() => normalizeMsisdn(bad)).toThrow(/numéro/i);
    }
  });
});

describe("hashMsisdn (HMAC keyed)", () => {
  const PEPPER = "a".repeat(64);

  it("produit un HMAC-SHA256 hex (64 caractères) déterministe pour un pepper donné", () => {
    const h1 = hashMsisdn("+224620001122", PEPPER);
    const h2 = hashMsisdn("224 620 00 11 22", PEPPER); // normalisé vers la même forme
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ne contient jamais les chiffres du numéro en clair et diffère d'un numéro à l'autre", () => {
    const h = hashMsisdn("+224620001122", PEPPER);
    expect(h).not.toContain("620001122");
    expect(h).not.toBe(hashMsisdn("+224620001123", PEPPER));
  });

  it("dépend du pepper : le même numéro donne un hash différent sous un autre pepper", () => {
    expect(hashMsisdn("+224620001122", PEPPER)).not.toBe(hashMsisdn("+224620001122", "b".repeat(64)));
  });

  it("lève si le pepper est absent (jamais de hash faible silencieux)", () => {
    expect(() => hashMsisdn("+224620001122", "")).toThrow(/pepper/i);
  });
});
