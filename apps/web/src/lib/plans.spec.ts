import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER,
  COMMISSION_BPS,
  COMMISSION_CAP_CENTIMES,
  PRIX_MENSUEL_CENTIMES,
  pourcentage,
  totalPayeurBps,
  MAX_BRANCHES_BY_TIER,
  MAX_MEMBERS_BY_TIER,
  MIN_TIER_FOR_ROLE,
  TIER_ORDER,
  avantagesDuPalier,
  tierIndex,
  tierLabel,
} from "./plans";

// La grille backend est la seule autorité : elle est APPLIQUÉE (branches.service,
// customers.service, inviteMember). Ce fichier-ci n'est qu'un miroir d'affichage.
// S'il dérive, l'écran d'abonnement promet des limites que le serveur refuse —
// exactement le genre d'écart qu'un utilisateur découvre au pire moment.
const GRID = readFileSync(
  path.resolve(__dirname, "../../../trust-api/src/common/plan-features-grid.ts"),
  "utf8",
);

// La grille de commission est la seconde autorité, et la plus sensible : elle
// calcule le platformFeeAmount prélevé sur CHAQUE encaissement. Un écart entre
// ce qu'on affiche et ce qu'on prélève est une fausse annonce de prix.
const COMMISSION = readFileSync(
  path.resolve(__dirname, "../../../trust-api/src/common/commission-grid.ts"),
  "utf8",
);

// Extrait `{ freemium: 1, starter: 2, pro: null, … }` d'un Record du fichier
// source, sans l'exécuter (c'est du TypeScript, pas du JSON).
function recordDuGrid(nom: string): Record<string, number | null> {
  const bloc = GRID.match(new RegExp(`${nom}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  expect(bloc, `${nom} introuvable dans plan-features-grid.ts`).toBeTruthy();

  const entrees: Record<string, number | null> = {};
  for (const ligne of bloc![1].split("\n")) {
    const m = ligne.replace(/\/\/.*$/, "").match(/^\s*(\w+):\s*(null|\d+)\s*,/);
    if (m) entrees[m[1]] = m[2] === "null" ? null : Number(m[2]);
  }
  return entrees;
}

describe("miroir de la grille des paliers", () => {
  it("l'ordre des paliers est celui du backend", () => {
    const bloc = GRID.match(/TIER_ORDER[^=]*=\s*\[([^\]]*)\]/);
    expect(bloc, "TIER_ORDER introuvable").toBeTruthy();
    const duBackend = [...bloc![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(duBackend).toEqual([...TIER_ORDER]);
  });

  it("les plafonds de succursales correspondent", () => {
    expect(recordDuGrid("MAX_BRANCHES_BY_TIER")).toEqual(MAX_BRANCHES_BY_TIER);
  });

  it("les plafonds de membres correspondent", () => {
    expect(recordDuGrid("MAX_MEMBERS_BY_TIER")).toEqual(MAX_MEMBERS_BY_TIER);
  });

  it("les paliers minimaux par rôle correspondent", () => {
    const bloc = GRID.match(/MIN_TIER_FOR_ROLE[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(bloc, "MIN_TIER_FOR_ROLE introuvable").toBeTruthy();
    const duBackend: Record<string, string> = {};
    for (const ligne of bloc![1].split("\n")) {
      const m = ligne.replace(/\/\/.*$/, "").match(/^\s*(\w+):\s*"(\w+)"/);
      if (m) duBackend[m[1]] = m[2];
    }
    expect(duBackend).toEqual(MIN_TIER_FOR_ROLE);
  });

  it("le palier minimal de la gestion client avancée correspond", () => {
    const m = GRID.match(/ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER[^=]*=\s*"(\w+)"/);
    expect(m, "constante introuvable").toBeTruthy();
    expect(m![1]).toBe(ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER);
  });

  // LE TEST LE PLUS IMPORTANT DU FICHIER. Afficher 1,6 % pendant que le code
  // prélève 2,0 % serait une fausse annonce de prix — c'est exactement l'écart
  // qui existait dans la grille produit en circulation.
  it("les taux de commission sont EXACTEMENT ceux prélevés par le code", () => {
    const bloc = COMMISSION.match(/COMMISSION_BPS_BY_TIER[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(bloc, "COMMISSION_BPS_BY_TIER introuvable").toBeTruthy();

    const duBackend: Record<string, number> = {};
    for (const ligne of bloc![1].split("\n")) {
      const m = ligne.replace(/\/\/.*$/, "").match(/^\s*(\w+):\s*(\d+)\s*,/);
      if (m) duBackend[m[1]] = Number(m[2]);
    }
    expect(duBackend).toEqual(COMMISSION_BPS);
  });

  it("les plafonds de commission correspondent", () => {
    const bloc = COMMISSION.match(/COMMISSION_CAP_CENTIMES_BY_TIER[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(bloc, "COMMISSION_CAP_CENTIMES_BY_TIER introuvable").toBeTruthy();

    const duBackend: Record<string, string> = {};
    for (const ligne of bloc![1].split("\n")) {
      const m = ligne.replace(/\/\/.*$/, "").match(/^\s*(\w+):\s*([\d_]+)n\s*,/);
      if (m) duBackend[m[1]] = m[2].replace(/_/g, "");
    }
    expect(duBackend).toEqual(COMMISSION_CAP_CENTIMES);
  });

  // Un palier qui coûte plus cher doit prélever moins : c'est toute la logique
  // de la grille. Une inversion serait un bug, pas une offre.
  it("la commission décroît quand le prix augmente", () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const tier = TIER_ORDER[i];
      const precedent = TIER_ORDER[i - 1];
      expect(COMMISSION_BPS[tier]).toBeLessThan(COMMISSION_BPS[precedent]);
      expect(BigInt(PRIX_MENSUEL_CENTIMES[tier])).toBeGreaterThan(
        BigInt(PRIX_MENSUEL_CENTIMES[precedent]),
      );
    }
  });

  it("chaque palier a un prix et un plafond", () => {
    for (const tier of TIER_ORDER) {
      expect(PRIX_MENSUEL_CENTIMES[tier]).toBeDefined();
      expect(COMMISSION_CAP_CENTIMES[tier]).toBeDefined();
    }
  });
});

describe("avantagesDuPalier", () => {
  it("Freemium : une seule succursale, un seul membre, aucun rôle avancé", () => {
    const avantages = avantagesDuPalier("freemium");
    expect(avantages).toContain("1 succursale");
    expect(avantages).toContain("1 membre d'équipe");
    expect(avantages.join(" ")).not.toContain("approbateur");
  });

  it("Starter ouvre le gestionnaire de stock, pas l'approbateur", () => {
    const texte = avantagesDuPalier("starter").join(" ");
    expect(texte).toContain("gestionnaire de stock");
    expect(texte).not.toContain("approbateur");
  });

  it("Pro ouvre la gestion client avancée et les quatre rôles", () => {
    const texte = avantagesDuPalier("pro").join(" ");
    expect(texte).toContain("Gestion client avancée");
    for (const role of ["gestionnaire de stock", "approbateur", "auditeur", "développeur API"]) {
      expect(texte).toContain(role);
    }
  });

  it("Enterprise lève les plafonds", () => {
    const avantages = avantagesDuPalier("enterprise");
    expect(avantages).toContain("Succursales illimitées");
    expect(avantages).toContain("Membres d'équipe illimités");
  });

  // Chaque palier doit être au moins aussi généreux que le précédent : une
  // inversion serait un bug de grille, pas une décision commerciale.
  it("les avantages ne régressent jamais d'un palier au suivant", () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      expect(avantagesDuPalier(TIER_ORDER[i]).length).toBeGreaterThanOrEqual(
        avantagesDuPalier(TIER_ORDER[i - 1]).length,
      );
    }
  });
});

describe("Starter Plus (ADR-106)", () => {
  it("s'intercale entre Starter et Pro sur les trois axes", () => {
    expect(tierIndex("starter")).toBeLessThan(tierIndex("starter_plus"));
    expect(tierIndex("starter_plus")).toBeLessThan(tierIndex("pro"));
    expect(COMMISSION_BPS.starter_plus).toBe(175);
  });

  it("n'ouvre aucun rôle de plus que Starter", () => {
    const starter = avantagesDuPalier("starter").join(" ");
    const plus = avantagesDuPalier("starter_plus").join(" ");
    expect(plus).toContain("gestionnaire de stock");
    expect(plus).not.toContain("développeur API");
    // Seules les limites d'échelle changent.
    expect(plus).toContain("5 succursales");
    expect(starter).toContain("2 succursales");
  });
});

describe("affichage des taux", () => {
  it("formate à la française, virgule décimale", () => {
    expect(pourcentage(175)).toBe("1,75 %");
    expect(pourcentage(200)).toBe("2 %");
  });

  // Le payeur supporte la commission ET la passerelle Djomy (1,4 % réel,
  // ADR-072). Les totaux du code : freemium 3,5 / starter 3,4 / pro 2,9 /
  // enterprise 2,6 / custom 2,4.
  it("le total payeur ajoute la passerelle", () => {
    expect(totalPayeurBps("freemium")).toBe(350);
    expect(totalPayeurBps("starter")).toBe(340);
    expect(totalPayeurBps("pro")).toBe(290);
    expect(totalPayeurBps("custom")).toBe(240);
  });
});

describe("utilitaires", () => {
  it("ordonne les paliers", () => {
    expect(tierIndex("freemium")).toBeLessThan(tierIndex("pro"));
    expect(tierIndex("inconnu")).toBe(-1);
  });

  it("rend un palier inconnu tel quel", () => {
    expect(tierLabel("nouveau_palier")).toBe("nouveau_palier");
    expect(tierLabel("pro")).toBe("Pro");
  });
});
