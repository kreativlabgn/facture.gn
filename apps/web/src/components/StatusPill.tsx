import { Badge, type BadgeTone } from "@/components/ui";

// Table de correspondance statut → pastille. Le rendu lui-même (fond teinté,
// JetBrains Mono 700, contrastes) appartient désormais à la primitive Badge —
// ce fichier ne décide plus que du SENS : quel statut porte quel ton et quel
// glyphe.
const STATUS_LABELS: Record<string, { label: string; glyph: string; tone: BadgeTone }> = {
  draft: { label: "Brouillon", glyph: "○", tone: "navy" },
  issued: { label: "En attente", glyph: "●", tone: "amber" },
  partially_paid: { label: "Partiel", glyph: "◐", tone: "blue" },
  paid: { label: "Payée", glyph: "●", tone: "green" },
  voided: { label: "Annulée", glyph: "○", tone: "navy" },
  converted: { label: "Convertie", glyph: "○", tone: "navy" },
  expired: { label: "Expirée", glyph: "○", tone: "navy" },
};

const DISPUTE_LABELS: Record<string, { label: string; glyph: string; tone: BadgeTone }> = {
  disputed: { label: "Contestée", glyph: "●", tone: "red" },
  resolved: { label: "Litige résolu", glyph: "●", tone: "green" },
};

export function StatusPill({ status }: { status: string }) {
  const entry = STATUS_LABELS[status] ?? { label: status, glyph: "○", tone: "navy" as const };
  return (
    <Badge tone={entry.tone}>
      {entry.glyph} {entry.label}
    </Badge>
  );
}

// E4/E9, ADR-038 — badge "doublon possible" sur la liste clients : signal du
// possibleDuplicateOf posé à la création (jamais de fusion automatique),
// résolution manuelle depuis l'écran détail (merge(), E4). Amber, jamais red
// (ce n'est pas une erreur, juste une piste à vérifier).
export function DuplicateWarningPill() {
  return <Badge tone="amber">● Doublon possible</Badge>;
}

// dispute_status "none" n'affiche jamais de pastille — un litige inexistant
// n'est pas une information, jamais un faux signal neutre à côté du statut.
export function DisputeStatusPill({ disputeStatus }: { disputeStatus: string }) {
  if (disputeStatus === "none") {
    return null;
  }
  const entry = DISPUTE_LABELS[disputeStatus] ?? { label: disputeStatus, glyph: "○", tone: "navy" as const };
  return (
    <Badge tone={entry.tone}>
      {entry.glyph} {entry.label}
    </Badge>
  );
}
