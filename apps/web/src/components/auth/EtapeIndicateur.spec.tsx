import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EtapeIndicateur } from "./EtapeIndicateur";

describe("EtapeIndicateur", () => {
  it("annonce l'étape 1 sur 2 pour le compte, quel que soit le profil", () => {
    expect(renderToStaticMarkup(<EtapeIndicateur profil="marchand" etape="compte" />)).toContain(
      "Étape 1 sur 2",
    );
    expect(renderToStaticMarkup(<EtapeIndicateur profil="cabinet" etape="compte" />)).toContain(
      "Étape 1 sur 2",
    );
  });

  it("annonce l'étape 2 sur 2, avec le libellé propre au profil", () => {
    const marchand = renderToStaticMarkup(<EtapeIndicateur profil="marchand" etape="structure" />);
    expect(marchand).toContain("Étape 2 sur 2");
    expect(marchand).toContain("Votre organisation");

    const cabinet = renderToStaticMarkup(<EtapeIndicateur profil="cabinet" etape="structure" />);
    expect(cabinet).toContain("Étape 2 sur 2");
    expect(cabinet).toContain("Votre cabinet");
  });

  // R-11 : jamais de texte clair sur l'Or. Les segments n'ont pas de texte,
  // mais le garde-fou global (design-system.guardrails.spec.ts) couvre déjà
  // ce fichier — ce test-ci vérifie seulement qu'aucun segment ne porte le
  // libellé (donc pas de risque de contraste sur l'accent Or).
  it("le libellé n'est jamais posé sur le segment Or", () => {
    const html = renderToStaticMarkup(<EtapeIndicateur profil="marchand" etape="compte" />);
    const segmentOr = html.match(/<li class="[^"]*bg-or[^"]*"[^>]*>[^<]*<\/li>/);
    expect(segmentOr?.[0]).not.toMatch(/Étape/);
  });
});
