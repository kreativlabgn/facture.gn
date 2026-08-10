// Le pixel le plus important de toute la page — le signal de confiance doit
// être compris en un coup d'œil, sans lire une seule ligne de texte
// (scénario réel : quelqu'un scanne un QR code et regarde son téléphone 2
// secondes). Jamais de jargon technique ("intégrité cryptographique") dans le
// texte visible — "authentique" / "n'a pas pu être authentifiée" seulement.
export function TrustSeal({ valid }: { valid: boolean }) {
  if (valid) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-verified-100 px-8 py-10 text-center">
        <SealIcon className="h-16 w-16 text-verified-700" checkmark />
        <div>
          <p className="text-2xl font-semibold text-verified-700">Facture certifiée authentique</p>
          <p className="mt-1 text-sm text-ink-700">Aucune altération détectée depuis son émission.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-alert-100 px-8 py-10 text-center">
      <SealIcon className="h-16 w-16 text-alert-700" checkmark={false} />
      <div>
        <p className="text-2xl font-semibold text-alert-700">Cette facture n&apos;a pas pu être authentifiée</p>
        <p className="mt-1 text-sm text-ink-700">
          Les données enregistrées ne correspondent plus à la signature d&apos;origine.
        </p>
      </div>
    </div>
  );
}

function SealIcon({ className, checkmark }: { className?: string; checkmark: boolean }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
      {checkmark ? (
        <path
          d="M16 24.5l5.5 5.5L33 18"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M18 18l12 12M30 18l-12 12"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
