# Plan : Portail Cabinet — étanchéité des personas et console à onglets (ADR-068 / ADR-071 / ADR-078)

## Contexte projet

L'espace cabinet (`/cabinet`) existe depuis le Chantier C. Le seuil d'ENTRÉE
depuis l'espace marchand a été posé le 2026-09-08 (`/dashboard/espace-cabinet`,
`cabinet-seuil.guardrails.spec.ts`). Trois choses restaient ouvertes :

1. la SORTIE du cabinet était toujours un lien direct vers `/dashboard` ;
2. `GET /practices/:id/revenue-share` et `.../partner-subscription/:periodMonth`
   existaient depuis H3/H4 (ADR-071) sans qu'aucun écran ne les lise — un
   partenaire ne pouvait pas connaître sa commission d'apporteur ;
3. la barre latérale, le tiroir mobile et le contenu du rail vivaient dans un
   seul fichier de 250 lignes.

## Problème

**Étanchéité des personas.** Un même compte peut être propriétaire de son
commerce ET collaborateur d'un cabinet — c'est le cas courant du comptable qui
tient aussi son commerce, avec le même numéro de téléphone. L'entrée était
tenue par un seuil explicite ; la sortie ne l'était pas. Une porte à sens unique
n'étanche rien : `CabinetShell` portait « Retour à mon commerce », et l'écran
« Aucun cabinet » un bouton vers `/dashboard`. Deux entités juridiques, deux
comptabilités, deux obligations fiscales — on ne bascule pas de l'une à l'autre
en visant mal un lien.

**Chiffres absents.** Le partage d'honoraires est l'argument de l'offre
partenaire. Il était calculé, plafonné, stocké et exposé, et invisible.

## Solution retenue

- **Sortie = fermeture de session.** Le cookie est détruit, on repasse par le
  hub d'aiguillage. Un geste de plus, assumé.
- **`CabinetSidebar.tsx`** extrait de `CabinetShell` : le rail sombre, l'identité
  du cabinet, les pastilles de rôle, le badge de l'Ordre (lu en base, jamais
  posé en dur), le sélecteur d'espace actif, et le seul formulaire de
  déconnexion.
- **Burger + seuil `md`.** Rail permanent ≥ 768px ; en dessous, un `<details>`
  natif derrière un burger qui porte le titre de l'écran courant. Le `<details>`
  se déplie sans JavaScript ; un effet sur `pathname` le referme quand JS est là.
- **Console à onglets `/cabinet?tab=`** — `portefeuille` (défaut) et `structure`.
  L'onglet vit dans l'URL : sans JavaScript un `useState` ne s'ouvre pas, un lien
  s'envoie et se met en favori, et le bouton Retour refait le chemin inverse.
- **Partage d'honoraires** lu par `chargerPartageHonoraires()` : crédits de la
  période, reste à reverser toutes périodes, reste dû de l'abonnement.

## Alternatives écartées

- **Garder « Retour à mon commerce » derrière une confirmation.** Une boîte de
  dialogue exige du JavaScript, et un dialogue qu'on lit trois fois cesse d'être
  lu. Le coût d'une reconnexion est le signal.
- **Onglets en état React.** Cassent le lien partageable, le bouton Retour, et
  ne fonctionnent pas sans JavaScript — trois régressions pour zéro gain.
- **Recalculer un solde exact par client.** Il faudrait ouvrir chaque facture
  pour lire ses paiements : une requête par facture ET par client, sur un écran
  qui en fait déjà une par client. L'encours est présenté comme un MAJORANT
  (une facture partiellement réglée y pèse entière) et l'écran le dit.
- **`DELETE /practices/members/:id`.** N'existe pas : le départ d'un
  collaborateur est un `POST .../revoke` qui DATE la ligne au lieu de la
  supprimer — un cabinet doit pouvoir dire qui suivait tel dossier l'an dernier.
  L'action web (`revokeMemberAction`) est réutilisée telle quelle.

## Découpage

1. `CabinetSidebar.tsx` — extraction, suppression de la sortie latérale.
2. `CabinetShell.tsx` — burger, seuil `md`, fermeture du tiroir à la navigation.
3. `cabinet/layout.tsx` — plus de lecture des organisations marchandes ;
   l'écran « Aucun cabinet » sort par `logoutAction`.
4. `cabinet-icons.tsx` — `ExitIcon` retirée avec le lien qu'elle portait.
5. `lib/cabinet-nav.ts` — `CABINET_TABS` + `resolveCabinetTab()`.
6. `lib/trust-api.ts` — `listPracticeRevenueShare()`,
   `getPartnerSubscriptionStatus()`.
7. `lib/cabinet.ts` — `moisCourant()`, `chargerPartageHonoraires()`,
   `encaisse`/`encours` par client.
8. `cabinet/page.tsx` — console à deux onglets.

## Tests

- `cabinet-seuil.guardrails.spec.ts` — aucune destination `/dashboard`
  (`href=` comme `redirect(`) depuis l'espace cabinet ; la barre offre bien
  `logoutAction` ; l'écran « Aucun cabinet » n'est pas une impasse.
- `cabinet-nav.spec.ts` — `resolveCabinetTab` : valeurs connues, repli sur toute
  valeur inconnue, `?tab=a&tab=b`, clés d'URL figées.
- `cabinet.spec.ts` — `moisCourant` en UTC ; `encaisse`/`encours` et le
  `partially_paid` compté entier ; addition BigInt au-delà de 2^53 ; un client
  illisible marqué `indisponible` et jamais à zéro ; partage d'honoraires filtré
  par période, `pending` toutes périodes, palier sur devis distingué d'un solde
  nul, et échec partiel qui ne supprime pas les crédits.

## Critères de done

- `lint` 0, `typecheck` 0, `test` vert, `build` vert.
- `design-system.guardrails` vert : aucun hex en dur, aucun dégradé, aucun texte
  clair sur l'Or, aucun `text-navy-*` sous le seuil AA.
- Aucun littéral BigInt (`0n`) — la cible de `web` est ES2017.
- Vérifié contre l'API qui tourne, pas seulement en test :
  - NIF en doublon sous `FORCE ROW LEVEL SECURITY` → **409**, jamais 500 ;
  - double affectation de mandat → **409** ;
  - retrait d'un collaborateur → `/organizations/:id/invoices`, `/customers`,
    `/fec`, `/practices/:id/organizations`, `/revenue-share`, `/members` passent
    tous de **200 à 403** avec le MÊME jeton non expiré, sans reconnexion.

## Reste ouvert

- **« Facturation Service » (ADR-078) — pas de backend.** Un cabinet ne peut pas
  émettre ses propres factures d'honoraires : `ProfessionalPractice` n'a ni
  relation `Invoice`, ni `Organization`, ni champ `nif` (schema.prisma), et
  `POST /invoices` est scopé par `@CurrentOrganizationId`. Une facture
  transmissible au guichet e-TVA exige le NIF de l'émetteur (LFI 2025). Ce n'est
  pas un câblage manquant, c'est un domaine à modéliser — modèle Prisma,
  migration écrite à la main, politique RLS, chaînage de certification, décision
  produit sur l'assujettissement du cabinet.
- **Course sur la double affectation de mandat.** Le 409 vient d'une garde
  applicative (`assertNoActiveMandate`), pas d'un index unique : deux requêtes
  concurrentes peuvent encore créer deux mandats actifs. Un index unique partiel
  sur `(practice_id, organization_id) WHERE status IN ('pending','active')`
  fermerait la fenêtre — migration à écrire à la main.
