import type { ReactNode } from "react";
import { Badge } from "@/components/ui";

// Alerte de relecture du Hub Vision (ADR-122) — affichée quand le serveur a
// basculé un scan en DRAFT_PENDING_MANUAL_REVIEW : la double-garde a relevé au
// moins un centime d'écart, aucun brouillon n'a été créé, une main humaine
// doit relire le carnet.
//
// ── SIGNALÉTIQUE : AMBRE FONCÉ, JAMAIS L'OR ──────────────────────────────────
// L'Or de Guinée (#f2b705) est l'accent de MARQUE ; sur fond clair il plafonne
// à 1.8:1 en texte — illisible en plein soleil, et interdit par R-11. L'alerte
// pose donc `amber-text` (#a55a05, 5.2:1 sur blanc — AA en petite taille) sur
// une SURFACE BLANCHE, pas sur la teinte `amber-bg` : le contraste maximal est
// ce qui sauve la lecture sur un écran de téléphone au marché de Madina. Le
// corps est en Navy 950 ; l'ambre ne porte que le titre, le liseré et l'icône.
//
// L'information n'est JAMAIS portée par la couleur seule (WCAG 1.4.1) : icône
// SVG inline (aucune fonte d'icônes, poids de page sur forfait data guinéen)
// ET titre en toutes lettres ET liste des écarts, chacun avec le montant lu et
// le montant attendu. `role="alert"` : annoncé immédiatement par un lecteur
// d'écran, sans focus à déplacer.
//
// Les montants arrivent en centimes, sérialisés en chaîne (BigInt côté
// trust-api). Ils sont affichés AVEC leurs centimes — formatGnf() les tronque
// au GNF, et « 234 000 GNF » contre « 234 000 GNF » ne montrerait pas l'écart
// d'un centime qui a précisément déclenché cette alerte.

// Plan 2026-09-16 (OCR multicanal vocal/WhatsApp) — mirroir de
// OcrDocument.source (packages/db/prisma/schema.prisma). IMAGE_SCAN est
// l'origine historique (photo de carnet) : elle ne porte aucun badge, aucun
// texte brut cité, l'alerte reste identique à ce qu'elle a toujours été.
export type OcrDocumentSource = "IMAGE_SCAN" | "AUDIO_PWA" | "WHATSAPP_VOICE" | "WHATSAPP_TEXT";

// AUDIO_PWA et WHATSAPP_VOICE sont deux CANAUX pour la même NATURE de contenu
// (une transcription de voix) — même libellé de badge et même mot pour le
// bloc cité. WHATSAPP_TEXT est un message tapé, jamais transcrit : le badge
// et le texte d'accompagnement le disent explicitement, pour ne jamais
// laisser croire qu'un modèle de transcription a pu se tromper sur un texte
// qui n'a jamais été audio. IMAGE_SCAN est absent des deux tables : c'est ce
// qui garde le composant inchangé pour cette source (et l'absence de `source`).
const BADGE_PAR_SOURCE: Partial<Record<OcrDocumentSource, string>> = {
  AUDIO_PWA: "Source : note vocale",
  WHATSAPP_VOICE: "Source : note vocale",
  WHATSAPP_TEXT: "Source : WhatsApp",
};

const LIBELLE_TEXTE_BRUT_PAR_SOURCE: Partial<Record<OcrDocumentSource, string>> = {
  AUDIO_PWA: "Lecture du modèle",
  WHATSAPP_VOICE: "Lecture du modèle",
  WHATSAPP_TEXT: "Message reçu",
};

export type OcrFindingCode = "LIGNE_TOTAL" | "SOMME_LIGNES" | "TOTAL_TTC" | "TVA_REGIME";

export type OcrFinding = {
  code: OcrFindingCode;
  chemin: string;
  attendu: string;
  constate: string;
};

const LIBELLES: Record<OcrFindingCode, string> = {
  LIGNE_TOTAL: "Le total de la ligne ne vaut pas quantité × prix unitaire",
  SOMME_LIGNES: "La somme des lignes ne retombe pas sur le total du pied de facture",
  TOTAL_TTC: "HT + TVA ne donne pas le TTC écrit",
  TVA_REGIME: "La TVA lue ne correspond pas à votre régime fiscal",
};

const CHAMPS: Record<string, string> = {
  "totals.totalHT": "Total HT",
  "totals.totalVAT": "TVA",
  "totals.totalTTC": "Total TTC",
};

/** `lines.2.lineTotal` → « Ligne 3 » ; `totals.totalVAT` → « TVA ». */
export function libelleChemin(chemin: string): string {
  const ligne = /^lines\.(\d+)\./.exec(chemin);
  if (ligne) {
    return `Ligne ${Number(ligne[1]) + 1}`;
  }
  return CHAMPS[chemin] ?? chemin;
}

/** « 23400001 » → « 234 000,01 GNF ». Aucun flottant : la partie entière et
 *  les deux centimes sont séparés TEXTUELLEMENT. */
export function formatCentimes(centimesString: string): string {
  const chiffres = centimesString.replace(/\D/g, "").padStart(3, "0");
  const entier = BigInt(chiffres.slice(0, -2)).toLocaleString("fr-FR");
  return `${entier},${chiffres.slice(-2)} GNF`;
}

function IconeRelecture() {
  // Triangle d'avertissement, tracé en `currentColor` : il prend l'ambre du
  // conteneur. aria-hidden — le titre en toutes lettres porte déjà le sens.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6 shrink-0"
    >
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.25h.01" />
    </svg>
  );
}

export function OcrReviewAlert({
  findings,
  action,
  source,
  textBrut,
}: {
  findings: OcrFinding[];
  /** Bouton ou lien vers la saisie manuelle du brouillon, s'il y a lieu. */
  action?: ReactNode;
  /** Absent ou "IMAGE_SCAN" : aucun changement visuel (comportement historique). */
  source?: OcrDocumentSource;
  /** Transcription (vocal) ou message tel quel (WhatsApp texte). Ignoré si `source` n'a pas de badge associé. */
  textBrut?: string | null;
}) {
  const pluriel = findings.length > 1;
  const badge = source ? BADGE_PAR_SOURCE[source] : undefined;
  const libelleTexteBrut = source ? LIBELLE_TEXTE_BRUT_PAR_SOURCE[source] : undefined;

  return (
    <section
      role="alert"
      aria-labelledby="ocr-review-title"
      className="rounded-2xl border-2 border-amber-text bg-white p-5 text-navy-950"
    >
      <div className="flex items-start gap-3 text-amber-text">
        <IconeRelecture />
        <div className="min-w-0">
          <h2 id="ocr-review-title" className="font-display text-base font-bold">
            Relecture requise — aucune facture n&apos;a été créée
          </h2>
          <p className="mt-1 text-sm text-navy-800">
            La lecture automatique du carnet présente {pluriel ? `${findings.length} écarts` : "un écart"} de calcul.
            Vérifiez le papier avant de saisir la facture.
          </p>
        </div>
      </div>

      {badge ? (
        <div className="mt-3">
          <Badge tone="navy">{badge}</Badge>
        </div>
      ) : null}

      {libelleTexteBrut && textBrut ? (
        <div className="mt-3">
          <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">{libelleTexteBrut}</p>
          <blockquote className="mt-1.5 rounded-xl bg-navy-950 p-4 font-mono text-xs leading-relaxed text-white">
            {textBrut}
          </blockquote>
        </div>
      ) : null}

      <ul className="mt-4 divide-y divide-navy-100 border-t border-navy-100">
        {findings.map((ecart, index) => (
          <li key={`${ecart.chemin}-${index}`} className="py-3 text-sm">
            <p className="font-semibold text-navy-950">
              <span className="font-mono text-[11px] font-bold tracking-wide text-amber-text uppercase">
                {libelleChemin(ecart.chemin)}
              </span>
              <span className="ml-2">{LIBELLES[ecart.code] ?? ecart.code}</span>
            </p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-navy-800">
              <dt>Lu sur le papier</dt>
              <dd className="font-mono tabular-nums">{formatCentimes(ecart.constate)}</dd>
              <dt>Attendu</dt>
              <dd className="font-mono tabular-nums">{formatCentimes(ecart.attendu)}</dd>
            </dl>
          </li>
        ))}
      </ul>

      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
