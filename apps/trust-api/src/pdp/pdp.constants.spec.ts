import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPdpJobId, ETAX_INVOICING_UNITARY, PDP_QUEUE } from "./pdp.constants";

describe("buildPdpJobId (ADR-107)", () => {
  it("préfixe l'identifiant de la ligne tampon", () => {
    expect(buildPdpJobId("11111111-2222-3333-4444-555555555555")).toBe(
      "pdp-11111111-2222-3333-4444-555555555555",
    );
  });

  // BullMQ réserve « : » pour ses clés Redis et REJETTE tout jobId qui en
  // contient (« Custom Id cannot contain : »). Le bug a déjà été constaté en
  // réel côté eTax le 2026-09-08 : queue.add() levait, l'échec était absorbé par
  // un enfilement qui ne lève jamais, et plus rien ne s'enfilait — silencieusement.
  it("ne produit jamais de deux-points, quel que soit l'uuid", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(buildPdpJobId(randomUUID())).not.toContain(":");
    }
  });

  it("neutralise tout caractère interdit qu'un appelant futur passerait", () => {
    expect(buildPdpJobId("account.move:4211")).toBe("pdp-account-move-4211");
  });

  // Le garde-fou qui explique POURQUOI la source est l'uuid de la ligne et non
  // le clientUniqueId : nettoyer un identifiant ERP ferait converger deux
  // documents DIFFÉRENTS vers le même jobId, et BullMQ dédoublonnerait
  // silencieusement le second — qui ne serait alors jamais certifié.
  it("le nettoyage seul ne suffirait pas à distinguer deux identifiants ERP proches", () => {
    expect(buildPdpJobId("INV:001")).toBe(buildPdpJobId("INV-001"));
  });

  it("deux lignes tampon distinctes ont toujours des jobId distincts", () => {
    expect(buildPdpJobId(randomUUID())).not.toBe(buildPdpJobId(randomUUID()));
  });
});

// Renommer l'un ou l'autre orphelinerait les jobs déjà en attente dans Redis au
// moment du déploiement : ces valeurs sont un contrat d'exploitation, pas un
// détail interne.
describe("noms stables (ADR-107)", () => {
  it("la file et le job gardent leur nom", () => {
    expect(PDP_QUEUE).toBe("pdp-ingestion");
    expect(ETAX_INVOICING_UNITARY).toBe("etax-invoicing-unitary");
  });

  it("le nom du job est utilisable tel quel comme segment de clé Redis", () => {
    expect(ETAX_INVOICING_UNITARY).not.toContain(":");
  });
});
