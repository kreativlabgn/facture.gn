import { describe, expect, it } from "vitest";
import { normaliserMsisdnGn } from "./phone-gn";

// La normalisation vit CÔTÉ CLIENT et nulle part ailleurs (voir
// resolve-customer-by-phone.dto.ts) : le serveur n'accepte que le format
// canonique. La couper en deux — un serveur tolérant ET un client
// normalisateur — laisserait entrer deux écritures du même numéro et ruinerait
// le dédoublonnage que ce parcours existe pour garantir.
describe("normaliserMsisdnGn — du numéro dicté au comptoir au format canonique", () => {
  it("préfixe un numéro guinéen à 9 chiffres", () => {
    expect(normaliserMsisdnGn("622000000")).toBe("+224622000000");
  });

  // Un commerçant dicte rarement un numéro d'un bloc : il le lit par paquets.
  it("ignore espaces, points et tirets de la saisie", () => {
    expect(normaliserMsisdnGn("622 00 00 00")).toBe("+224622000000");
    expect(normaliserMsisdnGn("622-00-00-00")).toBe("+224622000000");
    expect(normaliserMsisdnGn("  622.00.00.00 ")).toBe("+224622000000");
  });

  it("accepte le numéro déjà canonique sans le déformer", () => {
    expect(normaliserMsisdnGn("+224622000000")).toBe("+224622000000");
  });

  // Les trois écritures de l'indicatif que produisent les répertoires
  // téléphoniques et les copier-coller.
  it("accepte l'indicatif écrit 224, 00224 ou +224", () => {
    expect(normaliserMsisdnGn("224622000000")).toBe("+224622000000");
    expect(normaliserMsisdnGn("00224622000000")).toBe("+224622000000");
  });

  // LA collision qui décide de la règle : « 224000000 » fait 9 chiffres et
  // commence par 224. C'est la LONGUEUR qui tranche, jamais le préfixe — un
  // numéro local de 9 chiffres reste local, quels que soient ses trois
  // premiers.
  it("traite un 9-chiffres commençant par 224 comme un numéro local", () => {
    expect(normaliserMsisdnGn("224000000")).toBe("+224224000000");
  });

  // Le format canonique du dépôt (msisdnSchema) accepte 8 OU 9 chiffres. Être
  // plus strict ici refuserait un numéro que POST /customers accepte —
  // exactement l'incohérence que ce module doit empêcher.
  it("accepte un numéro national à 8 chiffres, comme msisdnSchema", () => {
    expect(normaliserMsisdnGn("62200000")).toBe("+22462200000");
  });

  it("rejette ce qui ne peut pas être un numéro guinéen", () => {
    expect(normaliserMsisdnGn("")).toBeNull();
    expect(normaliserMsisdnGn("62200")).toBeNull();
    expect(normaliserMsisdnGn("6220000000000")).toBeNull();
    expect(normaliserMsisdnGn("abcdefghi")).toBeNull();
    // Un indicatif étranger n'est pas un numéro guinéen : le rattacher au +224
    // fabriquerait un numéro qui appartient à quelqu'un d'autre.
    expect(normaliserMsisdnGn("+33612345678")).toBeNull();
  });

  // Un « + » au milieu, deux « + » : la saisie est du texte libre, elle sort
  // de doigts pressés sur un comptoir.
  it("rejette un plus mal placé plutôt que de le retirer en silence", () => {
    expect(normaliserMsisdnGn("622+000000")).toBeNull();
    expect(normaliserMsisdnGn("++224622000000")).toBeNull();
  });
});
