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
  none: { label: "Saine", glyph: "●", tone: "green" },
  disputed: { label: "Contestée", glyph: "●", tone: "amber" },
  resolved: { label: "Résolue", glyph: "●", tone: "blue" },
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

// ADR-064 — un devis n'est jamais une facture certifiée : ce badge le
// rappelle partout où une facture et un devis peuvent apparaître côte à côte
// (liste, détail). `null` pour tout le reste (invoice, proforma) — jamais un
// signal neutre à côté d'un document qui n'en a pas besoin. Tone `blue`, déjà
// validé pour un statut "info/partiel" — aucun nouveau token couleur.
export function DocumentTypeBadge({ documentType }: { documentType: string }) {
  if (documentType !== "quote") {
    return null;
  }
  return <Badge tone="blue">Devis</Badge>;
}

// Chantier 4 (DAF/B2G) — "none" affiche désormais une pastille « Saine »
// plutôt que rien : sur l'écran DAF, une facture sans litige à côté d'une
// facture contestée doit se lire d'un coup d'œil, sans avoir à distinguer
// « rien affiché » de « pas encore chargé ».
export function DisputeStatusPill({ disputeStatus }: { disputeStatus: string }) {
  const entry = DISPUTE_LABELS[disputeStatus] ?? { label: disputeStatus, glyph: "○", tone: "navy" as const };
  return (
    <Badge tone={entry.tone}>
      {entry.glyph} {entry.label}
    </Badge>
  );
}
