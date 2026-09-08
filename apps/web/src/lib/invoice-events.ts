// Traduction des InvoiceEventType (schema.prisma) en libellés lisibles pour le
// journal de l'écran détail de facture.
//
// Le journal est la trace WORM (ADR-015) : append-only, jamais modifiée ni
// supprimée. C'est elle qui rend une facture opposable, et cet écran est le
// seul endroit où une PME peut la lire — d'où des libellés écrits du point de
// vue du commerçant, jamais le nom technique de l'enum.
//
// Le `ton` sert le repère visuel de la frise, pas la décoration : il distingue
// ce qui appelle une action ou une vigilance (litige ouvert, motif d'espèces
// suspect) de ce qui est un simple constat.

export type EventTone = "neutre" | "bon" | "attention" | "alerte";

interface EventLabel {
  label: string;
  ton: EventTone;
}

const EVENT_LABELS: Record<string, EventLabel> = {
  // Litiges
  dispute_raised: { label: "Litige ouvert par le client", ton: "alerte" },
  dispute_resolved: { label: "Litige résolu", ton: "bon" },

  // Relance et lien de paiement
  payment_reminder_sent: { label: "Relance envoyée au client", ton: "neutre" },
  payment_link_generated: { label: "Lien de paiement créé", ton: "neutre" },
  payment_link_regenerated: { label: "Lien de paiement régénéré", ton: "neutre" },
  payment_link_expired: { label: "Lien de paiement expiré", ton: "attention" },

  // Cycle de vie du document
  invoice_voided: { label: "Facture annulée", ton: "attention" },
  invoice_converted: { label: "Document converti en facture", ton: "neutre" },
  stale_invoice_detected: { label: "Facture sans mouvement depuis longtemps", ton: "attention" },

  // Argent
  overpayment_recorded: { label: "Trop-perçu enregistré", ton: "attention" },
  refund_issued: { label: "Remboursement émis", ton: "neutre" },
  cancellation_indemnity: { label: "Indemnité d'annulation retenue", ton: "attention" },
  no_show_forfeited: { label: "Arrhes conservées — client non présenté", ton: "attention" },
  financing_disbursed: { label: "Avance de trésorerie versée", ton: "bon" },
  revenue_share_credited: { label: "Rétrocession créditée au cabinet", ton: "neutre" },

  // Contrôle et fraude
  suspicious_cash_pattern_detected: { label: "Motif d'encaissement en espèces signalé", ton: "alerte" },

  // Marchés publics (B2G)
  liquidation_validated: { label: "Liquidation validée par l'administration", ton: "bon" },
  validation_revoked: { label: "Validation de l'administration retirée", ton: "alerte" },

  // Mandats de cabinet
  mandate_requested: { label: "Mandat demandé par un cabinet", ton: "neutre" },
  mandate_granted: { label: "Mandat accordé au cabinet", ton: "neutre" },
  mandate_revoked: { label: "Mandat révoqué", ton: "attention" },
  mandate_expired: { label: "Mandat expiré", ton: "attention" },

  // Télétransmission e-TVA (LFI 2025). Le libellé dit ce que la DGI a fait, pas
  // ce que le système a tenté : « transmise » est un fait acquitté par un reçu.
  etax_transmitted: { label: "Facture transmise à la DGI (e-TVA)", ton: "bon" },
  // « attention » et non « alerte » : la facture reste ÉMISE et parfaitement
  // valide — un échec de télétransmission n'annule aucune certification. Le
  // signaler en rouge laisserait croire au commerçant que sa facture est nulle.
  etax_transmission_failed: {
    label: "Transmission à la DGI non aboutie",
    ton: "attention",
  },

  // Configuration
  regime_change: { label: "Changement de régime fiscal", ton: "neutre" },
  delegated_key_tier_changed: { label: "Palier de délégation de clé modifié", ton: "neutre" },
};

// Un type inconnu ne doit JAMAIS faire disparaître une ligne du journal : un
// événement ajouté côté trust-api avant d'être traduit ici reste affiché, sous
// son nom technique. Perdre une ligne d'une trace WORM à cause d'un libellé
// manquant serait bien pire que d'afficher un intitulé disgracieux.
export function invoiceEventLabel(type: string): EventLabel {
  return EVENT_LABELS[type] ?? { label: type.replace(/_/g, " "), ton: "neutre" };
}

export function knownInvoiceEventTypes(): string[] {
  return Object.keys(EVENT_LABELS);
}
