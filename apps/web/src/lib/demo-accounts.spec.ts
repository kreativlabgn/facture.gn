import { describe, expect, it } from "vitest";
import {
  CABINET_DEMO,
  FACTURES_MARCHAND_DEMO,
  MANDATS_CABINET_DEMO,
  MARCHAND_DEMO,
  PORTAIL_DEMO,
  checkoutDemo,
  paiementOuvert,
  portefeuilleDemo,
  resteDu,
  scenarioDemoPour,
  volumeCabinetDemo,
} from "./demo-accounts";
import { formatGnf } from "./format";
import { pourcentage } from "./plans";

// Ces tests sont le VERROU des chiffres montrés en démonstration. Un jeu de
// données de vitrine se périme en silence : personne ne relit un tableau qui
// s'affiche. Ici, chaque nombre annoncé au visiteur est recalculé depuis
// lib/plans.ts — le jour où un barème bouge, c'est ce fichier qui casse, pas la
// crédibilité d'une démonstration devant un client.

// `toLocaleString("fr-FR")` sépare les milliers par une ESPACE FINE INSÉCABLE
// (U+202F), pas par une espace ordinaire — comparer à une chaîne tapée au
// clavier échouerait sur un écart invisible à la relecture. On normalise donc
// la séparation avant de comparer : ce qu'on vérifie ici est le NOMBRE affiché,
// pas la finesse de l'espace typographique retenue par ICU.
function gnf(centimes: string): string {
  return formatGnf(centimes).replace(/[  ]/g, " ");
}

describe("compte marchand de démonstration", () => {
  it("porte exactement 14 factures", () => {
    expect(FACTURES_MARCHAND_DEMO).toHaveLength(14);
    expect(portefeuilleDemo().facturesTotal).toBe(14);
  });

  it("totalise exactement 45 000 000 GNF de volume émis", () => {
    expect(gnf(portefeuilleDemo().volumeCentimes)).toBe("45 000 000 GNF");
    expect(portefeuilleDemo().volumeCentimes).toBe("4500000000");
  });

  it("compte exactement 2 factures en litige, chacune avec un fil de discussion", () => {
    const enLitige = FACTURES_MARCHAND_DEMO.filter((facture) => facture.litige);
    expect(enLitige).toHaveLength(2);
    expect(portefeuilleDemo().litiges).toBe(2);
    for (const facture of enLitige) {
      expect(facture.fil.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("propose une issue amiable sur CHAQUE litige — jamais un fil sans sortie", () => {
    // Un écran de contestation qui n'offre rien à faire est un écran qui
    // inquiète sans aider. La règle vaut dans les deux sens : une résolution
    // posée sur une facture NON contestée serait tout aussi fausse.
    for (const facture of FACTURES_MARCHAND_DEMO) {
      expect(Boolean(facture.resolution), facture.numero).toBe(facture.litige);
    }
  });

  it("montre les DEUX issues : l'avoir, et le maintien de la facture", () => {
    // Le carnet doit enseigner qu'une contestation ne donne pas
    // automatiquement raison au client. S'il ne restait que des avoirs, la
    // démonstration vendrait une remise, pas un arbitrage.
    const voies = FACTURES_MARCHAND_DEMO.filter((f) => f.litige).map((f) => f.resolution?.voie);
    expect(voies).toContain("avoir");
    expect(voies).toContain("maintien");
  });

  it("émet un avoir de 575 000 GNF — un dixième des 5 750 000 GNF contestés", () => {
    // 4 sacs de ciment manquants sur les 40 facturés : le montant de l'avoir
    // est celui que le fil de discussion annonce au client. Un avoir qui ne
    // correspond pas à ce que le marchand a écrit est un écran qui ment sur
    // ce qu'on vient d'y lire.
    const contestee = FACTURES_MARCHAND_DEMO.find((f) => f.numero === "FG-2026-0012");
    expect(contestee?.resolution).toEqual({
      voie: "avoir",
      avoirCentimes: "57500000",
      motif: expect.stringContaining("4 sacs"),
    });
    expect(gnf(contestee!.resolution!.voie === "avoir" ? contestee!.resolution!.avoirCentimes : "0")).toBe(
      "575 000 GNF",
    );
  });

  it("déduit le reste dû, et ne touche jamais au montant de la facture", () => {
    // L'avoir est une pièce NOUVELLE : la facture certifiée garde son montant,
    // sinon le volume émis du portefeuille bougerait — et les 45 000 000 GNF
    // vérifiés plus haut ne tiendraient plus.
    const contestee = FACTURES_MARCHAND_DEMO.find((f) => f.numero === "FG-2026-0012")!;
    expect(contestee.montantCentimes).toBe("575000000");
    expect(gnf(resteDu(contestee))).toBe("5 175 000 GNF");

    const maintenue = FACTURES_MARCHAND_DEMO.find((f) => f.numero === "FG-2026-0007")!;
    expect(resteDu(maintenue)).toBe(maintenue.montantCentimes);
  });

  it("n'émet jamais un avoir supérieur à la facture qu'il corrige", () => {
    for (const facture of FACTURES_MARCHAND_DEMO) {
      if (facture.resolution?.voie !== "avoir") continue;
      expect(BigInt(facture.resolution.avoirCentimes)).toBeGreaterThan(BigInt(0));
      expect(BigInt(facture.resolution.avoirCentimes)).toBeLessThanOrEqual(
        BigInt(facture.montantCentimes),
      );
      expect(BigInt(resteDu(facture))).toBeGreaterThanOrEqual(BigInt(0));
    }
  });

  it("expose le taux de BARÈME freemium à 3,53 % — commission 2,10 % + passerelle en cascade", () => {
    expect(pourcentage(portefeuilleDemo().tauxBaremeBps)).toBe("3,53 %");
  });

  // Le plafond de commission (50 000 GNF par encaissement en freemium) rend le
  // taux dégressif : passé le plafond, chaque franc de plus ne porte que la
  // passerelle. Sur un portefeuille dont la facture moyenne dépasse le plafond,
  // le taux RÉELLEMENT supporté est donc SOUS le barème. Afficher 3,53 % ici
  // surfacturerait la démonstration — c'est exactement la faille que
  // lib/plans.ts documente (« un taux nominal recopié du barème mentirait »).
  it("calcule un taux effectif STRICTEMENT sous le barème, grâce au plafond", () => {
    const portefeuille = portefeuilleDemo();
    expect(portefeuille.tauxEffectifBps).toBeLessThan(portefeuille.tauxBaremeBps);
    expect(BigInt(portefeuille.economiePlafondCentimes)).toBeGreaterThan(BigInt(0));
  });

  it("ne dérive aucun taux d'un volume nul", () => {
    expect(portefeuilleDemo([]).tauxEffectifBps).toBe(0);
    expect(portefeuilleDemo([]).economiePlafondCentimes).toBe("0");
  });

  it("s'identifie par un numéro guinéen canonique", () => {
    // La forme locale « 622001122 » serait refusée par trust-api
    // (msisdnSchema) : afficher un identifiant que le serveur rejette est la
    // régression d'origine, sous une autre forme.
    expect(MARCHAND_DEMO.telephone).toBe("+224622001122");
  });
});

describe("compte cabinet de démonstration", () => {
  it("supervise exactement 5 PME sous mandat", () => {
    expect(MANDATS_CABINET_DEMO).toHaveLength(5);
  });

  it("reste en attente de vérification — le badge ne s'auto-décerne pas", () => {
    expect(CABINET_DEMO.statut).toBe("PENDING_VERIFICATION");
    expect(CABINET_DEMO.numeroOcaecg).toBe("CGA-2026-009");
  });

  it("se connecte par téléphone, jamais par son numéro d'Ordre", () => {
    // CGA-2026-009 est une immatriculation publique, pas un moyen d'accès. La
    // présenter comme tel — ce que faisait l'ancien « code d'accès CAB-99 » —
    // envoyait le visiteur la taper dans un champ qui ne l'attendait pas.
    expect(CABINET_DEMO.telephone).toMatch(/^\+224\d{8,9}$/);
    expect(CABINET_DEMO.numeroOcaecg).not.toMatch(/^\+224/);
  });

  it("agrège le volume supervisé sans jamais le recopier à la main", () => {
    const attendu = MANDATS_CABINET_DEMO.reduce((somme, mandat) => somme + BigInt(mandat.volumeCentimes), BigInt(0));
    expect(volumeCabinetDemo()).toBe(attendu.toString());
  });
});

describe("reconnaissance d'un identifiant de démonstration sur /login", () => {
  it("renvoie le tableau de bord marchand pour le numéro du scénario", () => {
    expect(scenarioDemoPour("622001122")?.href).toBe("/demo/marchand");
  });

  it("reconnaît le numéro quelle que soit la façon dont il est recopié", () => {
    // Quelqu'un qui relit un numéro sur une capture d'écran l'espace comme il
    // le prononce, et un autre le préfixe de l'indicatif. Les trois formes
    // désignent la même ligne : les rater renverrait ce visiteur vers le
    // message d'échec nu, qui est précisément le bug qu'on répare.
    for (const saisie of ["622001122", "622 00 11 22", "+224622001122", "00224622001122", " 622-00-11-22 "]) {
      expect(scenarioDemoPour(saisie)?.href, saisie).toBe("/demo/marchand");
    }
  });

  it("renvoie la console cabinet pour le numéro d'Ordre, quelle que soit la casse", () => {
    expect(scenarioDemoPour("CGA-2026-009")?.href).toBe("/demo/cabinet");
    expect(scenarioDemoPour("cga-2026-009")?.href).toBe("/demo/cabinet");
  });

  it("ne reconnaît RIEN d'autre — un vrai numéro doit rester un vrai numéro", () => {
    // Le test qui compte. Cette fonction n'est consultée que sur le chemin
    // d'échec, mais si elle devenait laxiste, elle enverrait un client dont la
    // connexion a simplement échoué vers une vitrine, au lieu de le laisser
    // réessayer.
    for (const saisie of ["", "   ", "622001123", "+224628441702", "CGA-2026-010", "123456", "admin"]) {
      expect(scenarioDemoPour(saisie), saisie).toBeNull();
    }
  });
});

describe("portail client de démonstration", () => {
  it("répond sur l'identifiant public annoncé, et sur lui seul", () => {
    expect(PORTAIL_DEMO.invoiceId).toBe("test-invoice-uuid");
    expect(checkoutDemo("test-invoice-uuid")).not.toBeNull();
    expect(checkoutDemo("une-autre-facture")).toBeNull();
  });

  it("facture 1 000 000 GNF de marchandise et 35 294 GNF de frais fusionnés", () => {
    const checkout = checkoutDemo(PORTAIL_DEMO.invoiceId);
    expect(checkout).not.toBeNull();
    expect(gnf(checkout!.marchandise)).toBe("1 000 000 GNF");
    expect(gnf(checkout!.fraisTransaction)).toBe("35 294 GNF");
    expect(gnf(checkout!.totalPayeur)).toBe("1 035 294 GNF");
    expect(pourcentage(checkout!.tauxEffectifBps)).toBe("3,53 %");
  });

  // Le bouton Mobile Money n'est pas décoratif : il déclenche un débit. Une
  // facture déjà réglée le rouvrirait sur un double paiement, une facture
  // contestée encaisserait une somme dont le montant est justement l'objet du
  // désaccord. Les deux se ferment côté DONNÉE, pas par un `disabled` d'écran.
  it("ferme le paiement sur une facture déjà encaissée ou contestée", () => {
    expect(paiementOuvert("a_payer")).toBe(true);
    expect(paiementOuvert("paid")).toBe(false);
    expect(paiementOuvert("litige")).toBe(false);
  });
});
