import { Card } from "./Card";

// Un chiffre clé, seul dans sa carte : libellé en petites capitales, valeur en
// gros, note optionnelle en dessous. Trois écrans du cabinet en avaient chacun
// leur copie locale (`Chiffre`), identiques hors une taille de police
// divergente sans raison fonctionnelle — voir
// docs/plans/2026-09-16-cabinet-vue-ensemble-dedup.md. Cette primitive les
// remplace ; elle ne porte aucune variante que personne ne demande encore.
export function KpiTile({
  libelle,
  valeur,
  note,
  mono = false,
  alerte = false,
}: {
  libelle: string;
  valeur: string;
  note?: string;
  mono?: boolean;
  alerte?: boolean;
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">{libelle}</p>
        <p
          className={`mt-1 text-xl font-bold text-navy-950 ${mono ? "font-mono tabular-nums" : "font-display"}`}
        >
          {valeur}
        </p>
        {note ? (
          <p className={`mt-1 text-xs ${alerte ? "text-amber-text" : "text-navy-600"}`}>{note}</p>
        ) : null}
      </div>
    </Card>
  );
}
