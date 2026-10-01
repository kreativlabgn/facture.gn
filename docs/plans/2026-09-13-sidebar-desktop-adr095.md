# Plan : Barre latérale desktop pour l'espace connecté (ADR-095) (2026-09-13)

> Écrit rétroactivement, avant commit — le code de ce chantier existait déjà,
> non commité, au début de la session d'audit qui a produit ce plan. Il
> documente fidèlement ce qui a été fait, pas une intention a priori, pour
> combler le trou de process (CONTRIBUTING.md exige un plan daté avant tout
> changement non trivial) sans réécrire l'historique.

## Contexte

L'espace connecté marchand (`(app)`) n'avait, à partir de `md`, que le couple
`NavDrawer`/`PrimaryNav` logé dans `AppHeader` : un tiroir qui s'ouvrait
depuis l'en-tête pour les entrées secondaires, et des onglets inline pour les
trois destinations quotidiennes. Sur un écran large, ce n'est pas là qu'on
cherche une navigation principale — l'œil la cherche sur le côté, en rail
permanent, comme le fait déjà l'espace cabinet (`CabinetShell`/`CabinetSidebar`).

## Problème

- Navigation desktop confinée à l'en-tête (`PrimaryNav`) + un tiroir
  (`NavDrawer`) qui duplique la logique d'affichage déjà portée par
  `BottomTabBar`/`MoreDrawer` côté mobile — deux rendus de plus pour une seule
  liste (`nav.ts`), avec le risque de divergence que ça implique.
- Aucune rétractation possible : le rail, une fois introduit, doit rester
  utilisable sur les écrans où 256px de large coûtent cher au contenu.
- Le seuil cabinet (`/dashboard/espace-cabinet`) n'est pas dans `nav.ts` — il
  doit rester prioritaire sur la détection d'onglet actif sans y être ajouté
  en dur.

## Solution retenue

- `SidebarNavigation.tsx` (nouveau) : rail `hidden md:flex`, repliable
  (icônes seules + `sr-only`, sans persistance d'état — une préférence
  d'affichage n'est pas une donnée), alimenté par la même table `nav.ts` que
  `BottomTabBar`/`MoreDrawer`. État actif porté par un liseré Or **et**
  `aria-current`, jamais la couleur seule (WCAG 1.4.1).
- `(app)/layout.tsx` : bascule vers `h-dvh` à partir de `md` — la coquille
  prend exactement la hauteur de la fenêtre, seule la zone de travail défile
  (`min-h-0` + `overflow-y-auto`) ; en dessous de `md`, flux normal inchangé.
- `AppHeader.tsx` : allégé — ne porte plus de navigation, seulement la marque
  et `OrgSwitcher`.
- `icons.tsx` : sept icônes ajoutées pour distinguer les entrées du rail une
  fois replié (`ProductsIcon`, `UssdIcon`, `CreditsIcon`, `ReferralIcon`,
  `SettingsIcon`, `CabinetIcon`, `LogoutIcon`).
- `NavDrawer.tsx`/`PrimaryNav.tsx` supprimés — le tiroir mobile « Plus » est
  déjà couvert indépendamment par `MoreDrawer.tsx`, aucune régression.
- `PortalTabs.tsx` : un commentaire mis à jour (renommage de la référence à
  `PrimaryNav`), aucun changement fonctionnel.

## Fichiers et tâches

- `apps/web/src/components/shell/SidebarNavigation.tsx` (nouveau)
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/components/shell/AppHeader.tsx`
- `apps/web/src/components/shell/icons.tsx`
- `apps/web/src/app/portail/(coquille)/PortalTabs.tsx`
- Suppression : `apps/web/src/components/shell/NavDrawer.tsx`,
  `apps/web/src/components/shell/PrimaryNav.tsx`

## Tests avant code

Aucun nouveau test unitaire : ce dépôt n'a pas de harnais de rendu de
composants pour les éléments du shell (confirmé — ni `NavDrawer.tsx` ni
`PrimaryNav.tsx` n'en avaient avant leur suppression), et `nav.ts` — la seule
logique pure derrière ce rail — était déjà couvert par `nav.spec.ts`, non
modifié par ce chantier.

## Critères de done

- Un seul repère « Navigation principale » exposé à un instant donné (rail
  desktop **ou** barre basse mobile, jamais les deux, `display:none` retire
  l'élément de l'arbre d'accessibilité).
- Aucune régression sur le tiroir mobile « Plus » (`MoreDrawer`, indépendant
  du fichier supprimé).
- `pnpm --filter web lint typecheck test build` passent tous.

## Risques et limites

- Rail et barre basse mobile restent deux implémentations distinctes d'une
  même table `nav.ts` — un rendu de plus à maintenir en cohérence, atténué par
  la source unique.
- Pas de mémorisation de l'état replié entre sessions (voulu, pas un oubli).
