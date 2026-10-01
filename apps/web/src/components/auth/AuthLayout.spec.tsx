import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AUTH_CONTEXTES, profilDepuisReturnTo } from "@/lib/auth-contexte";
import { AuthLayout } from "./AuthLayout";

function rendre(role: "marchand" | "cabinet" | "acheteur") {
  return renderToStaticMarkup(
    <AuthLayout role={role}>
      <h1>Formulaire</h1>
    </AuthLayout>,
  );
}

describe("AuthLayout", () => {
  it("place le formulaire AVANT la zone d'information dans le DOM (mobile et lecteur d'écran)", () => {
    const html = rendre("acheteur");
    expect(html.indexOf("<main")).toBeLessThan(html.indexOf("<aside"));
    expect(html.indexOf("Formulaire")).toBeLessThan(html.indexOf("Identifiez-vous"));
  });

  it("acheteur : trois étapes numérotées, la tuile données et le lien vers l'aide", () => {
    const html = rendre("acheteur");
    expect(html).toContain("Étape 1 : ");
    expect(html).toContain("Étape 3 : ");
    expect(html).toContain("Recevez un code SMS");
    expect(html).toContain("Vos données restent à vous");
    expect(html).toContain('href="/portail/aide"');
    expect(html).not.toContain("Export comptable");
  });

  it("marchand : avantages sans promesse d'automatisation", () => {
    const html = rendre("marchand");
    expect(html).toContain("Facture certifiée en trois étapes");
    expect(html).toContain("Relance en un geste");
    expect(html).not.toMatch(/automatique/i);
    expect(html).not.toContain("Étape 1");
  });

  it("cabinet : mandats et export FEC", () => {
    const html = rendre("cabinet");
    expect(html).toContain("Mandats multi-entreprises");
    expect(html).toContain("Export comptable FEC");
    expect(html).toContain('href="/demo/cabinet"');
  });

  // Quelqu'un qui s'est trompé de porte ne tape jamais une URL à la main.
  it("offre « Changer de profil » et « Retour à l'accueil » à toutes les tailles", () => {
    const html = rendre("cabinet");
    expect(html.match(/Changer de profil/g)).toHaveLength(2);
    expect(html.match(/Retour à l&#x27;accueil/g)).toHaveLength(2);
    expect(html).toContain('href="/#espaces"');
  });

  // R-11 : de l'Or seulement avec du Navy dessus, jamais du blanc.
  it("ne pose jamais de texte clair sur l'Or", () => {
    const html = rendre("acheteur");
    // Le point de la marque et la barre d'accent des tuiles sont des aplats
    // sans texte ; seuls les éléments qui posent une couleur de texte comptent.
    for (const classe of html.match(/class="[^"]*bg-or[^"]*"/g) ?? []) {
      if (!classe.includes("text-")) continue;
      expect(classe).toContain("text-navy-950");
      expect(classe).not.toContain("text-white");
    }
  });

  it("pose un h2 pour le titre de zone et des h3 pour les tuiles — le h1 reste au formulaire", () => {
    const html = rendre("marchand");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html.match(/<h3/g)).toHaveLength(AUTH_CONTEXTES.marchand.tuiles.length);
  });
});

describe("profilDepuisReturnTo", () => {
  it("reconnaît le tunnel cabinet et retombe sur marchand partout ailleurs", () => {
    expect(profilDepuisReturnTo("/cabinet")).toBe("cabinet");
    expect(profilDepuisReturnTo("/nouveau-cabinet")).toBe("cabinet");
    expect(profilDepuisReturnTo("/cabinet?tab=structure")).toBe("cabinet");
    expect(profilDepuisReturnTo("/nouveau-cabinet?source=cta")).toBe("cabinet");
    expect(profilDepuisReturnTo("/cabinet/mandates")).toBe("cabinet");
    expect(profilDepuisReturnTo("/dashboard")).toBe("marchand");
    expect(profilDepuisReturnTo(undefined)).toBe("marchand");
  });
});
