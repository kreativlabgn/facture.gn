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
