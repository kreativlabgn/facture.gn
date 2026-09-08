// Chantier 5, étape 3 — métriques de la télétransmission eTax. Préfixe
// trust_api_ comme RETENTION_*_METRIC : évite une collision dans le registre
// prom-client global si trust-api et money-api cohabitent dans un process.

/** Déclarations acquittées par eTax. */
export const ETAX_SUBMITTED_METRIC = "trust_api_etax_declarations_submitted_total";

/** Échecs de transmission, par cause (`reason`). Ce compteur est l'alerte : une
 *  déclaration fiscale non transmise est un risque réglementaire, jamais une
 *  simple erreur technique à ignorer. */
export const ETAX_FAILURES_METRIC = "trust_api_etax_declarations_failed_total";

/** Clôtures qui n'ont JAMAIS pu être enfilées (Redis indisponible au moment du
 *  close()). Distinct des échecs de transmission : ici le job n'existe même pas,
 *  donc aucun réessai BullMQ ne viendra — seul un rattrapage sur
 *  etax_submitted_at IS NULL les récupérera. */
export const ETAX_ENQUEUE_FAILURES_METRIC = "trust_api_etax_enqueue_failed_total";

/** Factures transmises unitairement et acquittées par le guichet (LFI 2025).
 *  Compteur SÉPARÉ des déclarations périodiques : ce sont deux obligations
 *  distinctes, et les confondre rendrait toute alerte illisible — quelques
 *  dizaines de déclarations par an contre des milliers de factures par jour. */
export const ETAX_INVOICES_TRANSMITTED_METRIC = "trust_api_etax_invoices_transmitted_total";

/** Factures dont la transmission a définitivement échoué, par cause. */
export const ETAX_INVOICE_FAILURES_METRIC = "trust_api_etax_invoices_failed_total";
