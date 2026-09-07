import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER,
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

  // Aucun prix ne doit apparaître : il n'en existe aucun dans le dépôt, et un
  // montant inventé sur un écran d'abonnement serait le pire endroit possible.
  it("n'affiche aucun montant", () => {
    const source = readFileSync(path.resolve(__dirname, "./plans.ts"), "utf8")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/GNF/);
    expect(source).not.toMatch(/\bprix\b|\bprice\b/i);
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
