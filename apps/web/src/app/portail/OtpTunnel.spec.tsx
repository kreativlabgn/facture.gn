import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OtpTunnel } from "./OtpTunnel";

// `renderToStaticMarkup` est le seul harnais disponible pour les composants
// .tsx de ce dépôt (pas de jsdom/@testing-library, vitest.config.ts déclare
// `environment: "node"`) — il ne déclenche ni événement ni transition React.
// La couverture ici se limite donc au rendu INITIAL (aucun envoi encore
// effectué) : le scénario « code envoyé → clic sur Modifier → retour au
// formulaire numéro » dépend de useActionState/useEffect et n'est pas
// observable sans DOM interactif. Voir docs/plans/2026-09-16-unification-otp-
// portail-acheteur.md, « Vérification manuelle ».

describe("OtpTunnel — rendu initial", () => {
  it("affiche le formulaire numéro et jamais le bouton Modifier avant tout envoi", () => {
    const html = renderToStaticMarkup(<OtpTunnel />);

    expect(html).toContain("portail-msisdn");
    expect(html).toContain("Recevoir le code par SMS");
    // Le bouton de récupération n'a de sens qu'une fois un code envoyé — un
    // rendu initial (etatDemande === null) ne doit jamais le montrer.
    expect(html).not.toContain("Modifier");
    expect(html).not.toContain("portail-code");
  });

  it("titre et intro par défaut, remplacés quand fournis", () => {
    const defaut = renderToStaticMarkup(<OtpTunnel />);
    expect(defaut).toContain("Accéder à mes factures");
    expect(defaut).toContain("Nous vous envoyons un code par SMS pour confirmer que ce numéro est bien le vôtre.");

    const personnalise = renderToStaticMarkup(
      <OtpTunnel
        retour="/portail/facture-1"
        titre="Consulter cette facture"
        intro="Nous vous envoyons un code par SMS pour confirmer que cette facture vous est bien adressée."
      />,
    );
    expect(personnalise).toContain("Consulter cette facture");
    expect(personnalise).toContain("cette facture vous est bien adressée");
  });

  it("`encadre` gouverne la carte bordée — jamais de bordure imbriquée dans AuthLayout", () => {
    const encadre = renderToStaticMarkup(<OtpTunnel />);
    expect(encadre).toContain("rounded-2xl border border-navy-100 bg-white");

    const sansCadre = renderToStaticMarkup(<OtpTunnel encadre={false} />);
    expect(sansCadre).not.toContain("rounded-2xl border border-navy-100 bg-white");
  });
});

// Pas de test automatisé pour le non-préremplissage du numéro (décision RGPD
// documentée dans le plan, §3) : `OtpTunnel` n'expose que `retour`, `titre`,
// `intro`, `encadre` — aucun champ numéro. C'est une garantie de signature
// (TypeScript), pas un comportement observable au rendu ; un test qui
// réaffirmerait la même liste de clefs en dur n'aurait rien détecté qu'une
// revue de la signature ne détecte déjà.
