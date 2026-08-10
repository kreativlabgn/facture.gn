const STATUS_LABELS: Record<string, { label: string; tone: "neutral" | "verified" | "seal" | "alert" }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  issued: { label: "Émise", tone: "neutral" },
  partially_paid: { label: "Partiellement payée", tone: "seal" },
  paid: { label: "Payée", tone: "verified" },
  voided: { label: "Annulée", tone: "alert" },
  converted: { label: "Convertie", tone: "neutral" },
  expired: { label: "Expirée", tone: "neutral" },
};

const DISPUTE_LABELS: Record<string, { label: string; tone: "neutral" | "verified" | "seal" | "alert" }> = {
  disputed: { label: "Contestée", tone: "alert" },
  resolved: { label: "Litige résolu", tone: "seal" },
};

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-ink-100 text-ink-700",
  verified: "bg-verified-100 text-verified-700",
  seal: "bg-seal-100 text-seal-600",
  alert: "bg-alert-100 text-alert-700",
};

export function StatusPill({ status }: { status: string }) {
  const entry = STATUS_LABELS[status] ?? { label: status, tone: "neutral" as const };
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${TONE_CLASSES[entry.tone]}`}>{entry.label}</span>;
}

// dispute_status "none" n'affiche jamais de pastille — un litige inexistant
// n'est pas une information, jamais un faux signal neutre à côté du statut.
export function DisputeStatusPill({ disputeStatus }: { disputeStatus: string }) {
  if (disputeStatus === "none") {
    return null;
  }
  const entry = DISPUTE_LABELS[disputeStatus] ?? { label: disputeStatus, tone: "neutral" as const };
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${TONE_CLASSES[entry.tone]}`}>{entry.label}</span>;
}
