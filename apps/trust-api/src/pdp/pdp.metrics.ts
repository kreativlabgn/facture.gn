// ADR-107 — métriques de la passerelle PDP. Préfixe trust_api_ comme
// ETAX_*_METRIC : évite une collision dans le registre prom-client global si
// trust-api et money-api cohabitent dans un process.

/** Documents acceptés, par flux (`flow`). Le compteur d'activité de la
 *  passerelle : c'est lui qui dit si un connecteur nouvellement branché émet
 *  réellement. */
export const PDP_DOCUMENTS_INGESTED_METRIC = "trust_api_pdp_documents_ingested_total";

/** Dépôts reconnus comme des rejeux, par flux et par chemin de détection
 *  (`detection` = "lecture" quand la ligne existait déjà, "collision" quand
 *  c'est la contrainte d'unicité qui a tranché).
 *
 *  N'EST PAS UNE MÉTRIQUE D'ERREUR : un rejeu est le comportement NORMAL d'un
 *  connecteur qui a perdu notre réponse. Elle est en revanche l'indicateur le
 *  plus direct de la santé du réseau entre l'ERP et nous, et la part
 *  "collision" mesure la concurrence réelle du connecteur — un lot Odoo qui
 *  pousse en parallèle la fait monter, une reprise séquentielle non. */
export const PDP_DUPLICATES_METRIC = "trust_api_pdp_duplicates_total";

/** Documents e-invoicing acceptés mais JAMAIS enfilés (Redis indisponible).
 *
 *  Alerte réelle : le document est en base, le connecteur a reçu son accusé,
 *  mais rien ne viendra le certifier tant qu'un rejeu du connecteur ou le
 *  rattrapage ne le reprend pas. C'est exactement le trou que la ligne restée
 *  en `pending` permet de retrouver. */
export const PDP_ENQUEUE_FAILURES_METRIC = "trust_api_pdp_enqueue_failed_total";
