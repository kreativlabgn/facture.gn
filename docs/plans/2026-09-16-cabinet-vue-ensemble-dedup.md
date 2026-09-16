# Plan : `/cabinet` redevient une vue d'ensemble, pas un 3e exemplaire des pages dédiées

## Contexte projet

`/cabinet` (Chantier C, plan `2026-09-08-cabinet-etancheite-console.md`) a été
construit comme une console à deux onglets (`?tab=portefeuille` /
`?tab=structure`) AVANT que les pages dédiées `/cabinet/organizations`,
`/cabinet/members`, `/cabinet/settings` n'existent toutes. Elles existent
maintenant, toutes accessibles depuis `CABINET_NAV_GROUPS`
(`lib/cabinet-nav.ts`), et chacune fait ce que faisait déjà un onglet de
`/cabinet` — en mieux pour deux d'entre elles (formulaire d'invitation sur
`/cabinet/members`, `Card` de gestion des réglages sur `/cabinet/settings`).
Résultat : trois définitions locales de `Chiffre`/`Th`/`LigneClient` pour la
même table de portefeuille (`/cabinet` onglet Portefeuille et
`/cabinet/organizations`), et deux définitions de la fiche du cabinet +
liste des collaborateurs (`/cabinet` onglet « Le cabinet », `/cabinet/settings`
+ `/cabinet/members`).

## Problème

1. **Onglet « Portefeuille »** duplique `/cabinet/organizations` (table
   complète des clients sous mandat), avec des colonnes légèrement
   différentes (Encaissé/Encours/Écritures côté `/cabinet`, Factures/Volume
   côté `/cabinet/organizations`) — aucune des deux n'est un sur-ensemble de
   l'autre. Les cartes « À surveiller » de la vue d'ensemble pointent déjà
   vers `/cabinet/organizations`, jamais vers cet onglet : l'app elle-même
   préfère la page dédiée.
2. **Onglet « Le cabinet »** empile trois blocs : la fiche d'identité (quasi
   identique à celle de `/cabinet/settings`), les collaborateurs (duplique
   `/cabinet/members`, qui a en plus le formulaire d'invitation), et le
   partage d'honoraires — qui, lui, n'existe NULLE PART ailleurs.
3. Le mécanisme `?tab=`/`CABINET_TABS`/`resolveCabinetTab` (`cabinet-nav.ts`)
   n'a plus de raison d'exister une fois les deux onglets retirés.

## Solution retenue

- `/cabinet` garde : les 3 tuiles KPI (Entreprises suivies / Volume facturé /
  Collaborateurs), le bloc « À surveiller » (déjà correct, inchangé), et nne
  garde PAS de teaser du portefeuille. Un « top 5 clients » serait une
  troisième vue de la même donnée sans rien y ajouter : la tuile « Entreprises
  suivies » donne déjà le compte, « À surveiller » donne déjà les deux cas où
  cliquer sert à quelque chose (sans activité / données indisponibles), et
  l'entrée « Entreprises suivies » de la barre latérale est à un clic. Une
  demi-mesure ici serait la duplication de plus que ce chantier doit retirer,
  pas en ajouter une troisième forme.
- Suppression complète de l'onglet « Portefeuille » (la table complète) et de
  l'onglet « Le cabinet » (fiche + collaborateurs) sur `/cabinet`, ainsi que du
  mécanisme `?tab=` dans `cabinet-nav.ts` — confirmé sans autre dépendant par
  recherche globale (seuls `app/cabinet/page.tsx` et `lib/cabinet-nav.spec.ts`
  référencent `CABINET_TABS`/`resolveCabinetTab`/`CabinetTab`).
- **Partage d'honoraires** (`PartageDHonoraires`, `chargerPartageHonoraires()`)
  déménage sur `/cabinet/settings`, après Palier partenaire et Reversement —
  mêmes thèmes commerciaux, même page déjà réservée à `practice_admin`.
  **Effet de bord assumé et à noter** : ce panneau était visible à TOUT membre
  actif du cabinet sur l'ancien onglet « Le cabinet » ; `/cabinet/settings`
  est entièrement gardé par `canManagePractice` (`practice_admin` seul). Un
  comptable externe ou un gestionnaire d'affaires perd donc la visibilité sur
  la commission d'apporteur du cabinet. C'est la destination demandée par ce
  chantier ; le point est signalé en fin de rapport plutôt que résolu
  unilatéralement (ce serait une décision produit — qui touche au cabinet
  perçoit la commission — hors du périmètre d'un nettoyage de duplication).
- **`/cabinet/organizations` devient la seule table de portefeuille** :
  comparaison ligne à ligne de `LigneClient` (les deux copies) avant
  suppression de l'onglet —

  | Colonne | Ancien onglet Portefeuille | `/cabinet/organizations` (avant) |
  |---|---|---|
  | Entreprise (lien) | oui, nom cliquable | non, nom seul + action « Ouvrir » séparée |
  | Accès accordé | oui | oui |
  | Factures émises | non (dans le sous-texte du nom) | oui, colonne dédiée |
  | Volume | non | oui |
  | Encaissé | oui | non |
  | Encours (majorant) | oui | non |
  | FEC (Écritures) | oui, lien de téléchargement | non |

  `Encaissé`, `Encours` et le lien FEC disparaissaient avec l'onglet sans
  exister ailleurs : ils sont portés sur `/cabinet/organizations` (colonnes
  supplémentaires + action FEC à côté de « Ouvrir »), avec la même mise en
  garde texte sur le caractère majorant de l'encours. Rien n'est perdu ; le nom
  cliquable de l'ancien onglet n'est PAS repris (choix délibéré, périmètre
  minimal : `/cabinet/organizations` a déjà une action « Ouvrir » équivalente,
  changer ce point serait une modification UX non demandée).
- **`Chiffre` → `KpiTile`** (`components/ui/KpiTile.tsx`) : après nettoyage,
  3 écrans du cabinet en ont encore besoin avec une signature identique
  (`libelle`, `valeur`, `note?`, `mono?`, `alerte?`) — `/cabinet` (3 tuiles),
  `/cabinet/organizations` (3 tuiles) et `/cabinet/settings` (3 tuiles du
  partage d'honoraires qui y emménage). Aucun composant KPI-tile n'existait
  dans `components/ui` : `KpiTile` l'ajoute et les trois écrans migrent. Taille
  de police unifiée sur `text-xl` (celle déjà utilisée par 2 des 3 écrans) —
  `/cabinet` seul utilisait `text-2xl` sans raison fonctionnelle documentée ;
  décision de cohérence mineure, notée ici plutôt que conservée comme
  troisième variante à paramétrer.
- **`Th` reste local** à `/cabinet/organizations/page.tsx` : après le
  nettoyage, une seule table de portefeuille subsiste dans tout l'espace
  cabinet, donc un seul usage — l'extraire dans `components/ui` n'aurait pas de
  second appelant. Documenté ici plutôt qu'extrait « au cas où ».

## Alternatives écartées

- **Garder un onglet « Portefeuille » réduit à un aperçu (5 lignes) sur
  `/cabinet`.** Rejeté : peser le pour/contre demandé par ce chantier — un tel
  aperçu resterait une troisième vue de la même donnée pour un bénéfice
  marginal (gagner un clic vers une page déjà accessible depuis la barre
  latérale), alors que le risque de divergence dans le temps entre l'aperçu et
  la table complète est réel (Chantier C l'a déjà illustré : les deux tables
  existantes avaient déjà divergé sur les colonnes).
- **Fusionner `Encaissé`/`Encours` en un seul « Solde » sur
  `/cabinet/organizations`.** Rejeté : les deux nombres répondent à des
  questions différentes (ce qui est soldé vs. ce qui reste, majorant) et
  l'ancien onglet les distinguait déjà — les fusionner perdrait une nuance que
  ce chantier doit justement préserver.
- **Rendre `KpiTile` configurable en taille (`size` prop).** Rejeté : un seul
  écran demandait une taille différente sans raison métier ; ajouter un prop
  de configuration pour ça est de l'abstraction non justifiée par le besoin
  actuel (voir consignes de rôle : pas de configurabilité au-delà de la tâche).

## Découpage

1. `lib/cabinet-nav.spec.ts` — retirer le describe « onglets de la console »
   et les imports `CABINET_TABS`/`resolveCabinetTab` devenus inutiles.
2. `lib/cabinet-nav.ts` — retirer la section `CABINET_TABS`/`CabinetTab`/
   `resolveCabinetTab`.
3. `components/ui/KpiTile.tsx` — nouvelle primitive, export dans
   `components/ui/index.ts`.
4. `app/cabinet/page.tsx` — réécriture : plus de `searchParams`/`?tab=`, plus
   de `Portefeuille`/`Structure`/`Onglets`/`PartageDHonoraires`/`LigneClient`/
   `LigneMembre`/`Chiffre`/`Th` locaux ; 3 tuiles `KpiTile` + `SurveillanceCabinet`
   (inchangé) uniquement.
5. `app/cabinet/organizations/page.tsx` — colonnes `Encaissé`/`Encours`
   ajoutées, action FEC ajoutée à côté de « Ouvrir », note sur le majorant de
   l'encours, `Chiffre` local remplacé par `KpiTile`.
6. `app/cabinet/settings/page.tsx` — ajout de `chargerPartageHonoraires()` et
   du bloc `PartageDHonoraires` (utilisant `KpiTile`) après « Reversement ».

## Tests

Périmètre TDD réel de ce chantier : la seule logique pure touchée est
`resolveCabinetTab`/`CABINET_TABS` (retirée) dans `lib/cabinet-nav.ts`, déjà
couverte par `lib/cabinet-nav.spec.ts` — le test est réduit en même temps que
le code qu'il couvrait cesse d'exister (pas de RED artificiel à fabriquer pour
une suppression). `lib/cabinet.ts` (`chargerConsoleCabinet`,
`chargerPartageHonoraires`) n'est pas modifié : `lib/cabinet.spec.ts` reste tel
quel et sert de filet de non-régression sur les données que les pages
consomment.

Les pages elles-mêmes (`app/cabinet/**/page.tsx`) n'ont, dans ce dépôt, jamais
de spec dédiée (vérifié : seul `mandates/actions.spec.ts` existe sous
`app/cabinet`) — la discipline existante les couvre par :
- `design-system.guardrails.spec.ts` (tokens, contraste, pas de dégradé) ;
- `cabinet-seuil.guardrails.spec.ts` (étanchéité `/cabinet` ↔ `/dashboard`,
  non affectée par ce chantier — aucun lien latéral touché) ;
- `pnpm --filter web typecheck` (détecte tout import mort ou prop orpheline
  après suppression de `Structure`/`Portefeuille`) ;
- `pnpm --filter web build`.

Pas de nouveau fichier de spec ajouté pour `KpiTile` : composant de
présentation pure, sans branche de logique propre, dans la même famille que
`Card`/`Badge`/`EmptyState`/`Field` — aucun n'a de spec dédiée dans ce dépôt.

## Critères de done

- `pnpm --filter web lint typecheck test build` vert, guardrails inclus.
- Aucune régression d'information : les colonnes Encaissé/Encours/FEC
  survivent sur `/cabinet/organizations`.
- Aucun lien direct vers `/cabinet` depuis l'espace marchand, aucune sortie
  directe vers `/dashboard` depuis l'espace cabinet (inchangé, vérifié par
  guardrails existants).
- `AUCUN COMMIT` — le working tree reste pour relecture.

## Reste ouvert

- **Visibilité du partage d'honoraires réduite à `practice_admin`** après le
  déménagement vers `/cabinet/settings` (alors qu'elle était ouverte à tout
  membre actif sur l'ancien onglet). Signalé au demandeur — pas tranché ici,
  c'est une décision produit et non un nettoyage de duplication.
- Le nom de l'entreprise sur `/cabinet/organizations` reste un texte simple
  (pas un lien) alors que l'ancien onglet Portefeuille le rendait cliquable en
  plus de l'action « Ouvrir » — laissé tel quel, changement UX non demandé par
  ce chantier.
