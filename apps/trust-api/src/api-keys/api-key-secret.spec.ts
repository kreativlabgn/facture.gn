import { describe, expect, it } from "vitest";
import { apiKeySuffixOf, generateApiKeySecret } from "./api-key-secret";

describe("generateApiKeySecret", () => {
  it("préfixe fg_live_ pour l'environnement production", () => {
    const { secret } = generateApiKeySecret("production");
    expect(secret.startsWith("fg_live_")).toBe(true);
  });

  it("préfixe fg_test_ pour l'environnement sandbox", () => {
    const { secret } = generateApiKeySecret("sandbox");
    expect(secret.startsWith("fg_test_")).toBe(true);
  });

  it("génère un secret différent à chaque appel (CSPRNG)", () => {
    const first = generateApiKeySecret("production");
    const second = generateApiKeySecret("production");
    expect(first.secret).not.toBe(second.secret);
  });

  it("expose keySuffix comme les 4 derniers caractères du secret", () => {
    const { secret, keySuffix } = generateApiKeySecret("production");
    expect(secret.endsWith(keySuffix)).toBe(true);
    expect(keySuffix).toHaveLength(4);
  });
});

// ADR-107 — la vérification (passerelle PDP) vit dans le MÊME fichier que la
// génération, précisément pour qu'elles ne puissent pas diverger. Ces tests
// épinglent cet aller-retour : ce que generateApiKeySecret produit,
// apiKeySuffixOf doit le reconnaître — y compris après un changement de
// longueur du secret, dont les deux dépendent désormais.
describe("apiKeySuffixOf (ADR-107)", () => {
  it.each(["production", "sandbox"] as const)("reconnaît un secret %s et rend son suffixe indexable", (env) => {
    const { secret, keySuffix } = generateApiKeySecret(env);
    expect(apiKeySuffixOf(secret)).toBe(keySuffix);
  });

  it("rend toujours exactement la colonne key_suffix stockée à la création", () => {
    for (let i = 0; i < 20; i += 1) {
      const { secret, keySuffix } = generateApiKeySecret("production");
      expect(apiKeySuffixOf(secret)).toBe(keySuffix);
    }
  });

  // Écarté AVANT toute lecture en base : une chaîne qui ne peut correspondre à
  // aucune clé ne doit pas coûter une requête sur un endpoint public.
  it.each([
    ["chaîne vide", ""],
    ["préfixe étranger", `sk_live_${"a".repeat(48)}`],
    ["environnement inconnu", `fg_prod_${"a".repeat(48)}`],
    ["trop court", "fg_live_deadbeef"],
    ["trop long", `fg_live_${"a".repeat(64)}`],
    ["caractères non hexadécimaux", `fg_live_${"z".repeat(48)}`],
    ["majuscules hexadécimales", `fg_live_${"A".repeat(48)}`],
    ["espace en fin", `fg_live_${"a".repeat(48)} `],
  ])("rejette %s", (_libelle, valeur) => {
    expect(apiKeySuffixOf(valeur)).toBeNull();
  });
});
