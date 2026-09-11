import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ESPACES } from "@/lib/espaces";
import { EspaceCard } from "./EspaceCard";
import { LoginMenu } from "./LoginMenu";

const parId = Object.fromEntries(ESPACES.map((e) => [e.id, e]));

function liens(html: string): string[] {
  return Array.from(html.matchAll(/href="([^"]+)"/g), (m) => m[1].replace(/&amp;/g, "&"));
}

describe("EspaceCard", () => {
  it("rend DEUX boutons pour un professionnel : connexion en secondaire, création en principal", () => {
    const html = renderToStaticMarkup(<EspaceCard espace={parId.marchand} />);

    expect(liens(html)).toEqual([parId.marchand.connexion.href, parId.marchand.creation!.href]);
    expect(html).toContain("Se connecter");
    expect(html).toContain("Créer mon compte");
    // L'espace mis en avant porte l'Or, avec du Navy dessus (R-11).
    expect(html).toContain("border-or");
    expect(html).toContain("bg-or text-navy-950");
  });

  it("rend le cabinet avec ses deux portes et le Navy en principal (un seul Or par rangée)", () => {
    const html = renderToStaticMarkup(<EspaceCard espace={parId.cabinet} />);

    expect(liens(html)).toEqual(["/login?returnTo=/cabinet", "/register?returnTo=/nouveau-cabinet"]);
    expect(html).toContain("Inscrire mon cabinet");
    expect(html).toContain("bg-navy-950");
    expect(html).not.toContain("bg-or");
  });

  it("rend UN seul bouton pour l'acheteur, sans « créer », avec la note SMS", () => {
    const html = renderToStaticMarkup(<EspaceCard espace={parId.acheteur} />);

    expect(liens(html)).toEqual(["/portail/auth"]);
    expect(html).not.toMatch(/Cr[ée]er/);
    expect(html).toContain("code reçu par SMS");
  });

  it("laisse l'écran choisir le niveau de titre", () => {
    expect(renderToStaticMarkup(<EspaceCard espace={parId.marchand} />)).toContain("<h3");
    expect(renderToStaticMarkup(<EspaceCard espace={parId.marchand} heading="h2" />)).toContain("<h2");
  });
});

describe("LoginMenu", () => {
  const html = renderToStaticMarkup(<LoginMenu />);

  it("est un bouton de menu fermé au rendu serveur, avec la sémantique menu button", () => {
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="menu"');
    expect(html).toMatch(/<div[^>]*role="menu"[^>]*hidden=""/);
  });

  it("propose une entrée par profil, vers la porte de connexion de chacun", () => {
    const entrees = html.match(/role="menuitem"/g) ?? [];
    expect(entrees).toHaveLength(ESPACES.length);
    for (const espace of ESPACES) {
      expect(liens(html)).toContain(espace.connexion.href);
    }
    expect(html).toContain("Connexion marchand");
    expect(html).toContain("Connexion cabinet");
    expect(html).toContain("Portail acheteur");
  });
});
