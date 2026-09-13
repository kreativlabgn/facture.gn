import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ETAPES_INSCRIPTION, etapeLabel } from "./etapes-inscription";

describe("etapes-inscription — table unique du tunnel à deux écrans", () => {
  it("expose exactement les deux profils professionnels (pas l'acheteur, qui n'a pas de second écran)", () => {
    expect(Object.keys(ETAPES_INSCRIPTION).sort()).toEqual(["cabinet", "marchand"]);
  });

  it("l'écran 1 porte le même libellé pour les deux profils — c'est le même formulaire de compte", () => {
    expect(ETAPES_INSCRIPTION.marchand.compte).toBe(ETAPES_INSCRIPTION.cabinet.compte);
  });

  it("l'écran 2 est propre à chaque profil", () => {
    expect(ETAPES_INSCRIPTION.marchand.structure).not.toBe(ETAPES_INSCRIPTION.cabinet.structure);
  });
});

describe("etapeLabel", () => {
  it("l'écran 1 est toujours numéroté 1 sur 2, quel que soit le profil", () => {
    expect(etapeLabel("marchand", "compte")).toEqual({ numero: 1, libelle: ETAPES_INSCRIPTION.marchand.compte });
    expect(etapeLabel("cabinet", "compte")).toEqual({ numero: 1, libelle: ETAPES_INSCRIPTION.cabinet.compte });
  });

  it("l'écran 2 est numéroté 2 sur 2, avec le libellé propre au profil", () => {
    expect(etapeLabel("marchand", "structure")).toEqual({
      numero: 2,
      libelle: ETAPES_INSCRIPTION.marchand.structure,
    });
    expect(etapeLabel("cabinet", "structure")).toEqual({
      numero: 2,
      libelle: ETAPES_INSCRIPTION.cabinet.structure,
    });
  });
});

// RÈGLE D'ÉCRITURE (identique à auth-contexte.ts, lignes 7-13) : l'aperçu
// affiché sur /register ne doit promettre que ce que l'écran 2 demande
// RÉELLEMENT. Lire le code des formulaires plutôt que de faire confiance au
// texte : un champ renommé côté formulaire doit faire échouer ce test, pas
// laisser une promesse fausse à l'écran.
describe("etapes-inscription — l'aperçu ne promet que ce que l'écran 2 demande réellement", () => {
  const onboardingForm = readFileSync(
    path.resolve(__dirname, "..", "app", "(auth)", "onboarding", "OnboardingForm.tsx"),
    "utf8",
  );
  const practiceForm = readFileSync(
    path.resolve(__dirname, "..", "app", "(auth)", "nouveau-cabinet", "PracticeForm.tsx"),
    "utf8",
  );

  it("marchand : la forme légale et le régime fiscal sont bien des champs du formulaire d'organisation", () => {
    expect(ETAPES_INSCRIPTION.marchand.apercu).toContain("forme légale");
    expect(ETAPES_INSCRIPTION.marchand.apercu).toContain("régime fiscal");
    expect(onboardingForm).toContain('name="legalForm"');
    expect(onboardingForm).toContain('name="regimeFiscal"');
  });

  it("cabinet : le nom et le type de structure sont bien des champs du formulaire de cabinet", () => {
    expect(ETAPES_INSCRIPTION.cabinet.apercu).toContain("nom");
    expect(ETAPES_INSCRIPTION.cabinet.apercu).toContain("type de structure");
    expect(practiceForm).toContain('name="name"');
    expect(practiceForm).toContain('name="type"');
  });
});
