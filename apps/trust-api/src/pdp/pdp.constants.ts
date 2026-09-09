// Passerelle PDP (ADR-107) — Plateforme de Dématérialisation Partenaire.
//
// Point d'entrée des ERP tiers (Odoo, OwoDesk) qui délèguent à facture.gn la
// certification et la transmission fiscale de leurs documents.

/** Nom de la file BullMQ. Stable : la renommer orphelinerait les jobs en attente
 *  dans Redis au moment du déploiement.
 *
 *  FILE DÉDIÉE, et non ETAX_QUEUE — contrairement à ce que la parenté des noms
 *  suggère. Trois raisons, dans l'ordre d'importance :
 *
 *  1. EtaxSyncProcessor lève un UnrecoverableError sur tout job.name qu'il ne
 *     connaît pas. Poser un job PDP sur sa file le ferait échouer sur-le-champ,
 *     sans réessai — un document déposé par un ERP serait perdu à l'instant même
 *     où il est accepté.
 *  2. Le profil de charge n'a rien à voir : un import de lot Odoo dépose des
 *     centaines de documents en quelques secondes, là où l'émission PWA en
 *     produit un à la fois. Les mélanger ferait attendre une facture de caisse
 *     derrière la reprise d'un lot.
 *  3. Le travail n'est pas le même. ETAX_INVOICE_JOB transmet une facture DÉJÀ
 *     certifiée ; ce job-ci doit d'abord la créer et la certifier. */
export const PDP_QUEUE = "pdp-ingestion";

/** Flux e-invoicing (B2B/B2G) : un job par document, qui crée puis certifie la
 *  facture avant de la remettre au circuit e-TVA existant.
 *
 *  Le flux e-reporting (B2C/caisses) n'a PAS de job : ses lignes restent en
 *  `pending` dans pdp_raw_transaction, où un cron viendra les compiler en Z de
 *  caisse global. Enfiler un job par micro-vente n'aurait aucun sens — c'est
 *  précisément l'agrégation qui est demandée à la DGI. */
export const ETAX_INVOICING_UNITARY = "etax-invoicing-unitary";

/** Flux e-reporting (B2C/caisses) : compilation PÉRIODIQUE des lignes de caisse
 *  en un rapport global, JAMAIS un job par micro-vente.
 *
 *  UN JOB PAR ORGANISATION, posé par le cron d'éventail ci-dessous (tranche 3 —
 *  la constante a enfin son producteur). Charge utile :
 *  `PdpReportingJobPayload` (un organizationId, rien de plus). Le worker relit
 *  les lignes tampons lui-même : elles sont la source de vérité, le job n'est
 *  qu'un déclencheur.
 *
 *  Pourquoi un job par organisation et non un seul job global : un lot Odoo qui
 *  échoue chez une PME ne doit pas faire attendre les 400 autres, et chaque
 *  organisation garde son propre budget de réessais (PDP_JOB_OPTIONS). Un job
 *  unique qui boucle sur tous les locataires rejouerait, à la moindre panne sur
 *  l'un d'eux, le travail déjà fait pour tous les précédents. */
export const ETAX_REPORTING_PERIODIC = "etax-reporting-periodic";

/** Le CRON de regroupement (ADR-107, tranche 3) — celui que les commentaires des
 *  tranches précédentes annonçaient.
 *
 *  IL NE CONSOLIDE RIEN LUI-MÊME. Son unique travail est d'ÉNUMÉRER les
 *  organisations qui ont des tickets en attente et de poser un
 *  ETAX_REPORTING_PERIODIC par organisation. Tout le travail lourd (verrou,
 *  sommation, certification) vit derrière ces jobs-là, un par locataire.
 *
 *  Ce découpage est ce qui empêche le cron de devenir un point de panne unique :
 *  un job d'éventail qui échoue est rejoué sans avoir rien écrit, alors qu'un
 *  job monolithique en échec à la 300ᵉ organisation rejouerait 299 consolidations
 *  déjà committées — que la reprise devrait alors distinguer une à une. */
export const ETAX_REPORTING_CONSOLIDATION_CRON = "etax-reporting-consolidation-cron";

/** Identifiant du scheduler BullMQ. STABLE : le renommer laisserait l'ancien
 *  scheduler armé dans Redis, et deux éventails tourneraient en parallèle. */
export const PDP_REPORTING_SCHEDULER_ID = "pdp-reporting-consolidation";

/** Cadence de l'éventail : toutes les heures.
 *
 *  Le choix est un compromis entre deux contraintes opposées. Trop lent, les
 *  tickets s'accumulent dans la table tampon et le Z devient énorme. Trop rapide,
 *  on produit une facture certifiée — donc un numéro Article 23 consommé — pour
 *  trois ventes de caisse, ce qui est exactement l'inondation du guichet DGI que
 *  l'agrégation existe pour éviter. */
export const PDP_REPORTING_INTERVAL_MS = 3_600_000;

/** Plafond de tickets embarqués dans UN Z de caisse.
 *
 *  Borne la mémoire du worker et la durée de la transaction qui pose le verrou de
 *  lignes — une transaction longue sur la table la plus écrite du schéma bloque
 *  les dépôts des connecteurs. Un arriéré (worker arrêté une nuit) se résorbe sur
 *  plusieurs runs successifs, chacun produisant son propre Z : c'est voulu, et
 *  c'est plus honnête qu'un unique Z de 200 000 lignes dont la certification
 *  expirerait en cours de route. */
export const PDP_REPORTING_BATCH_MAX = 5_000;

/** Plafond d'organisations visitées par passage de l'éventail.
 *
 *  Pas de famine : une organisation consolidée disparaît de l'énumération (ses
 *  lignes ne sont plus `pending`), donc les suivantes remontent au passage
 *  d'après. Le plafond ne fait que borner la rafale de jobs posés d'un coup dans
 *  Redis — il retarde, il n'exclut jamais. */
export const PDP_REPORTING_FANOUT_MAX = 1_000;

/** Opt-in explicite, comme MERKLE_ANCHOR_ENABLED (E1) et la rétention (J3) —
 *  aucun cron armé sans ça.
 *
 *  Ce n'est pas de la prudence de principe : ce cron ÉMET des factures certifiées
 *  et consomme des numéros Article 23, irréversiblement. Il ne doit pas se mettre
 *  à tourner du seul fait qu'un environnement a été déployé. */
export function pdpReportingEnabled(): boolean {
  return (process.env.PDP_REPORTING_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Profil d'échec, calqué sur ETAX_JOB_OPTIONS : même guichet en bout de chaîne,
 *  donc même budget de réessais. removeOnFail généreux à dessein — un job mort
 *  est un document fiscal d'un client tiers resté sans suite, le garder permet
 *  d'en lire la cause exacte au support. */
export const PDP_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
} as const;

/** En-tête portant le secret de la clé API du connecteur. */
export const PDP_API_KEY_HEADER = "x-pdp-api-key";

/** jobId déterministe d'un document e-invoicing.
 *
 *  LA SOURCE EST L'UUID DE LA LIGNE TAMPON, JAMAIS clientUniqueId. Le réflexe
 *  serait de composer le jobId avec l'identifiant ERP, puisque c'est lui qui
 *  porte l'idempotence — ce serait un piège à deux détentes :
 *
 *  • BullMQ réserve « : » pour ses propres clés Redis et REJETTE tout jobId qui
 *    en contient (« Custom Id cannot contain : »). Or un clientUniqueId est une
 *    chaîne opaque venue d'un ERP tiers : rien n'interdit « account.move:4211 ».
 *  • et le nettoyer ne suffirait pas — il l'aggraverait. Remplacer les
 *    caractères interdits ferait converger « INV:001 » et « INV-001 », deux
 *    documents DIFFÉRENTS, vers le même jobId : BullMQ dédoublonnerait
 *    silencieusement le second, qui ne serait jamais certifié.
 *
 *  L'uuid de la ligne tampon n'a aucun de ces défauts : il est déjà unique, déjà
 *  sûr pour Redis, et il est déterministe pour un (organizationId,
 *  clientUniqueId) donné puisque la contrainte d'unicité garantit qu'il n'existe
 *  qu'UNE ligne pour ce couple. Le nettoyage reste posé en défense en profondeur
 *  — il ne change rien à un uuid, mais il ferme la porte à un futur appelant qui
 *  passerait autre chose. */
export function buildPdpJobId(rawTransactionId: string): string {
  return `pdp-${rawTransactionId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
