// Rappel de positionnement, systématique sur cette page (jamais optionnel) :
// facture.gn n'est jamais présenté comme une autorité d'État — un vérificateur
// externe (banque, agent DGI) doit repartir avec cette distinction claire,
// pas seulement les équipes internes qui la connaissent déjà.
export function TrustExplainer() {
  return (
    <div className="rounded-2xl bg-ink-100 p-6 text-sm text-ink-700">
      <p className="font-medium text-ink-950">Qu&apos;est-ce que ceci vérifie ?</p>
      <p className="mt-2">
        facture.gn certifie chaque facture au moment de son émission avec une signature
        cryptographique propre à l&apos;organisation qui l&apos;a émise. Cette page confirme que le
        contenu affiché ci-dessus n&apos;a subi aucune modification depuis cette certification.
      </p>
      <p className="mt-2">
        facture.gn est un tiers de confiance privé, indépendant — jamais un registre ou une
        autorité de l&apos;État guinéen.
      </p>
    </div>
  );
}
