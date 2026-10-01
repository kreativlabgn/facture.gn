# ADR-126 : Chantier 4/5 — objection DAF, structure Telemo/B2G, autorité plateforme

## Statut

Approuvé — 18 septembre 2026, rédigé rétroactivement. Le code de ce chantier
(commit `c49704e` puis travaux du 18/09) existait déjà, non documenté, au
début de la session d'audit qui a produit cet ADR. Il documente fidèlement ce
qui a été construit, comble le trou de process (CONTRIBUTING.md exige un plan
daté et un ADR pour toute évolution structurante), sans réécrire l'historique.
Notes de réalisation : `docs/plans/2026-09-17-public-command-telemo-b2g.md`
(structure) et `docs/plans/2026-09-18-infrastructure-console-observability.md`
(console + autorité plateforme).

## Contexte

Trois besoins distincts sont apparus dans la même fenêtre de travail et
partagent une racine commune (le dossier B2G d'une facture) :

1. Le DAF d'une administration publique (portail `/public-buyer`, ADR-080/081/098)
   ne pouvait que VALIDER une liquidation (`validateLiquidation`, déjà
   existant) — aucun moyen de CONTESTER une facture erronée. `is_financeable`
   (K4, ADR-031/080/089) excluait déjà les factures `disputeStatus: disputed`
   du financement, mais rien ne pouvait jamais poser cette valeur : le verrou
   existait sans clé.
2. La facture porte des champs B2G (`referenceMarche`, `validatedByAdministration`,
   `disputeStatus`) depuis un chantier antérieur, mais aucune structure ne
   modélise le marché public lui-même (l'attribution Telemo, le dossier
   administratif, l'agrément du cabinet qui l'accompagne).
3. Une console d'exploitation (`/admin/infrastructure`) affichait des chiffres
   codés en dur, sans qu'aucune notion d'autorité « plateforme » (distincte
   d'un rôle organisationnel ou de l'agent terrain, ADR-045) n'existe pour la
   protéger le jour où elle deviendrait réelle.

## Décisions

### 1. `registerObjection` — deuxième transition du dossier B2G

`PublicBuyerPortalService.registerObjection(invoiceId, reason, requesterUserId)`
reprend EXACTEMENT la chaîne d'autorisation inline de `validateLiquidation`
(facture → client → `publicBuyerAccountId` → membership → compte `verified` →
lien `isPublicEntityConfirmed`) plutôt qu'une garde nouvelle : c'est la même
identité (DAF, membre d'aucune organisation PME) qui pose les deux
transitions. Dans une transaction : `Invoice.disputeStatus = "disputed"`,
`InvoiceEvent` de type `dispute_raised` (motif en `metadata`, jamais un champ
dédié — cohérent avec le WORM append-only d'`invoice_event`, ADR-015), et
`B2GCase.status = OBJECTION_GEL_LITIGE`. Idempotent comme `validateLiquidation` :
un second appel sur une facture déjà contestée ne réécrit rien, renvoie le
même message.

### 2. `B2GCase`/`TelemoAward`/`OcaecgLicense` — extension structurelle, pas de nouvel endpoint

Trois modèles ajoutés (`packages/db/prisma/schema.prisma`), migration écrite à
la main (`20260917100000_add_public_command_telemo_b2g_ocaecg`) :

- `TelemoAward` — l'attribution de marché public source (identifiants Telemo,
  NIF fournisseur, montant, statut de synchronisation).
- `B2GCase` — le dossier administratif qui relie une `Invoice` (`invoiceId`
  `@unique`, nullable) à son `TelemoAward` et à l'`Organization` fournisseur,
  avec son propre statut (`B2GCaseStatus` : `BROUILLON` → `TRANSMIS` →
  `SERVICE_FAIT_VALIDE`/`CREANCE_CERTIFIEE`/`OBJECTION_GEL_LITIGE` → `PAYEE`).
- `OcaecgLicense` — agrément de l'Ordre pour un cabinet comptable
  (`cabinetId` `@unique` sur `Organization`), distinct de
  `Practice.ordreVerified` (affiché côté cabinet) : celui-ci concerne
  l'organisation PME elle-même, pas le cabinet qui la suit.

Assumé dès le cadrage (`docs/plans/2026-09-17-public-command-telemo-b2g.md`) :
aucun endpoint métier pour créer/faire progresser un `B2GCase` n'existe encore
— seule la transition `OBJECTION_GEL_LITIGE` (décision 1 ci-dessus) écrit
dessus. Le reste du cycle de vie (`TRANSMIS`, `SERVICE_FAIT_VALIDE`,
`CREANCE_CERTIFIEE`, `PAYEE`) reste hors périmètre.

### 3. `isPlatformAdmin` — autorité plateforme, un quatrième axe distinct

Ni un rôle organisationnel (`OrganizationRole`), ni `isCommercialAgent`
(ADR-045, agent terrain M2M), ni `PracticeRole` (cabinet) : `User.isPlatformAdmin`
(défaut `false`) est un axe d'autorité séparé, pour un opérateur interne
facture.gn qui n'appartient à aucune organisation PME ni cabinet.
`PlatformAdminGuard` (`apps/trust-api/src/common/platform-admin.guard.ts`)
relit ce champ EN BASE à chaque requête — jamais porté dans le JWT — même
discipline que `isCommercialAgent` (`CommercialAgentAuthGuard`) : un accès
révoqué en base doit être immédiatement sans effet, pas seulement à la
prochaine connexion.

### 4. Console infrastructure — snapshot réel, mais pas encore branché à l'écran

`InfrastructureModule`/`InfrastructureController` (`GET /platform/infrastructure`,
gardé par `PlatformAdminGuard`) expose un instantané en lecture seule des 6
files BullMQ déjà possédées par leurs modules respectifs (`ai`, `etax`, `pdp`,
`retention`, `merkle-anchor`) — `BullModule.registerQueue()` par nom depuis un
module tiers est le même pattern déjà utilisé partout dans ce dépôt pour une
file partagée, aucune file supplémentaire n'est créée dans Redis. Le service
ne renvoie que des compteurs et un statut dérivé (`healthy`/`warning`/
`critical`/`unknown`) — jamais un payload de job, un identifiant, ou le texte
brut Prometheus, conformément à la garde de sécurité du plan.

Le module est enregistré dans `AppModule` et vérifié en conditions réelles :
`GET /platform/infrastructure` sans jeton → 401 ; avec `PlatformAdminGuard`
qui rejette un utilisateur non-admin → 403. Page web `/admin/infrastructure`
: **toujours des données de démonstration**, mais désormais annoncées comme
telles (bandeau explicite) — le branchement au snapshot réel reste à faire.

## Ce qui reste hors périmètre de ce chantier

- Aucun endpoint pour créer/faire progresser un `B2GCase` en dehors de
  l'objection (décision 2).
- `/admin/infrastructure` (web) n'appelle pas encore `GET /platform/infrastructure` —
  toujours la maquette, honnêtement étiquetée.
- Aucune page `/admin/*` ne connaît `isPlatformAdmin` côté web : `proxy.ts`
  n'exige qu'une session active. Les actions sensibles restent gardées côté
  trust-api (`PlatformAdminGuard`, `isCommercialAgent`,
  `PublicBuyerAccountMember`), mais un marchand ordinaire peut toujours
  ouvrir ces écrans et se voir répondre un refus plutôt que ne jamais les
  voir.
- `admin/field-officer` : le consentement du marchand enrôlé est désormais
  attesté explicitement (correctif du 17/09), mais reste une attestation
  déclarative de l'agent, jamais vérifiée indépendamment.

## Tests

- `PublicBuyerPortalService.registerObjection` : 8 tests
  (`public-buyer-portal.service.spec.ts`) — même gamme que
  `validateLiquidation` (invoiceId inconnu, IDOR, non-B2G, compte non vérifié,
  lien non confirmé, dossier B2G absent, transition nominale, idempotence).
- `admin/b2g/actions.ts` : 7 tests (`actions.spec.ts`) — validation locale,
  `revalidatePath`, relais du message trust-api sans reformulation.
- `PlatformAdminGuard` : 4 tests (`platform-admin.guard.spec.ts`) — absent,
  refusé, autorisé, relecture en base (pas de confiance au JWT).
- `app.module.spec.ts` : le graphe DI se résout avec `InfrastructureModule`
  enregistré.

## Alternatives écartées

- **Réutiliser `isCommercialAgent` pour l'autorité plateforme** — écarté :
  sémantiquement distinct (un agent terrain agit AU NOM d'un marchand
  consentant ; un administrateur plateforme agit sur l'infrastructure
  elle-même, sans marchand impliqué). Les confondre aurait donné à un agent
  terrain un accès qu'il n'a jamais demandé.
- **Exposer les compteurs BullMQ bruts (`getJobCounts` tel quel)** — écarté :
  la signature BullMQ v6 rend `{ [index: string]: number }` sans garantie de
  forme ; reconstruit clé par clé dans `InfrastructureService.readQueue()`
  plutôt que fait confiance à l'assignabilité structurelle (corrigé le 17/09,
  la version initiale ne compilait pas).

## Amendement du 1er octobre 2026 — RLS des tables B2G et points ouverts de revue

Relecture de la Phase 4 & 5 avant fusion (PR #28). Deux ensembles, de nature différente.

### Corrigé : les trois tables de la décision 2 n'étaient pas dans le registre RLS

`b2g_case` et `telemo_award` (`organization_id`) et `ocaecg_license` (`cabinet_id`) avaient été
créées par `20260917100000` sans `ROW LEVEL SECURITY`, contrairement à `ocr_document` et à
toutes les autres tables de tenant. Aucune exception n'était prévue par cet ADR ni par le
runbook. Migration `20261001090000_rls_b2g_ocaecg_tables` : `ENABLE` + `FORCE`, politique
`org_isolation` (prédicat dormant inchangé), sans modification de code applicatif — le seul
appelant, `registerObjection`, pose déjà `setOrganizationScope` avant d'accéder à `b2g_case`.
Plan : `docs/plans/2026-10-01-rls-tables-b2g.md`. Un test d'exhaustivité
(`rls-registry.integration.spec.ts`) interdit désormais ce type d'oubli. Sémantique de
`ocaecg_license` (donnée de tenant ou registre de référence) : isolation retenue par prudence,
à confirmer avec le produit si un parcours de vérification d'agrément est construit.

### Ouvert : à trancher, non corrigé par cet amendement

1. **Idempotence de `registerObjection`.** `invoice.disputeStatus` est lu avant la
   transaction : deux appels simultanés peuvent chacun voir « non contesté » et créer deux
   événements `dispute_raised`. Relire la facture dans la transaction, ou conditionner
   l'`update` à `disputeStatus != disputed`.
2. **État du dossier avant gel.** Aucun contrôle de l'état de `B2GCase` (ni de la facture) :
   un dossier `PAYEE` ou `CREANCE_CERTIFIEE` (créance éventuellement déjà financée) peut passer
   en `OBJECTION_GEL_LITIGE`. Définir les transitions autorisées.
3. **Levée d'une objection.** Aucun chemin n'existe (déjà listé hors périmètre) : le gel est
   définitif. À arbitrer avant toute exposition à de vrais DAF — qui peut lever, avec quelle
   preuve.
4. **Borne du motif.** La longueur maximale de `reason` (stocké dans `metadata`) est à
   vérifier au niveau du DTO.
5. **Lien inter-tenant par clé étrangère (hors de portée de la RLS).** Mesuré sur Postgres 16
   sous `facture_app` : une session scopée sur l'organisation A, qui ne voit pas l'attribution
   de B (0 ligne), peut créer un `b2g_case` de A qui référence `telemo_award.id` de B — le
   contrôle de clé étrangère s'exécute hors RLS. Conséquence : intégrité inter-tenant non
   garantie, et l'erreur de clé étrangère (« absent ») contre le succès (« existe ») forme un
   oracle d'existence pour qui connaît un UUID. Exploitabilité faible (identifiants non
   devinables, aucun endpoint de création de `B2GCase` aujourd'hui) mais à fermer avant d'en
   exposer un : vérification applicative que l'attribution appartient à la même organisation,
   ou contrainte composite `(telemo_award_id, organization_id)` (compliquée par le caractère
   nullable de `telemo_award.organization_id`).

### Limite à garder en tête

Le prédicat de la politique est **dormant sans scope** (constaté, voir la précision ajoutée à
`docs/runbooks/rls-rollout.md`) : la RLS protège une session scopée contre un mauvais scope ou
un filtre applicatif oublié, pas contre une requête qui ne pose aucun scope. Le filtre
`organizationId` applicatif reste obligatoire.
