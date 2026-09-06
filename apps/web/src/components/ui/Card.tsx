import type { ReactNode } from "react";

// Surface de la maquette consolidée : carte blanche sur le fond gris, bordure
// Navy à 12 %, coins 16px. Aucune ombre — la hiérarchie tient au contraste des
// surfaces (--surface sur --grey), pas à une élévation qui disparaîtrait sur
// un écran bon marché mal calibré.
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={["rounded-2xl border border-navy-100 bg-white", className].filter(Boolean).join(" ")}>{children}</div>
  );
}

// En-tête optionnel : titre + action à droite (« Voir tout », « + Nouveau »).
// `title` est rendu dans un <h2> — les pages posent le <h1>, une carte ne
// s'arroge jamais le titre de l'écran.
export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-navy-50 px-5 py-4">
      <h2 className="font-display text-base font-semibold text-navy-950">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["p-5", className].filter(Boolean).join(" ")}>{children}</div>;
}
