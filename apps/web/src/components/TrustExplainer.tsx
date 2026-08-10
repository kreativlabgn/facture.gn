// Reproduit le disclaimer sous la carte de l'Écran 04 (charte v1.3) :
// paragraphe discret, jamais un encadré — le poids visuel reste sur le
// sceau et la carte, pas sur l'avertissement. Contenu étendu par rapport à
// la maquette (une seule phrase) car un vérificateur externe (banque, agent
// DGI) doit repartir avec la distinction "jamais un registre d'État" sans
// ambiguïté, pas seulement les équipes internes qui la connaissent déjà.
export function TrustExplainer() {
  return (
    <div className="mt-4 text-center text-[11px] leading-relaxed text-navy-600">
      <p>
        facture.gn certifie chaque facture au moment de son émission avec une signature
        cryptographique propre à l&apos;organisation qui l&apos;a émise. Cette page confirme que le
        contenu affiché ci-dessus n&apos;a subi aucune modification depuis cette certification.
      </p>
      <p className="mt-2">
        Vérification cryptographique indépendante — facture.gn ne délivre aucune validation
        officielle et n&apos;agit pas comme registre d&apos;État.
      </p>
    </div>
  );
}
