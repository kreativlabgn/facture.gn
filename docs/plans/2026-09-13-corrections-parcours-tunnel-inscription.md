# Plan : Corrections post-audit marchand/cabinet/acheteur et cohérence du tunnel d'inscription (2026-09-13)

## Contexte

Un audit de code (lecture seule) du parcours marchand/cabinet/acheteur vient
d'être fait. Le fondateur valide cinq corrections prioritaires : quatre bugs
confirmés, la suppression d'un écran dupliqué, et une refonte ciblée de la
continuité visuelle entre `/register` et `/onboarding` / `/nouveau-cabinet` —
le tunnel d'inscription, jugé décisif pour la conversion (« c'est ce qui donne
l'envie de rester ou d'abandonner l'inscription »).

Le dépôt contient déjà des changements non commités, sans rapport, sur la
barre latérale desktop (`feat/sidebar-desktop-adr095` : `(app)/layout.tsx`,
`AppHeader.tsx`, `SidebarNavigation.tsx`, `icons.tsx`, `PortalTabs.tsx`,
suppression de `NavDrawer.tsx`/`PrimaryNav.tsx`). Ce plan n'y touche pas.

## Problème

1. `cabinet/mandates/page.tsx` gate à tort l'affichage du formulaire de
   demande de mandat sur `canRevokeMandate` (practice_admin seul) alors que
   `canRequestMandate` (lib/cabinet-nav.ts, ADR-068/078) ouvre ce geste à tout
   membre actif — un comptable externe ou un gestionnaire d'affaires ne voit
   jamais le formulaire qui leur est pourtant ouvert côté serveur.
2. `cabinet/page.tsx` : deux cartes « À surveiller » pointent vers `/cabinet`,
   la page où elles sont déjà affichées — clic sans effet.
3. `(app)/dashboard/page.tsx` : la carte « Créer une facture » de la section
   « À traiter maintenant » n'est pas gardée par `canEmit`, contrairement au
   bouton d'en-tête qui mène à la même action — un rôle sans `invoices:create`
   (viewer, tax_controller_readonly) la voit quand même.
4. `(app)/dashboard/invoices/new/page.tsx` appelle `listCustomers` sans
   `try/catch`, contrairement aux autres écrans propriétaire/admin du même
   dossier (`credits`, `abonnement`, `parrainage`) qui interceptent
   `TrustApiError` (403) avec un état contrôlé.
5. `app/espace-cabinet/` et `app/espace-marchand/` (routes de premier niveau)
   affichent des écrans strictement dupliqués de `(auth)/nouveau-cabinet` et
   d'une redirection déjà faite ailleurs, et ne sont plus liés par aucun
   bouton de l'interface.
6. Le tunnel d'inscription change complètement d'habillage entre l'écran 1
   (`/register`, dans `AuthLayout` — écran scindé par profil) et l'écran 2
   (`/onboarding` ou `/nouveau-cabinet`, dans `(auth)/layout.tsx` — `SiteHeader`
   public + `AuthCard` centrée) sans qu'aucun repère n'annonce, à l'écran 1,
   qu'un second écran propre au profil suit, ni ne relie visuellement les deux.

## Solution retenue

- Corriger les quatre bugs au plus près de leur cause (variable de garde
  dédiée, `href` corrigé, garde de permission ajoutée, `try/catch` aligné sur
  le pattern déjà en place) — aucun changement de comportement au-delà de ce
  qui est demandé.
- Supprimer les deux routes dupliquées et désaligner proprement
  `PROTECTED_PREFIXES` / le matcher du proxy, après une recherche full-repo
  de toute référence restante (tests compris). Nettoyer au passage le dossier
  vide non suivi `(auth)/cabinet/register/`.
- Introduire une table de données unique (`lib/etapes-inscription.ts`, même
  esprit que `lib/espaces.ts` et `lib/auth-contexte.ts`) décrivant les deux
  écrans du tunnel par profil (marchand/cabinet) et l'aperçu de l'écran 2 à
  afficher sur l'écran 1. Un composant minimal `EtapeIndicateur` (deux
  segments + libellé mono) la consomme sur `/register`, `/onboarding` et
  `/nouveau-cabinet` — sans nouvelle dépendance, avec les tokens existants
  (`or`, `navy-950`, `navy-100`, `navy-600`, `font-mono`).
- Ne pas toucher à `RegisterForm.tsx` (nom/téléphone/mot de passe) : la
  bifurcation par profil reste après l'écran 1, comme le prescrit
  `lib/espaces.ts` (un seul type de compte).

## Alternatives écartées

- Étendre `AUTH_CONTEXTES` (lib/auth-contexte.ts) avec un champ d'étape :
  écarté — cette table alimente aussi `/login`, où un indicateur d'étape n'a
  pas de sens (un utilisateur qui se connecte n'est dans aucun tunnel). Une
  table dédiée, réservée à marchand/cabinet, évite ce couplage.
- Fusionner `/onboarding` et `/nouveau-cabinet` dans `AuthLayout` (le même
  écran scindé que `/register`) : écarté, hors périmètre demandé — le
  fondateur demande une continuité visuelle (repère d'étape), pas une refonte
  de la coquille de ces deux écrans.

## Fichiers et tâches

### 1. Bugs confirmés

- `apps/web/src/app/cabinet/mandates/page.tsx` : ajouter
  `const canAsk = canRequestMandate(practice.role)`, l'utiliser ligne 66 à la
  place de `canManage` (qui reste réservé lignes 44-59).
- `apps/web/src/app/cabinet/page.tsx` : `href="/cabinet"` →
  `href="/cabinet/organizations"` sur les deux cartes « Entreprises sans
  activité » et « Données à vérifier » (fonction `SurveillanceCabinet`).
- `apps/web/src/app/(app)/dashboard/page.tsx` : envelopper la carte
  `ActionPrioritaire titre="Créer une facture"` dans
  `{canEmit(organization.role) ? (...) : null}` — même import déjà présent.
  Vérifier que la grille `sm:grid-cols-2` reste correcte avec un seul enfant
  (déjà le cas pour `VenteComptoirForm` et le KPI de trust score sur cette
  page).
- `apps/web/src/app/(app)/dashboard/invoices/new/page.tsx` : entourer l'appel
  à `listCustomers` d'un `try/catch` sur `TrustApiError` (403), retour
  `EmptyState` — même pattern que `credits/page.tsx`.

### 2. Suppression du doublon « créer mon cabinet »

- Supprimer `apps/web/src/app/espace-cabinet/` et
  `apps/web/src/app/espace-marchand/` (routes de premier niveau — distinctes
  de `(app)/dashboard/espace-cabinet/`, qui n'est PAS concernée).
- `apps/web/src/lib/route-protection.ts` : retirer `"/espace-marchand"` et
  `"/espace-cabinet"` de `PROTECTED_PREFIXES`.
- `apps/web/src/proxy.ts` : retirer les deux entrées correspondantes du
  `matcher`, garder le commentaire d'alignement avec `route-protection.ts`.
- Recherche full-repo de `espace-cabinet` / `espace-marchand` avant
  suppression (déjà faite en amont du plan) : les seules autres occurrences
  visées concernent `(app)/dashboard/espace-cabinet/` (seuil cabinet, hors
  périmètre) et des commentaires — rien à mettre à jour côté tests au-delà de
  `route-protection.spec.ts`, qui pilote déjà ses assertions depuis
  `PROTECTED_PREFIXES` (aucune valeur codée en dur à corriger).
- Supprimer le dossier vide non suivi `apps/web/src/app/(auth)/cabinet/register/`.

### 3. Cohérence du tunnel register → onboarding/nouveau-cabinet

- Créer `apps/web/src/lib/etapes-inscription.ts` : table
  `ETAPES_INSCRIPTION: Record<"marchand" | "cabinet", { compte, structure, apercu }>`
  et fonction pure `etapeLabel(profil, etape)`.
- Créer `apps/web/src/components/auth/EtapeIndicateur.tsx` : deux segments
  (Or = en cours, Navy-950 = fait, Navy-100 = à venir) + libellé
  `Étape X sur 2 · <libellé>` en `font-mono`/`text-navy-600`.
- `apps/web/src/app/(entree)/register/page.tsx` : ajouter
  `<EtapeIndicateur profil={profil} etape="compte" />` avant le `<h1>`, et une
  ligne `<p>` sous la description existante avec `ETAPES_INSCRIPTION[profil].apercu`.
- `apps/web/src/app/(auth)/onboarding/page.tsx` : ajouter
  `<EtapeIndicateur profil="marchand" etape="structure" />` juste avant `AuthCard`.
- `apps/web/src/app/(auth)/nouveau-cabinet/page.tsx` : ajouter
  `<EtapeIndicateur profil="cabinet" etape="structure" />` juste avant `AuthCard`.
- Ne pas modifier `RegisterForm.tsx`, `OnboardingForm.tsx`, `PracticeForm.tsx`
  au-delà de la lecture nécessaire à écrire un `apercu` exact.

## Tests avant code

- `apps/web/src/lib/cabinet-nav.spec.ts` : déjà couvert (`canRequestMandate`
  vs `canRevokeMandate`) — pas de nouveau test de lib nécessaire pour le bug 1,
  seulement un changement dans la page qui consomme ces fonctions (pas de
  harnais de rendu disponible pour les Server Components de ce dépôt).
- `apps/web/src/lib/etapes-inscription.spec.ts` (nouveau, RED d'abord) :
  - les deux profils existent, `compte` est identique entre les deux (même
    formulaire) ;
  - `etapeLabel` renvoie le bon numéro et le bon libellé pour chaque
    combinaison profil/étape ;
  - guardrail anti-dérive : les champs mentionnés dans `apercu` existent
    réellement dans `OnboardingForm.tsx` (`name="legalForm"`,
    `name="regimeFiscal"`) et `PracticeForm.tsx` (`name="name"`, `name="type"`)
    — lecture de fichier, même esprit que `lib/plans.spec.ts` et les specs de
    guardrails déjà présentes.
- `apps/web/src/components/auth/EtapeIndicateur.spec.tsx` (nouveau, RED
  d'abord) : rendu via `renderToStaticMarkup` (pattern déjà utilisé par
  `AuthLayout.spec.tsx`, aucune dépendance ajoutée) — vérifie le texte
  affiché pour les quatre combinaisons profil/étape.
- `apps/web/src/lib/route-protection.spec.ts` : aucune modification requise —
  la boucle `it.each(PROTECTED_PREFIXES)` s'ajuste automatiquement une fois
  les deux préfixes retirés du tableau source.

## Critères de done

- Les quatre bugs sont corrigés sans effet de bord sur les gardes existantes
  (révocation de mandat, VenteComptoirForm, trust score restent inchangés).
- `app/espace-cabinet/` et `app/espace-marchand/` n'existent plus ; aucune
  route protégée orpheline dans `route-protection.ts` / `proxy.ts` ; le
  dossier vide `(auth)/cabinet/register/` a disparu.
- `/register` annonce explicitement l'étape 2 à venir (numéro + libellé +
  aperçu vrai) ; `/onboarding` et `/nouveau-cabinet` portent le même repère
  d'étape, cohérent avec l'écran 1.
- Aucun champ du formulaire de compte (`RegisterForm.tsx`) modifié.
- `pnpm --filter web lint`, `pnpm --filter web typecheck`,
  `pnpm --filter web test`, `pnpm --filter web build` passent tous.
- Aucun commit — working tree laissé pour relecture.

## Risques et limites

- Les changements non commités de `feat/sidebar-desktop-adr095` touchent des
  fichiers voisins (shell, layout `(app)`) ; ce plan ne les modifie pas et
  vérifie par lecture seule qu'aucune de ses tâches n'en dépend.
- `cabinet-seuil.guardrails.spec.ts` scanne tout `src/` pour des liens directs
  vers `/cabinet` ou `/dashboard` : les nouveaux fichiers (`EtapeIndicateur`,
  `etapes-inscription.ts`) n'introduisent aucun lien de ce type, à vérifier à
  l'exécution du test.
- `design-system.guardrails.spec.ts` scanne tout `src/` (dégradés, hex en dur,
  contraste, plancher `font-display`) : le nouveau composant reste sur des
  tokens existants et n'utilise pas `font-display` sous 12px.
