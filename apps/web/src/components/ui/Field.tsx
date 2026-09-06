import type { ComponentProps, ReactNode } from "react";

// Champs de formulaire et paires libellé/valeur, extraits des 7 formulaires
// qui recopiaient les mêmes classes.
//
// Charte §Typographie : Space Grotesk « jamais en dessous de 12px, sinon Inter
// prend le relais ». Les libellés de champ sont en capitales à 11px — donc en
// Inter (`font-sans`), pas en `font-display`. Les 7 libellés existants étaient
// en `font-display text-[10px]`, des deux côtés de la règle ; la primitive les
// remet d'aplomb pour tous les écrans qui l'adoptent.
const LABEL_CLASSES = "mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase";

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={LABEL_CLASSES}>
      {children}
    </label>
  );
}

// Le focus est un outline et non un simple changement de bordure : l'ancien
// `focus:border-2 focus:border-navy-950 focus:outline-none` faisait grandir la
// bordure de 1px, ce qui décale le contenu et reste presque invisible sur un
// écran bon marché. L'outline se pose par-dessus, sans reflow.
const INPUT_CLASSES =
  "w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 " +
  "placeholder:text-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-navy-950 disabled:cursor-not-allowed disabled:opacity-45";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={[INPUT_CLASSES, className].filter(Boolean).join(" ")} />;
}

export function SelectInput({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={[INPUT_CLASSES, className].filter(Boolean).join(" ")}>
      {children}
    </select>
  );
}

// `hint` est rattaché au contrôle par aria-describedby côté appelant (l'id est
// dérivé de `htmlFor`) — un texte d'aide qui n'est pas annoncé au lecteur
// d'écran n'aide que les voyants.
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-navy-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Paire libellé/valeur en lecture seule (écrans Paramètres, détail client,
// détail produit). Rendue en <dt>/<dd> : c'est une liste de définitions, pas
// deux <div> qui se ressemblent — le lecteur d'écran annonce le couple.
export function DataField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={LABEL_CLASSES}>{label}</dt>
      <dd className="text-sm text-navy-950">{children}</dd>
    </div>
  );
}
