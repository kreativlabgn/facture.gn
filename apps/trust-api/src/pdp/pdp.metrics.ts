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

/** Documents e-invoicing menés jusqu'à la facture certifiée par le worker.
 *
 *  Le pendant de PDP_DOCUMENTS_INGESTED_METRIC en SORTIE : l'écart entre les
 *  deux, à flux `e_invoicing` constant, est le nombre de documents encore en
 *  vol — file en retard, worker arrêté, ou lignes bloquées en `pending`. */
export const PDP_CONSOLIDATED_METRIC = "trust_api_pdp_consolidated_total";

/** Consolidations abandonnées DÉFINITIVEMENT, par cause (`reason`).
 *
 *  Ne compte QUE les refus définitifs — jamais une panne passagère, que BullMQ
 *  rejoue et qui ne laisse aucune trace ici. Chaque incrément correspond donc à
 *  une ligne tampon passée en `failed`, c'est-à-dire à un document fiscal d'un
 *  client tiers qui ne sera JAMAIS certifié sans intervention. */
export const PDP_CONSOLIDATION_FAILURES_METRIC = "trust_api_pdp_consolidation_failed_total";

/** Z de caisse (factures de synthèse e-Reporting) certifiés et remis au circuit
 *  e-TVA.
 *
 *  Se lit AVEC le compteur de tickets ci-dessous, jamais seul : leur rapport est
 *  le nombre moyen de tickets par Z, et c'est lui qui dit si l'agrégation fait son
 *  travail. Un rapport qui s'effondre vers 1 signifie qu'on émet une facture
 *  certifiée — donc qu'on consomme un numéro Article 23 — par vente de caisse,
 *  c'est-à-dire exactement l'inondation du guichet DGI que ce cron existe pour
 *  éviter. */
export const PDP_REPORTING_BATCHES_METRIC = "trust_api_pdp_reporting_batches_total";

/** Micro-ventes de caisse effectivement basculées en `certified` et rattachées à
 *  un Z. Le pendant en SORTIE de PDP_DOCUMENTS_INGESTED_METRIC{flow="e_reporting"} :
 *  l'écart entre les deux est le nombre de tickets encore en attente de
 *  compilation — cron désarmé, worker arrêté, ou lot bloqué. */
export const PDP_REPORTING_TICKETS_METRIC = "trust_api_pdp_reporting_tickets_total";

/** 1 si le cron de regroupement est armé dans Redis, 0 sinon.
 *
 *  Une jauge et non un compteur, parce que la question est un ÉTAT, pas un
 *  cumul : « les Z de caisse sont-ils compilés en ce moment ? ». À 0, les tickets
 *  s'accumulent en silence dans la table tampon — aucune erreur nulle part, et le
 *  manquement déclaratif ne se découvre qu'au contrôle. Même patron que
 *  MERKLE_SCHEDULERS_ARMED_METRIC (E1). */
export const PDP_REPORTING_SCHEDULER_ARMED_METRIC = "trust_api_pdp_reporting_scheduler_armed";
