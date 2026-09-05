// Pastilles ".pill" de la maquette de référence (Écran 04, charte v1.3) :
// JetBrains Mono 700, glyphe plein/mi-plein avant le libellé, fond teinté
// 12% + texte assombri (voir globals.css — la teinte brute de la charte ne
// passe pas WCAG AA sur son propre fond à cette taille).
const STATUS_LABELS: Record<string, { label: string; glyph: string; tone: "green" | "amber" | "blue" | "navy" }> = {
  draft: { label: "Brouillon", glyph: "○", tone: "navy" },
  issued: { label: "En attente", glyph: "●", tone: "amber" },
  partially_paid: { label: "Partiel", glyph: "◐", tone: "blue" },
  paid: { label: "Payée", glyph: "●", tone: "green" },
  voided: { label: "Annulée", glyph: "○", tone: "navy" },
  converted: { label: "Convertie", glyph: "○", tone: "navy" },
  expired: { label: "Expirée", glyph: "○", tone: "navy" },
};

const DISPUTE_LABELS: Record<string, { label: string; glyph: string; tone: "green" | "amber" | "blue" | "navy" | "red" }> = {
  disputed: { label: "Contestée", glyph: "●", tone: "red" },
  resolved: { label: "Litige résolu", glyph: "●", tone: "green" },
};

const TONE_CLASSES: Record<string, string> = {
  green: "bg-green-bg text-green-text",
  amber: "bg-amber-bg text-amber-text",
  blue: "bg-blue-bg text-blue-text",
  red: "bg-red-bg text-red-text",
  navy: "bg-navy-50 text-navy-600",
};

const PILL_CLASSES = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold";

export function StatusPill({ status }: { status: string }) {
  const entry = STATUS_LABELS[status] ?? { label: status, glyph: "○", tone: "navy" as const };
  return (
    <span className={`${PILL_CLASSES} ${TONE_CLASSES[entry.tone]}`}>
      {entry.glyph} {entry.label}
    </span>
  );
}

// E4/E9, ADR-038 — badge "doublon possible" sur la liste clients : signal du
// possibleDuplicateOf posé à la création (jamais de fusion automatique),
// résolution manuelle depuis l'écran détail (merge(), E4). Même tons/classes
// que StatusPill/DisputeStatusPill pour rester visuellement cohérent — amber,
// jamais red (ce n'est pas une erreur, juste une piste à vérifier).
export function DuplicateWarningPill() {
  return <span className={`${PILL_CLASSES} ${TONE_CLASSES.amber}`}>● Doublon possible</span>;
}

// dispute_status "none" n'affiche jamais de pastille — un litige inexistant
// n'est pas une information, jamais un faux signal neutre à côté du statut.
export function DisputeStatusPill({ disputeStatus }: { disputeStatus: string }) {
  if (disputeStatus === "none") {
    return null;
  }
  const entry = DISPUTE_LABELS[disputeStatus] ?? { label: disputeStatus, glyph: "○", tone: "navy" as const };
  return (
    <span className={`${PILL_CLASSES} ${TONE_CLASSES[entry.tone]}`}>
      {entry.glyph} {entry.label}
    </span>
  );
}
