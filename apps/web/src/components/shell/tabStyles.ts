// Apparence d'un onglet de la barre basse, partagée par BottomTabBar (les
// onglets qui naviguent) et MoreDrawer (l'onglet « Plus », qui ouvre un
// tiroir au lieu de naviguer). Fichier à part pour éviter le cycle d'import
// entre les deux — et parce qu'un onglet qui ne ressemble pas exactement aux
// autres se lit comme un bouton étranger posé dans la barre.
//
// 56px de haut, colonne icône + libellé : au-dessus des 44px recommandés en
// cible tactile, sans manger l'écran. L'onglet actif passe en Navy plein et
// gagne un trait supérieur — la couleur seule ne suffit pas à signaler un
// état (WCAG 1.4.1 : jamais la couleur comme unique vecteur d'information).
export function tabItemClasses(active: boolean): string {
  return [
    "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 border-t-2 px-1 pt-1 pb-1.5",
    "text-[11px] font-medium transition",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy-950",
    active ? "border-t-navy-950 text-navy-950" : "border-t-transparent text-navy-600 hover:text-navy-950",
  ].join(" ");
}
