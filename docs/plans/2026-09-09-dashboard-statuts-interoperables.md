# Plan : Dashboard évolutif — statuts interopérables, émission au numéro, ventilation des frais, paramètres à 4 onglets

## Contexte projet

L'espace marchand (`/dashboard`) est la coquille ADR-095 : accueil, liste de
factures, détail, clients, produits, paramètres. Quatre demandes convergent
vers lui, toutes adossées à des colonnes qui EXISTENT déjà en base et que
l'interface n'a jamais lues :

1. le cycle de vie légal d'une facture (dépôt DGI, approbation acheteur,
   litige, encaissement) est réduit à l'écran à la seule colonne `status` ;
2. l'émission au comptoir exige une fiche client complète, alors que le
   commerçant n'a souvent qu'un numéro de téléphone ;
3. les frais de transaction sont présentés au payeur comme un bloc unique,
   alors que trois montants distincts sont persistés ;
4. `/dashboard/settings` est une page plate, sans succursales, sans équipe,
   sans clés API — trois modules trust-api servis sans aucune interface.

## Clarifications

**Les 4 statuts ne remplacent pas `InvoiceStatus`.** Ce sont deux AXES
distincts, et les confondre serait une régression. `status` (draft → issued →
partially_paid → paid → voided) décrit le document de commerce ; les quatre
statuts demandés décrivent son parcours LÉGAL, porté par quatre colonnes
indépendantes :

| Statut demandé | Colonne réelle | Écrite par |
|---|---|---|
| Déposée | `etax_status = transmitted` + `etax_receipt_number` | `EtaxSyncProcessor` (LFI 2025) |
| Approuvée | `validated_by_administration` | `PublicBuyerPortalService.validateLiquidation()` (J1) |
| Litige | `dispute_status = disputed` | `dispute_raised` |
| Encaissée | `status = paid` | `PaymentsService` |

Les quatre sont ORTHOGONAUX : une facture peut être déposée, approuvée ET
encaissée en même temps. Le rendu est donc une rangée de pastilles cumulables,
jamais un badge unique — un `switch` qui n'en retiendrait qu'un effacerait
l'information des trois autres.

`InvoicesService.findOne()` et `findAllByOrganization()` ne posent AUCUN
`select` de premier niveau : ces colonnes traversent déjà l'API, elles ne sont
simplement pas déclarées dans `lib/trust-api.ts`.

**« Émise/Payée » n'est pas abandonné pour autant.** `StatusPill` reste : elle
répond à « puis-je encore modifier ce document », question distincte de « où en
est-il vis-à-vis de l'administration ».

## Problème

Quatre routes manquent pour que ces écrans soient honnêtes :

- **Dédoublonnage par téléphone.** `CustomersService.create()` pose déjà un
  `pg_advisory_xact_lock(hashtext('customer:<org>:<phone>'))`, mais crée
  TOUJOURS — il marque l'existant en `possibleDuplicateOf` au lieu de le
  renvoyer. Aucun filtre `?phone=`, et `GET /customers` plafonne à 100 lignes.
  Un dédoublonnage côté web serait donc faux au 101e client.
- **`GET /branches`.** `POST /branches` et `GET /branches/:id` existent ;
  aucune liste. Un onglet Succursales pourrait créer sans jamais montrer.
- **Membres de l'organisation.** `POST /organizations/:id/members` existe, et
  `OrganizationMember.revokedAt` est au schéma — mais rien ne liste les membres
  ni ne les révoque. Le « bouton de révocation actif » demandé n'a rien à
  appeler.
- **`feePlatform` au checkout.** `PaymentProviderAttempt.fee_platform` EST
  persisté, mais `PublicCheckout` ne l'expose pas. Pire : `amountGnf` vaut
  `totalTtc + platformFee` (voir `InvoicesService.issue()`), donc la ligne
  « Montant de la facture » du checkout affiche aujourd'hui la marchandise ET
  la commission fondues. C'est exactement la mention opaque à éradiquer.

## Solution retenue

### trust-api

- **`POST /customers/resolve-by-phone`** — `{ organizationId, phone }` →
  le client existant, ou un client créé `Client +224XXXXXXXXX`. Réutilise le
  verrou consultatif et `setOrganizationScope()` de `create()` : deux caisses
  qui encaissent le même numéro à la même seconde sérialisent sur le verrou,
  la seconde lit la ligne de la première. Vraiment atomique, sous RLS.
  Ignore les lignes `anonymizedAt != null` (ADR-116 : une ligne anonymisée est
  gelée) — elle serait recréée à côté, jamais réveillée.
  `@Roles` : le trio élargi de `create()`.
- **`GET /branches?organizationId=`** — même trio que `POST /branches`,
  `organizationScopedListQuerySchema` déjà partagé.
- **`GET /organizations/:id/members`** — owner/admin, comme `findOne()`.
  Renvoie `{ id, userId, role, revokedAt, user: { name } }`. Le téléphone du
  membre n'y figure PAS : la liste sert à savoir qui a accès et à retirer cet
  accès, pas à constituer un annuaire.
- **`POST /organizations/:id/members/:memberId/revoke`** — owner/admin, avec
  deux gardes dans le service :
  - seul un `owner` peut révoquer un `owner`, un `admin` ou un `approver` —
    miroir exact de la garde d'`inviteMember()` (Security Audit finding #12) ;
  - jamais le DERNIER owner actif : une organisation sans propriétaire ne
    peut plus ni inviter, ni changer de palier, ni révoquer quoi que ce soit.

  `POST .../revoke` et non `DELETE` : convention 100 % POST du dépôt, et la
  ligne est DATÉE, jamais supprimée (contrainte unique permanente
  `(organizationId, userId)` — voir `inviteMember()`).

### money-api

- **`feePlatformGnf` dans `PublicCheckout`** — un champ, déjà en base.

### web

- **`lib/invoice-lifecycle.ts`** — logique pure : les 4 statuts dérivés des
  colonnes. Testable sans rendu, comme `nav.ts` / `kpi.ts` / `financing.ts`.
- **`lib/plans.ts`** — `ventilationFrais()` (marchandise / infrastructure /
  passerelle) et les prédicats de palier consommés par les onglets.
- **`/dashboard/settings?tab=`** — 4 onglets dans l'URL, jamais un `useState` :
  précédent `resolveCabinetTab()` (2026-09-08). Un lien s'envoie, se met en
  favori, et le bouton Retour refait le chemin inverse.
- **Émission au numéro** — champ téléphone dans le formulaire d'émission et
  bloc « vente au comptoir » sur l'accueil.

## Alternatives écartées

- **Un badge unique « le plus avancé ».** Les quatre axes sont orthogonaux :
  une facture encaissée ET contestée existe (c'est même le cas qui compte). Un
  badge unique choisirait pour le commerçant lequel des deux il ignore.
- **Dédoublonner côté web en scannant `GET /customers`.** Faux au-delà de 100
  clients, et une course entre deux caisses créerait deux fiches pour un même
  numéro. Le verrou consultatif existe déjà côté serveur — le contourner pour
  éviter d'ouvrir une route serait une régression déguisée en économie.
- **`DELETE /organizations/:id/members/:memberId`.** Aucun `@Delete()` dans le
  dépôt, et surtout : la ligne datée est ce qui permet de dire qui avait accès
  l'an dernier. Une suppression effacerait la réponse.
- **Recalculer la ventilation des frais côté web pour le payeur.** Les trois
  montants sont persistés par la tentative de paiement ; les recalculer
  afficherait ce que le barème PRÉVOIT, pas ce qui a été facturé. Sur le
  détail marchand, en revanche, aucune tentative n'existe encore : la
  projection y est affichée COMME une projection, et le dit.
- **Brancher Metabase.** Zéro occurrence dans tout le dépôt — ni URL, ni
  variable d'environnement, ni module. Un emplacement gaté Enterprise annonce
  que l'instance n'est pas raccordée ; inventer un lien serait un lien mort.
- **Gater Analytics de marge et Récurrence par un palier.** `MarginController`
  et `RecurringTemplatesController` n'imposent AUCUN palier commercial, et
  `plan-features-grid.ts` le dit noir sur blanc (« jamais récurrence […] ni
  analytics avancé »). La pastille `[Pro]` est donc posée sur des surfaces qui
  n'ont pas encore d'écran, comme une annonce — jamais présentée comme une
  barrière que le serveur appliquerait.

## Découpage

1. `trust-api` — `resolveByPhone()` + route (TDD service puis contrôleur).
2. `trust-api` — `GET /branches` (liste).
3. `trust-api` — `listMembers()` / `revokeMember()` + routes.
4. `money-api` — `feePlatformGnf` au checkout.
5. `web/lib` — `invoice-lifecycle.ts`, `plans.ts` (ventilation + prédicats),
   `trust-api.ts` (champs et clients des 4 routes), `money-api.ts`.
6. `web` — `LifecyclePills`, détail facture, liste, accueil.
7. `web` — `/dashboard/settings` à 4 onglets + Server Actions.
8. `web` — `/pay/[invoiceId]` ventilé en 3 lignes.

## Tests à écrire AVANT le code

- `customers.service.spec.ts` — resolveByPhone : renvoie l'existant sans créer ;
  crée `Client +224…` sinon ; ignore une ligne anonymisée ; pose le verrou.
- `branches.service.spec.ts` — la liste est scopée à l'organisation.
- `organizations.service.spec.ts` — listMembers ; revokeMember : garde owner,
  refus du dernier owner, refus d'un membre déjà révoqué, refus hors org.
- `payment-links.service.spec.ts` — `feePlatformGnf` remonte `fee_platform`.
- `invoice-lifecycle.spec.ts` — les 4 statuts, leur cumul, leur absence.
- `plans.spec.ts` — `ventilationFrais()` : somme exacte, plafond, cascade.

## Critères de done

- `pnpm turbo lint typecheck test` vert sur les 4 paquets.
- Aucun littéral BigInt (`0n`) dans `apps/web` — cible **ES2017**, pas ES2020.
- Aucune dépendance d'icônes ajoutée ; SVG en tracés natifs.
- Aucune migration : toutes les colonnes lues existent déjà.

## Risques

- **Le palier n'est pas dans le JWT.** Chaque onglet qui gate par palier doit
  lire `GET /organizations/:id`. Un onglet qui l'oublierait afficherait la
  grille du mauvais palier.
- **`revokeMember` touche l'autorisation** — CONTRIBUTING.md §5 impose de
  répéter les passes de revue jusqu'à un « solide » explicite.
- **La ventilation affichée doit égaler ce qui est prélevé.** `plans.spec.ts`
  confronte déjà le miroir web au grid backend ; la ventilation doit entrer
  dans ce même garde-fou, sans quoi l'écran promettrait un tarif non pratiqué.

---

## Écarts au plan (constatés à la livraison)

- **Le module d'avoir rectificatif a été construit**, alors que le découpage ne
  le listait pas. Le cahier des charges demande que le litige « ouvre le module
  d'avoir rectificatif » : `POST /invoices/:id/credit-notes` existait (C7,
  ADR-034/040) sans aucune interface. D'où `AvoirRectificatifForm`, la
  permission `invoices:credit_note` et l'action serveur. Le montant n'est jamais
  saisi — seulement des quantités par ligne, le serveur recalcule.
- **Les webhooks sortants n'ont PAS été construits** : aucun modèle, aucune
  route, aucune souscription côté trust-api (`PaymentWebhook` est le sens
  inverse — ce que la passerelle nous envoie). L'onglet D le dit au lieu
  d'afficher un champ « URL de rappel » qui n'appellerait personne.
- **La génération de clé n'est pas bloquée par le palier.** Le cahier des
  charges la réserve « aux paliers supérieurs » ; trust-api n'impose aucun
  palier à la CRÉATION (`api-keys.service.ts`) — le seuil Enterprise mord à
  l'USAGE, dans `PdpApiKeyAuthGuard`. L'onglet annonce le seuil à sa vraie
  place plutôt que d'afficher une barrière que le serveur n'applique pas.
- **Litige en AMBRE, pas en rouge, et sans clignotement.** L'ambre est le ton
  « alerte / attente » de la charte ; le rouge y est réservé à l'erreur. Cela
  évite en prime de poser un rouge contre le vert de « Déposée » dans une même
  rangée. Aucun clignotement : le garde-fou mobile du dépôt proscrit les
  animations, et un clignotement permanent est un obstacle d'accessibilité.
- **`revokeMember()` filtre `revokedAt: null` sur le DEMANDEUR**, seul écart
  assumé avec `inviteMember()` qui s'en remet au garde. RolesGuard refuse déjà
  tout membership révoqué par un 404 : c'est de la défense en profondeur sur
  une décision d'autorisation, pas la correction d'une faille.
- **Cible de compilation** : `web` vise ES2017, pas ES2020. Aucun littéral
  `0n` — `BigInt(0)` / `BigInt(10000)` partout (`plans.ts`,
  `AvoirRectificatifForm`).

## Vérification

- `web` : 294 tests verts, lint 0 erreur, `tsc` 0, `next build` réussi.
- `money-api` : 113 tests verts, lint 0 erreur.
- `trust-api` : 169 fichiers de tests verts, lint 0 erreur, `tsc` 0.
- **Un seul échec, environnemental et pré-existant** :
  `invoice-numbering.service.integration.spec.ts` exige un vrai Postgres
  (`DATABASE_URL` est défini, Docker Desktop n'est pas lancé). Aucun fichier de
  ce lot ne touche la numérotation.
