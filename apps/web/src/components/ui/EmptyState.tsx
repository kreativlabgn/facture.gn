import type { ReactNode } from "react";

// État vide / état d'accès refusé, extrait des 4 blocs identiques qui vivaient
// dans dashboard/layout, cabinet/layout, settings et la liste de factures.
//
// Le ton compte : un état vide dit ce qu'il n'y a pas ET ce qu'on peut faire.
// Un accès refusé dit qui a le droit, sans s'excuser ni accuser — l'écran
// n'est pas une punition, c'est un périmètre.
export function EmptyState({
  title,
  description,
  action,
  heading = "h2",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  heading?: "h1" | "h2";
}) {
  const Heading = heading;

  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
      <Heading className="font-display text-lg font-bold text-navy-950">{title}</Heading>
      <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
