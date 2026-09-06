import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Primitive bouton du Design System, extraite des 11 boutons qui recopiaient
// les mêmes classes à la main. Quatre variantes, nommées par ce qu'elles
// FONT — les deux premières coexistent déjà dans la maquette et ne sont pas
// interchangeables :
//
//   primary   Navy plein. L'action qui valide un écran (« Se connecter »,
//             « Créer le client », « Émettre »). C'est le bouton par défaut.
//   accent    Or de Guinée. Le CTA de marque, celui qui lance un parcours
//             depuis une page de lecture (« + Émettre une facture »). Rare :
//             un par écran au plus, sinon l'accent ne signale plus rien.
//   secondary Contour Navy sur blanc. Action de rappel, à côté d'un primary.
//   ghost     Sans fond. Navigation discrète, actions de liste.
//
// R-11 : `accent` pose du Navy sur l'Or (9.4:1), jamais du blanc (1.8:1). Le
// focus est tracé en Navy et non en Or — un anneau Or sur blanc plafonne à
// 1.8:1, sous les 3:1 que WCAG 2.2 demande à un indicateur de focus.
type Variant = "primary" | "accent" | "secondary" | "ghost";
type Size = "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-navy-950 text-white hover:bg-navy-800",
  accent: "bg-or text-navy-950 hover:brightness-95",
  secondary: "border border-navy-200 bg-white text-navy-950 hover:bg-navy-50",
  ghost: "text-navy-600 hover:bg-navy-50 hover:text-navy-950",
};

// `lg` sert la variante « lite » (terrain) et les soumissions pleine largeur :
// 48px de haut, la cible tactile confortable d'un téléphone tenu à une main,
// debout, parfois avec des gants.
const SIZE_CLASSES: Record<Size, string> = {
  md: "min-h-[40px] px-6 py-2.5 text-sm",
  lg: "min-h-[48px] px-6 py-3 text-base",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-[10px] font-display font-semibold transition " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 " +
  "disabled:cursor-not-allowed disabled:opacity-45";

function classesFor(variant: Variant, size: Size, className?: string): string {
  return [BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className].filter(Boolean).join(" ");
}

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: CommonProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button {...props} className={classesFor(variant, size, className)}>
      {children}
    </button>
  );
}

// Même apparence, sémantique de lien — un « bouton » qui navigue reste un
// <a> : clic milieu, ouverture dans un onglet, lecteur d'écran qui annonce un
// lien. Composant distinct plutôt qu'une prop `href` polymorphe, pour que le
// typage des props natives ne devienne pas une union illisible.
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: CommonProps & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link {...props} className={classesFor(variant, size, className)}>
      {children}
    </Link>
  );
}
