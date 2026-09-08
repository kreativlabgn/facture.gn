// Chantier 5, étape 3 — télétransmission des déclarations de TVA à eTax (DGI),
// déclenchée par la clôture d'un exercice fiscal.

/** Nom de la file BullMQ. Stable : le renommer orphelinerait les jobs en attente
 *  dans Redis au moment du déploiement. */
export const ETAX_QUEUE = "etax-synchronization";

/** Déclaration périodique : un job par exercice clos. */
export const ETAX_SYNC_JOB = "declare-fiscal-period";

/** Transmission unitaire (LFI 2025) : un job par facture émise.
 *
 *  MÊME FILE que la déclaration périodique, à dessein — même guichet, même
 *  profil de panne, même budget de réessais. Deux files auraient dédoublé la
 *  connexion Redis et la supervision sans rien séparer d'utile. Le prix est que
 *  le processeur DOIT désormais discriminer sur job.name : sans cela, une
 *  facture serait traitée comme une déclaration d'exercice. */
export const ETAX_INVOICE_JOB = "transmit-invoice";

/** Profil d'échec. eTax est un service public dont les fenêtres de maintenance
 *  ne nous sont pas annoncées : 5 tentatives espacées exponentiellement à partir
 *  de 5 s couvrent ~2h35 (5s, 10s, 20s, 40s — le job final tombe en échec après
 *  la 5e). Au-delà, s'acharner n'aide plus : la clôture reste marquée non
 *  transmise en base (etax_submitted_at NULL), et c'est cette trace-là — pas
 *  Redis — qui permet le rattrapage.
 *
 *  removeOnFail généreux À DESSEIN : un job mort est une déclaration fiscale non
 *  transmise, la garder permet d'en lire la cause exacte au support. */
export const ETAX_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
} as const;

/** Plus large que les 3 s de PaymentLinkClient : rien n'attend cette réponse
 *  côté utilisateur (c'est un worker de fond), et un guichet public est lent. */
export const ETAX_REQUEST_TIMEOUT_MS = 15_000;

/** Opt-in EXPLICITE, comme RETENTION_ENABLED. Sans cela, tout environnement de
 *  développement ou de test qui clôture un exercice tenterait d'écrire chez la
 *  DGI — une déclaration fiscale ne se retire pas. Le défaut est donc « ne
 *  transmet pas », et il faut une décision consciente pour l'activer. */
export function etaxEnabled(): boolean {
  return (process.env.ETAX_ENABLED ?? "").trim().toLowerCase() === "true";
}
