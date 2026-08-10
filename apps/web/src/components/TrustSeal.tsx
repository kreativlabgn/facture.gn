// Reproduit ".verify-check" de la maquette de référence (Écran 04, charte
// v1.3) : cercle plein 72px, icône blanche 32px, PAS de fond teinté ni de
// second texte de sous-titre — la maquette de référence ne montre que l'état
// succès ; l'état échec d'intégrité (rouge) est une extrapolation cohérente
// avec la palette sémantique de la charte (R-12/R-13), jamais montrée dans
// la maquette elle-même.
export function TrustSeal({ valid }: { valid: boolean }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`mb-[18px] flex h-[72px] w-[72px] items-center justify-center rounded-full ${
          valid ? "bg-green" : "bg-red"
        }`}
      >
        <SealIcon checkmark={valid} />
      </div>
      <p className="font-display text-[19px] font-bold text-navy-950">
        {valid ? "Facture authentique" : "Facture non authentifiée"}
      </p>
      {!valid ? (
        <p className="mt-1 max-w-sm text-sm text-navy-600">
          Les données enregistrées ne correspondent plus à la signature d&apos;origine.
        </p>
      ) : null}
    </div>
  );
}

function SealIcon({ checkmark }: { checkmark: boolean }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {checkmark ? (
        <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M7 7l10 10M17 7L7 17" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
