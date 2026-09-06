import type { ReactNode } from "react";

// Pastille « .pill » de la maquette (Écran 04) : JetBrains Mono 700, fond
// teinté à 12 %, texte assombri pour tenir le 4.5:1 sur ce fond (voir
// globals.css). Primitive extraite de StatusPill, qui n'en est plus qu'une
// table de correspondance statut → ton.
//
// Deux familles de tons, délibérément non fusionnées : `green/amber/blue/red`
// est la palette de STATUT (où en est le document), `good/bad` porte un SENS
// MÉTIER (vérifié/payé vs erreur/rejet). `navy` est le ton neutre — brouillon,
// annulé, expiré : ni bon ni mauvais, juste sans signal.
export type BadgeTone = "green" | "amber" | "blue" | "red" | "navy" | "good" | "bad";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-green-bg text-green-text",
  amber: "bg-amber-bg text-amber-text",
  blue: "bg-blue-bg text-blue-text",
  red: "bg-red-bg text-red-text",
  // navy-600 et non navy-400 : composité sur bg-navy-50 le premier donne
  // 5.13:1, le second 2.70:1 (voir le garde-fou AA de design-system.guardrails).
  navy: "bg-navy-50 text-navy-600",
  good: "bg-good-bg text-good-text",
  bad: "bg-bad-bg text-bad-text",
};

const BASE_CLASSES = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold";

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`${BASE_CLASSES} ${TONE_CLASSES[tone]}`}>{children}</span>;
}
