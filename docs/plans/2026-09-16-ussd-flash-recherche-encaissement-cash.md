# Plan : *620# — Interception flash, recherche composite téléphone+montant, encaissement cash

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn

- Module : Trust Context, `apps/trust-api/src/ussd/`. Canal `@Public()` (`ussd.controller.ts`) —
  aucun JWT, aucun `RolesGuard`/`@Roles()` (CONTRIBUTING.md §RBAC : toute autorisation reconstruite
  en ligne dans le service).
- Trois capacités produit déjà tranchées par product-manager, livrées ensemble (même module, même
  fenêtre de risque RBAC) :
  1. **Interception flash suggestive** — post-authentification PIN, propose la facture
     `issued`/`partially_paid` émise il y a < 30 min pour le `Customer` dont le téléphone
     correspond au MSISDN appelant.
  2. **Recherche composite téléphone + montant** avec dédoublonnage même-jour.
  3. **Encaissement cash** depuis l'historique (option 3) ou la recherche, via
     `PaymentsService.recordCashPayment()` — jamais l'apurement Z de caisse ADR-119 (hors sujet).
- Persona affectée : côté capacité 1, le CLIENT (payeur, pas nécessairement membre d'une
  organisation) ; côté capacités 2/3, le MARCHAND authentifié (owner/admin/cashier pour l'action
  d'encaissement).

## Investigation préalable

Fichiers lus intégralement avant cette décision : `ussd-session.service.ts` (state machine,
`SessionContext`, `tryClaimProcessingState`, `ROOT_MENU`), `ussd-invoice-list.service.ts`
(`listRecent`, `MAX_RESULTS`), `ussd-payment.service.ts` (`findPayableInvoice`, `previewFee`,
`confirmPayment`), `ussd-invoice.service.ts` (`EMIT_ELIGIBLE_ROLES`, `resolveOrganizationForEmission`),
`ussd-auth.service.ts` (`resolveByPhone`, non scopé à dessein), `payments.service.ts`
(`recordCashPayment`, `createPaymentAndApply`, `applyPaymentToInvoice`, `assertCashProofRequirement`,
`getPayableInvoiceOrThrow`), `cash-proof-requirement.ts`, `create-payment.dto.ts`
(`CASH_PROOF_THRESHOLD_GNF_CENTIMES = 100_000_000n` centimes = 1 000 000 GNF),
`invoices.service.ts:872-942` (`regeneratePaymentLink`), `client-portal.service.ts`
(`listOrganizations`, précédent de requête cross-organisation volontaire), `packages/db/src/rls.ts`
(`organizationScopedClient`/`setOrganizationScope`), `packages/db/prisma/schema.prisma` (`Customer`
l.1089, `Invoice` l.1206, `Payment` l.1459, `InvoiceEvent` l.1657, `UssdSession` l.1968,
`OrganizationRole` l.405, `EmissionChannel` l.208), migration `20260908010000_etax_invoice_transmission`
(gabarit de migration à main levée réutilisé pour la forme).

Constats clés qui conditionnent la conception :

- **`Customer.phone` porte `@@index([phone])` mais délibérément PAS scopé par organisation**
  (commentaire schema.prisma l.1136-1141, précédent unique : `ClientPortalService.listOrganizations()`,
  F13). C'est le SEUL autre endroit du repo qui interroge `Customer` par téléphone à travers toutes
  les organisations — la capacité 1 (flash) en devient le deuxième, et pour la même raison légitime
  (c'est le CLIENT qui s'authentifie, pas le marchand).
- **`Invoice` n'a aujourd'hui AUCUN index sur `customerId`** ni sur `(organizationId, totalTtc)` —
  deux migrations d'index sont donc nécessaires (détail plus bas), pas juste un champ.
- **`InvoiceEvent.actorId` est un FK nullable vers `User`, sans aucune contrainte d'appartenance à
  l'organisation** (`actor User? @relation(fields: [actorId], references: [id])`, schema.prisma
  l.1657-1670). `InvoicesService.regeneratePaymentLink()` (l.872-942) ne vérifie JAMAIS que `actorId`
  est membre de `organizationId` — il scope uniquement la LECTURE/ÉCRITURE de la facture par
  `organizationId`, et `actorId` ne sert qu'à peupler cette FK pour la trace d'audit. **Conclusion
  point 2 : un `actorId` client (User authentifié par PIN mais non-membre de l'organisation
  émettrice) fonctionne sans erreur** — la seule exigence est que `actorId` référence un `User.id`
  existant, garanti ici puisque `ussdAuth.resolveByPhone()` n'authentifie que des `User` réels.
  Conséquence secondaire à signaler à security-engineer : le journal d'audit de l'organisation
  affichera désormais, pour l'événement `payment_link_regenerated`, un `actorId` qui n'a jamais été
  membre — comportement correct et voulu (c'est authentiquement le client), mais nouveau.
- **`tryClaimProcessingState()` code en dur `"emit_processing"` comme état de destination** (l.1066-1076)
  — générique dans `expectedState`, pas dans l'état cible. Pour réutiliser cette garde côté
  encaissement cash sans laisser une session d'encaissement transiter par un état littéralement
  nommé « émission », son signature doit être élargie d'un paramètre `processingState: UssdState`.
- **`handlePayConfirmation` (l.744-759) n'appelle PAS `tryClaimProcessingState()`**, contrairement à
  `completeAuthentication`/branche `anon_emit`, `handleEmitCustomerPhone`,
  `handlePublicOrderReference`. C'est un trou de garde préexistant, HORS SCOPE de ce plan (point 7
  du cadrage) — noté en Risques, jamais corrigé ici. La capacité 1 (« Voir et payer ») réutilise ce
  même mécanisme tel quel et hérite donc de ce trou préexistant, sans l'aggraver (elle n'introduit
  aucune nouvelle voie de rejeu, juste un nouveau point d'ENTRÉE vers un mécanisme déjà en l'état).

## Décision d'architecture

### 1 — Persistance du « flash déjà vu » sur 30 min (TTL `UssdSession` = 3 min)

**Décision : `Invoice.flashSuggestedAt DateTime?` nullable, jamais réinitialisé.** Pas de nouvelle
table, pas de champ sur `User`/`UserPhone`/`Customer`.

Justification : la fenêtre d'éligibilité de la capacité 1 est déjà bornée par
`issuedAt >= now - 30min` — c'est CETTE borne, déjà nécessaire pour le critère fonctionnel principal,
qui produit gratuitement l'expiration de l'anti-répétition. Une fois la facture hors de la fenêtre de
30 min, elle cesse d'être candidate de toute façon ; `flashSuggestedAt` n'a donc besoin d'aucune
purge, aucun TTL, aucun index d'expiration séparé — contrairement à `UssdSession.expiresAt` (purgé
par `RetentionService`, J3). Un flag par CLIENT (sur `Customer`/`User`) aurait été plus grossier et
FAUX : un deuxième client-appel 5 min après le premier, alors qu'une DEUXIÈME facture, différente,
vient d'être émise entre-temps, doit voir la NOUVELLE facture — un cooldown au niveau client
supprimerait à tort cette suggestion légitime. Une nouvelle table aurait dupliqué ce que la ligne
`Invoice` porte déjà nativement (son propre horodatage de suggestion), pour un bénéfice nul, avec en
plus un index et une cible de purge en plus dans `RetentionService`.

### 2 — `regeneratePaymentLink(invoiceId, actorId, organizationId)` avec un `actorId` non-membre

**Confirmé sans risque, aucune modification requise à `InvoicesService`.** Voir constat ci-dessus
(Investigation préalable). Le seul champ affecté par `actorId` est `InvoiceEvent.actorId`
(FK nullable vers `User`, sans contrainte de membership) : `tx.invoiceEvent.create({ data: {
invoiceId, type: "payment_link_regenerated", actorId } })` (l.936-938). `actorId` provient de
`session.userId`, lui-même peuplé depuis `context.authUserId` — un `User.id` réel dès lors que
`UssdAuthService.resolveByPhone()`/PIN a réussi. La capacité 1 réutilise `UssdPaymentService.
confirmPayment(invoiceId, actorId, organizationId)` tel quel, sans aucune modification.

### 3 — Requête Prisma recherche composite téléphone + montant + jour, index, et non-fuite cross-org

**`where` exact** (nouveau service `UssdInvoiceSearchService`, détail fichier plus bas) :

```ts
const startOfDayUtc = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));   // Guinée = UTC+0 à l'année, pas de TZ à gérer
const startOfNextDayUtc = new Date(startOfDayUtc.getTime() + 86_400_000);

organizationScopedClient(prisma, organizationId).invoice.findMany({
  where: {
    organizationId,                                   // scope explicite, jamais implicite (RLS dort encore)
    documentType: "invoice",                           // jamais proforma/quote — même discipline que listRecent()
    status: { in: ["issued", "partially_paid"] },
    totalTtc: amountTtcCentimes,                        // décision PM : totalTtc, pas amountDue
    issuedAt: { gte: startOfDayUtc, lt: startOfNextDayUtc },
    customer: { phone },
  },
  orderBy: { issuedAt: "desc" },
  take: MAX_RESULTS,                                    // réutilise la constante exportée par ussd-invoice-list.service.ts (5)
});
```

**Non-fuite cross-org, par construction** : la requête part de `Invoice` (pas de `Customer`), et
`organizationId` est posé au niveau racine du `where` sur `Invoice` lui-même — la clause imbriquée
`customer: { phone }` ne fait que restreindre PARMI les factures déjà scopées à cette organisation ;
elle ne peut jamais élargir le résultat à une autre organisation, quel que soit le nombre
d'organisations où ce même numéro de téléphone est client ailleurs sur la plateforme. C'est la
différence structurelle avec `ClientPortalService`/F13 (point de départ = `Customer`, cross-org
voulu) : ici le point de départ est `Invoice`, déjà scopé — la présence de l'index plateforme-wide
`Customer.phone` ne change rien à cette garantie, il accélère juste le JOIN, il ne l'élargit pas.

**Index requis — OUI, un seul nouveau, à ajouter à `Invoice`** :

```prisma
@@index([organizationId, totalTtc, issuedAt])
```

Ordre des colonnes délibéré : égalités (`organizationId`, `totalTtc`) en tête, plage
(`issuedAt`) en dernier — permet à Postgres un scan d'index resserré directement sur le couple
recherché, puis une borne de journée bornée, sans scan séquentiel de la table `invoice`. `status`
n'est volontairement PAS dans l'index (2 valeurs sur 7 possibles, faible sélectivité ajoutée, filtré
en post-scan sur un jeu de lignes déjà minuscule après les trois colonnes précédentes) — cohérent
avec la discipline « index minimal, pas *au cas où* » déjà pratiquée dans ce repo (voir charte
typographique équivalente sur les poids de police, même philosophie appliquée ici aux index).

### 4 — Schéma exact du « canal de collecte » sur `Payment`

**Décision : réutiliser l'enum `EmissionChannel` existant** (`pwa | ussd | agent_terrain | api`),
pas un nouvel enum.

```prisma
model Payment {
  ...
  method            PaymentMethod @default(cash)
  // Canal d'origine de LA COLLECTE (à distinguer d'Invoice.emissionChannel, qui parle de
  // l'ÉMISSION de la facture, pas de son règlement). NULL = inconnu/legacy : tout paiement
  // enregistré avant ce champ, quel que soit son canal réel — jamais migré rétroactivement vers
  // "pwa" (même discipline qu'Invoice.signingKeyId : un système de confiance ne réécrit jamais un
  // fait qu'il n'a pas observé). Seul recordCashPayment() le peuple aujourd'hui, via un PARAMÈTRE
  // dédié (jamais dans CreatePaymentDto) — même précédent qu'InvoicesService.createDraft(dto, channel).
  collectionChannel EmissionChannel? @map("collection_channel")
  ...
}
```

Le doute soulevé par le cadrage PM sur `api` (« n'a pas de sens pour une collection ») ne résiste pas
à l'examen : un intégrateur `developer_api` (rôle déjà dans `OrganizationRole`) appelant
`POST /invoices/:id/payments` pour enregistrer un encaissement cash depuis SON propre point de vente
est un cas réel où `collectionChannel = "api"` serait exact. `agent_terrain` est de même
plausible (agent qui encaisse en tournée). Créer un second enum à 4 valeurs quasi identiques pour
zéro bénéfice présent serait la seule vraie sur-ingénierie ici — `PreferredLanguage` est déjà réutilisé
tel quel entre `User` et `Organization` dans ce schéma, précédent direct de réutilisation d'enum
inter-modèles quand le concept est réellement partagé.

**Non-nullable/pas de défaut, contrairement à `emissionChannel`** : le cadrage est explicite
(« même discipline que `signingKeyId` ») — `emissionChannel` a un défaut `pwa` car c'est un fait
correct pour tout l'historique (canal primaire avant l'introduction du champ). Rien de tel n'est vrai
pour `collectionChannel` : on ne sait PAS par quel canal un paiement existant a été perçu (guichet,
téléphone au marchand, etc.) — inventer `"pwa"` par défaut mentirait. D'où : nullable, sans défaut.

**Seul `PaymentsService.recordCashPayment()` reçoit le nouveau paramètre** dans ce lot (pas
`recordProviderPayment`/`recordBankTransferPayment`/`recordDepositPayment` — aucun appelant USSD
pour ces chemins ici, YAGNI) :

```ts
async recordCashPayment(
  invoiceId: string,
  organizationId: string,
  dto: CreatePaymentDto,
  idempotencyKey: string,
  collectionChannel: EmissionChannel = "pwa",   // défaut = comportement HTTP actuel inchangé
) { ... createPaymentAndApply(..., { ..., method: "cash", collectionChannel, ... }) }
```

`collectionChannel` par défaut `"pwa"` au niveau du PARAMÈTRE (pas de la colonne DB) : les appelants
HTTP existants (staff dans le dashboard, ou intégration API future) n'ont rien à changer, et le
comportement observable pour eux reste inchangé — **mais la colonne, elle, reste NULL par défaut**
tant que personne ne fournit explicitement `"pwa"` ; c'est un choix cohérent avec le fait que
`PaymentsController` (HTTP) n'a, dans ce lot, aucune raison de changer sa propre signature d'appel —
seul `UssdCashCollectionService` fournira explicitement `"ussd"`. (Si backend-developer préfère, par
souci de netteté, que le paramètre n'ait PAS de valeur par défaut et que CHAQUE appelant soit
explicite — HTTP passant `"pwa"` explicitement —, c'est un détail d'implémentation mineur et
acceptable ; à trancher en revue, sans impact sur le schéma.)

### 5 — Idempotence + garde atomique de l'encaissement cash USSD

Deux mécanismes complémentaires, pas redondants :

- **Garde de concurrence (transitoire, même session)** : `tryClaimProcessingState()`
  (`ussd-session.service.ts` l.1066-1076), élargie d'un paramètre `processingState: UssdState`
  (aujourd'hui codé en dur `"emit_processing"`). Nouvel appel :
  `tryClaimProcessingState(session.id, "cash_collect_confirm", "cash_collect_processing", context)`.
  Protège contre un rejeu réseau agrégateur qui republierait le MÊME input de confirmation pendant
  que le premier est encore en vol — exactement la même menace, le même mécanisme, que les 3 flux
  d'émission déjà protégés.
- **Idempotence applicative (identité, traverse un éventuel reset de session)** :
  `idempotencyKey = \`ussd-cash:${session.sessionId}\`` (le `sessionId` opérateur, pas l'`id` UUID de
  la ligne `UssdSession`). Déterministe pour la DURÉE DE VIE d'une session USSD donnée ; une NOUVELLE
  session (nouveau dial-in, nouveau `sessionId` attribué par l'agrégateur) produit une nouvelle clé —
  ce qui est le comportement VOULU : un marchand doit pouvoir encaisser un DEUXIÈME acompte cash sur
  la même facture `partially_paid`, dans une session USSD ultérieure distincte, sans être bloqué par
  l'idempotence de la première session.

Articulation : la garde d'état protège la CONCURRENCE (deux requêtes simultanées sur le même
`sessionId`) ; `idempotencyKey` protège la RÉ-ENTRÉE (n'importe quelle cause qui ferait rappeler
`recordCashPayment()` une deuxième fois pour ce même `sessionId`, y compris un futur bug). Aucun trou
: la garde d'état empêche déjà `recordCashPayment()` d'être appelé deux fois pour ce sessionId dans
le cas normal ; `idempotencyKey` est le filet si cette garde était un jour contournée ou modifiée sans
que ce plan-ci ait anticipé le nouveau chemin. Aucune redondance dangereuse : les deux mécanismes
protègent des scénarios différents (l'un une race, l'autre une identité), leur combinaison ne peut
jamais à elle seule PERMETTRE un double encaissement qu'un seul des deux aurait empêché seul.

### 6 — Nommage des nouveaux `UssdState` et structure de `SessionContext`

Nouveaux états (ajoutés à l'union `UssdState`, jamais de littéral non typé — même discipline que
Quality Audit 2026-08-23 finding #10 déjà documentée dans ce fichier) :

```ts
| "flash_intercept"          // Capacité 1 — écran "Facture récente trouvée", 1=voir et payer / 2=menu principal
| "invoice_history_menu"     // Capacité 2/3 — ex-renderMyInvoices, devient interactif : liste + option recherche
| "search_awaiting_phone"    // Capacité 2 — saisie téléphone
| "search_awaiting_amount"   // Capacité 2 — saisie montant, déclenche la recherche composite
| "search_result_select"     // Capacité 2 — écran de choix si > 1 résultat même jour
| "cash_collect_confirm"     // Capacité 3 — détail facture + "Encaisser en CASH ? (1=Oui)"
| "cash_collect_processing"  // Capacité 3 — pendant du "emit_processing" existant (garde tryClaimProcessingState)
| "cash_collect_terminal"    // Capacité 3 — pendant du "emit_terminal" existant (message figé anti-rejeu)
```

Nouveaux champs `SessionContext` (tous optionnels, même style que l'existant) :

```ts
// Capacité 1
flashInvoiceId?: string;
flashInvoiceNumber?: string;
flashOrganizationId?: string;

// Capacité 2
historyOptions?: { id: string; number: string }[];        // option 3 : liste affichée, index -> facture
searchPhone?: string;
searchResultOptions?: { id: string; number: string }[];   // écran de désambiguïsation

// Capacité 3
cashCollectInvoiceId?: string;
cashCollectInvoiceNumber?: string;
cashCollectOrganizationId?: string;
cashCollectTerminalMessage?: string;
```

Aucun montant n'est stashé dans le contexte pour la confirmation d'encaissement
(`cashCollectAmountDue` volontairement absent) : le montant affiché à `cash_collect_confirm` ET le
montant réellement collecté sont TOUS LES DEUX relus à chaud (`amountDue` frais) au moment de
`UssdCashCollectionService.collect()` — jamais une valeur mémorisée à l'étape de sélection, qui
pourrait être devenue périmée entre-temps (un autre règlement concurrent a pu réduire `amountDue`).
Même discipline que `regeneratePaymentLink()`, qui revérifie toujours l'état de la facture avant
d'agir plutôt que de faire confiance à une lecture antérieure.

`completeAuthentication` change de signature : `(session: UssdSessionRow, context, currentState)` au
lieu de `(sessionId: string, context, currentState)` — nécessaire pour lire `session.phone` (requis
par la capacité 1). Les deux call sites (`handlePinEntry`, `handleNewPinConfirm`) ont déjà `session`
en scope ; changement mécanique, sans effet de bord.

### 7 — `handlePayConfirmation` sans `tryClaimProcessingState()` — risque préexistant, non corrigé

Confirmé par lecture (l.744-759) : aucun appel à `tryClaimProcessingState()`, contrairement aux 3
flux d'émission. La capacité 1 (« Voir et payer ») route vers `pay_awaiting_confirmation`, donc
hérite de ce trou tel quel. Pas de correction dans ce lot (hors périmètre explicite du cadrage) —
reporté en Risques ci-dessous, à traiter par une story dédiée distincte.

## Alternatives écartées

- **Nouvelle table `UssdFlashSuggestion`** pour le point 1 — écartée : duplique ce qu'un simple champ
  sur `Invoice` porte déjà nativement, ajoute une cible de purge/rétention et un index sans bénéfice
  fonctionnel (voir point 1).
- **`InvoiceEventType.invoice_cash_collected`** — explicitement écarté par le cadrage PM (redondant
  avec le `Payment` déjà créé, source de vérité comptable/FEC). Non reconsidéré ici.
- **Nouvel enum `PaymentCollectionChannel` dédié** (au lieu de réutiliser `EmissionChannel`) —
  écarté : 4 valeurs quasiment identiques, aucun besoin fonctionnel actuel qui justifierait une
  divergence de vocabulaire entre émission et collecte (voir point 4).
- **Seuil de preuve cash re-dérivé indépendamment côté USSD** (une seconde implémentation du calcul
  `commissionBypassProofThresholdOverrideGnf ?? CASH_PROOF_THRESHOLD_GNF_CENTIMES`) sans jamais
  rappeler `assertCashProofRequirement` — écartée au profit d'une pré-vérification LÉGÈRE côté USSD
  (même calcul, dupliqué UNIQUEMENT pour produire un message clair avec le montant exact avant
  d'appeler `recordCashPayment()`), la garde AUTHENTIFIÉE restant entièrement dans
  `PaymentsService.assertCashProofRequirement()` — la pré-vérification USSD n'est qu'un raccourci
  UX, jamais la seule barrière.
- **Saisie d'un montant cash personnalisé (partiel) depuis *620#** — écartée : le cadrage PM ne liste
  que 3 états pour l'encaissement (« sélection facture → confirmation → résultat »), sans étape de
  saisie de montant ; l'action encaisse `amountDue` intégral relu à chaud. Signalé explicitement
  comme hypothèse d'architecture à confirmer par product-manager si un besoin de montant partiel
  existe réellement pour ce canal.
- **Étendre `ClientPortalService` avec la requête flash** plutôt qu'un nouveau service USSD dédié —
  écartée : le module `ussd/` suit systématiquement un service dédié par capacité
  (`UssdPaymentService`, `UssdAccountService`, `UssdInvoiceService`…), jamais fusionné dans un
  service d'un AUTRE canal produit (portail client web). Garde le blast radius de ce lot contenu au
  dossier `ussd/`.
- **Déclencheur "flash" aussi actif sur le raccourci `anon_emit`** (`*620*1*MONTANT#`) — écarté :
  ce raccourci a son propre contrat UX minimal-friction (ADR-054) ; l'interception y introduirait une
  friction sur un flux d'émission MARCHAND, pas un flux de paiement CLIENT. Le déclencheur est donc
  restreint aux `pendingOption` de `AUTHENTICATED_OPTIONS` (`"1","3","4","5","6","7"`). Hypothèse
  d'architecture à confirmer par product-manager si le comportement voulu diffère.

## Blueprint fichier par fichier

**Schéma & migration**
- `packages/db/prisma/schema.prisma` :
  - `Invoice` : `+ flashSuggestedAt DateTime? @map("flash_suggested_at")`,
    `+ @@index([customerId, issuedAt])`, `+ @@index([organizationId, totalTtc, issuedAt])`.
  - `Payment` : `+ collectionChannel EmissionChannel? @map("collection_channel")`.
- `packages/db/prisma/migrations/20260916100000_ussd_flash_search_cash_collection/migration.sql`
  (DDL exact, à écrire à la main par backend-developer, gabarit `20260908010000_etax_invoice_transmission`) :
  ```sql
  -- Capacité 1 (*620#, flash) — horodatage de suggestion, auto-borné par la fenêtre d'éligibilité
  -- (issuedAt < 30 min) : aucune purge séparée requise, contrairement à ussd_session.expires_at.
  ALTER TABLE "invoice" ADD COLUMN "flash_suggested_at" TIMESTAMP(3);

  -- Jointure cross-organisation Customer.phone -> Invoice.customer_id (capacité 1) : aucun index
  -- n'existait sur invoice.customer_id jusqu'ici.
  CREATE INDEX "invoice_customer_id_issued_at_idx" ON "invoice" ("customer_id", "issued_at");

  -- Recherche composite téléphone + montant, scopée organisation (capacité 2).
  CREATE INDEX "invoice_organization_id_total_ttc_issued_at_idx"
    ON "invoice" ("organization_id", "total_ttc", "issued_at");

  -- Canal de collecte (capacité 3) — réutilise l'enum EmissionChannel existant, nullable, SANS
  -- DÉFAUT (NULL = inconnu/legacy, jamais migré rétroactivement — même discipline qu'invoice.signing_key_id).
  ALTER TABLE "payment" ADD COLUMN "collection_channel" "EmissionChannel";
  ```
  Puis `pnpm --filter db db:generate && pnpm --filter db build` (obligatoire, ordre imposé par
  CLAUDE.md).

**Nouveaux fichiers, `apps/trust-api/src/ussd/`**
- `ussd-flash-suggestion.service.ts` — `UssdFlashSuggestionService` :
  - `findCandidate(phone: string)`: lecture NON scopée à dessein (même statut que
    `ClientPortalService`/`UssdAuthService` — commentaire explicite à reprendre) :
    `prisma.invoice.findFirst({ where: { customer: { phone }, documentType: "invoice", status: {in:
    ["issued","partially_paid"]}, issuedAt: {gte: now-30min}, flashSuggestedAt: null }, orderBy:
    {issuedAt:"desc"}, select: {id, organizationId, number, amountDue} })`.
  - `markSuggested(invoiceId, organizationId)`: écriture SCOPÉE, best-effort (log warn si échec,
    jamais bloquant) : `organizationScopedClient(prisma, organizationId).invoice.updateMany({
    where: {id: invoiceId, organizationId, flashSuggestedAt: null}, data: {flashSuggestedAt: new
    Date()} })`.
- `ussd-invoice-search.service.ts` — `UssdInvoiceSearchService` :
  - `searchByPhoneAndAmount(organizationId, phone, amountTtcCentimes)`: requête exacte point 3
    ci-dessus, bornes de journée UTC calculées en interne (`Date.UTC`, pas de dépendance TZ).
- `ussd-cash-collection.service.ts` — `UssdCashCollectionService` (injecte `PrismaClient`,
  `OrganizationsService`, `PaymentsService`) :
  - `const CASH_COLLECTION_ELIGIBLE_ROLES: OrganizationRole[] = ["owner", "admin", "cashier"]`
    (même style de constante top-of-file qu'`EMIT_ELIGIBLE_ROLES` dans `ussd-invoice.service.ts`,
    valeurs différentes, décision PM).
  - `previewCollectible(organizationId, invoiceId)`: lecture scopée
    `{id, organizationId, status: {in: PAYABLE}}`, retourne `{id, number, amountDue} | null`.
  - `collect(sessionId, invoiceId, organizationId, actorId)`:
    1. `assertEligibleRole(actorId, organizationId)` via `organizationsService.listMine(actorId)`,
       `ForbiddenException` sinon (RBAC reconstruite en ligne, CONTRIBUTING.md §RBAC).
    2. Relit la facture à chaud (scopée, statut payable) — `NotFoundException`/`ConflictException`
       sinon (mêmes types que `getPayableInvoiceOrThrow`).
    3. Seuil de preuve : calcule `effectiveThreshold = organization.
       commissionBypassProofThresholdOverrideGnf ?? CASH_PROOF_THRESHOLD_GNF_CENTIMES` (import direct
       depuis `payments/dto/create-payment.dto.ts`), `BadRequestException` avec le message PM exact
       (« Au-delà de {seuil} GNF, encaissez depuis l'application avec preuve. ») si
       `invoice.amountDue > effectiveThreshold` — pur raccourci UX, la garde authentifiée reste dans
       `assertCashProofRequirement()`.
    4. `paymentsService.recordCashPayment(invoiceId, organizationId, { amount: invoice.amountDue,
       method: "cash" }, \`ussd-cash:${sessionId}\`, "ussd")`.
    5. Retourne `{ message: string }` prêt à afficher.

**Fichiers modifiés**
- `ussd-invoice-list.service.ts` :
  - `+ export function maskPhoneRgpd(phone: string | null): string | null` — 3 premiers + 3 derniers
    chiffres de la partie locale (préfixe `+224` retiré avant masquage, pour matcher exactement le
    format PM `620***233`), reste en `*`. `null`/vide → `null`.
  - `listRecent()` : `+ include: { customer: { select: { phone: true } } }`, retourne désormais
    `{ ...invoiceSansCustomer, customerPhoneMasked }` — le champ `customer` brut n'est JAMAIS renvoyé
    (destructuration, pas de spread du numéro en clair). `listPublicOrderStatus()` inchangé.
- `payments/payments.service.ts` : `recordCashPayment()` gagne un 5ᵉ paramètre
  `collectionChannel: EmissionChannel = "pwa"`, threadé dans `createPaymentAndApply(...)`
  (`paymentData.collectionChannel`). Aucun autre `record*Payment` touché (voir Alternatives).
- `ussd-session.service.ts` (le plus gros diff) :
  - `UssdState` : + les 8 nouveaux littéraux (point 6).
  - `SessionContext` : + les nouveaux champs (point 6).
  - `dispatch()` : + 8 nouveaux `case`, sur le modèle exact des `case` existants
    (`cash_collect_processing`/`cash_collect_terminal` calqués textuellement sur
    `emit_processing`/`emit_terminal`).
  - `tryClaimProcessingState()` : signature élargie d'un paramètre `processingState: UssdState`
    (3 appels existants mis à jour pour passer `"emit_processing"` explicitement — aucun changement
    de comportement pour eux).
  - `completeAuthentication()` : signature `(session: UssdSessionRow, context, currentState)` ;
    NOUVEAU bloc en tête de fonction — si `AUTHENTICATED_OPTIONS.has(context.pendingOption)`
    (exclut `"anon_emit"`), interroge `ussdFlashSuggestion.findCandidate(session.phone)` ; si trouvé,
    `markSuggested()` best-effort, transition `flash_intercept` (écrase le `pendingOption`
    initial — Option 2 renvoie au `ROOT_MENU` nominal, jamais à l'option d'origine), sinon poursuit
    la logique existante inchangée. Branche `pendingOption === "3"` : remplace l'appel à
    `renderMyInvoices(organizationId)` (état `authenticated_stub`) par
    `renderInvoiceHistoryMenu(session.id, organizationId)` (nouvel état `invoice_history_menu`).
  - Nouveaux handlers privés : `handleFlashIntercept`, `renderInvoiceHistoryMenu` (remplace
    `renderMyInvoices`), `handleInvoiceHistoryMenu`, `handleSearchAwaitingPhone`,
    `handleSearchAwaitingAmount`, `handleSearchResultSelect`, `presentCashCollectConfirmation`
    (helper partagé, appelé depuis l'historique ET la recherche), `handleCashCollectConfirm`.
  - Refactor mineur recommandé (DRY, pas obligatoire) : extraire le bloc de prévisualisation
    montant dû + frais + total, dupliqué entre `handlePayInvoiceNumber` et `handleFlashIntercept`
    (option 1), dans un helper privé `presentPaymentPreview(sessionId, organizationId, invoice)`.
- `ussd.module.ts` : `+ import { PaymentsModule } from "../payments/payments.module"` dans
  `imports`, `+ UssdFlashSuggestionService, UssdInvoiceSearchService, UssdCashCollectionService`
  dans `providers`.

**Aucun fichier `apps/web/**` ni `apps/money-api/**` touché** — capacité entièrement côté
`trust-api`, canal USSD uniquement.

## Découpage en tâches bite-sized

### Groupe A — Schéma & migration (préalable, bloque tout le reste)
- [ ] A1 : `schema.prisma` — `Invoice.flashSuggestedAt`, 2 nouveaux `@@index`, `Payment.collectionChannel`.
- [ ] A2 : migration à main levée `20260916100000_ussd_flash_search_cash_collection/migration.sql` (DDL ci-dessus).
- [ ] A3 : `pnpm --filter db db:generate && pnpm --filter db build`.

### Groupe B — Capacité 1, flash (indépendante, livrable seule)
- [ ] B1 (RED) : `ussd-flash-suggestion.service.spec.ts` — candidat trouvé (<30min, issued/partially_paid,
      cross-org), aucun candidat (>30min, statut non éligible, déjà `flashSuggestedAt` non-null),
      `markSuggested` idempotent (2ᵉ appel sans effet, `updateMany` conditionnel).
- [ ] B2 (GREEN) : `UssdFlashSuggestionService`.
- [ ] B3 (RED) : `ussd-session.service.spec.ts` — interception après PIN sur pendingOption
      `"1"/"3"/"4"/"5"/"6"/"7"` (jamais `"anon_emit"`) ; option 2 → `ROOT_MENU` ; option 1 → aperçu
      montant dû + frais (réutilise `findPayableInvoice`/`previewFee`) → `pay_awaiting_confirmation`
      → régénération de lien (`confirmPayment`, `actorId` non-membre accepté) ; pas de re-suggestion
      dans la même fenêtre de 30 min sur une session ultérieure.
- [ ] B4 (GREEN) : `completeAuthentication` (nouvelle signature + bloc flash), `handleFlashIntercept`,
      câblage `dispatch()`.

### Groupe C — Capacité 2, recherche composite + masquage RGPD (indépendante)
- [ ] C1 (RED) : `ussd-invoice-search.service.spec.ts` — 0/1/N résultats même jour, bornes de
      journée UTC exactes (23:59:59 inclus, J+1 00:00 exclu), jamais de facture d'une autre
      organisation même avec le même couple téléphone+montant (test explicite de non-fuite,
      2 organisations distinctes, même `Customer.phone`), `documentType: "invoice"` strict.
- [ ] C2 (GREEN) : `UssdInvoiceSearchService`.
- [ ] C3 (RED) : `ussd-invoice-list.service.spec.ts` — `maskPhoneRgpd` (9 et 8 chiffres, `null`,
      chaîne courte), `listRecent()` ne renvoie plus jamais `phone` en clair (assertion négative sur
      la forme de l'objet retourné).
- [ ] C4 (GREEN) : `maskPhoneRgpd` + `listRecent()`.
- [ ] C5 (RED) : `ussd-session.service.spec.ts` — option 3 devient interactive
      (`invoice_history_menu`, liste + option recherche en `N+1`, y compris liste vide) ; sous-flux
      recherche complet (téléphone invalide → retry ; montant invalide → retry ; 0 résultat →
      terminal ; 1 résultat → direct `cash_collect_confirm` ; N résultats → `search_result_select` →
      sélection → `cash_collect_confirm`).
- [ ] C6 (GREEN) : `renderInvoiceHistoryMenu`, `handleInvoiceHistoryMenu`,
      `handleSearchAwaitingPhone`, `handleSearchAwaitingAmount`, `handleSearchResultSelect`,
      `presentCashCollectConfirmation`, câblage `dispatch()`.

### Groupe D — Capacité 3, encaissement cash (dépend de B et C pour ses points d'entrée)
- [ ] D1 (RED) : `payments.service.spec.ts` — `recordCashPayment(..., collectionChannel)` persiste
      la valeur fournie ; appel sans 5ᵉ argument garde le comportement actuel (`collectionChannel`
      undefined/`"pwa"` selon le choix de défaut tranché en revue) ; paiements existants
      (fixtures sans la colonne) restent `null`.
- [ ] D2 (GREEN) : `payments.service.ts`.
- [ ] D3 (RED) : `ussd-cash-collection.service.spec.ts` — rôle non éligible (`viewer`, `field_agent`)
      → `ForbiddenException` ; facture non payable (`paid`/`voided`/introuvable) →
      `NotFoundException`/`ConflictException` ; montant > seuil effectif (avec et sans
      `commissionBypassProofThresholdOverrideGnf`) → `BadRequestException` message exact ; montant
      ≤ seuil → `recordCashPayment` appelé avec `collectionChannel: "ussd"` et l'`idempotencyKey`
      exact `ussd-cash:${sessionId}` ; deux appels avec le même `sessionId` → un seul `Payment` créé.
- [ ] D4 (GREEN) : `UssdCashCollectionService`.
- [ ] D5 (RED) : `ussd-session.service.spec.ts` — `tryClaimProcessingState` élargi (3 appels
      existants toujours verts) ; `cash_collect_confirm` → garde atomique → succès/erreurs
      (chacun des 4 types d'exception) → `cash_collect_terminal` (message figé, rejeu sans second
      appel à `collect()`) ; déclenché depuis l'historique ET depuis la recherche.
- [ ] D6 (GREEN) : `tryClaimProcessingState` élargi, `handleCashCollectConfirm`, câblage `dispatch()`.

### Groupe E — Câblage module
- [ ] E1 : `ussd.module.ts` — imports/providers.
- [ ] E2 : `pnpm turbo lint typecheck test` (trust-api), `pnpm --filter db build` déjà fait en A3.

## Critères de done

- Suite `trust-api` verte, seuil de couverture non régressé (`pnpm turbo test`).
- `pnpm turbo lint typecheck` verts sur `trust-api` et `db`.
- Aucun test ne peut faire fuiter une facture d'une organisation A via une recherche/flash lancée
  par un appelant authentifié dans l'organisation B, même avec un couple téléphone+montant
  identique — au moins un test de régression dédié par capacité 1 ET capacité 2 le prouve
  explicitement (pas seulement un test « happy path » scopé à une seule organisation).
- Aucun montant GNF traité en `number`/flottant à aucune étape (BigInt de bout en bout, y compris
  dans `SessionContext`, où les montants transitent en `string` sérialisée comme le reste du fichier
  — jamais un `number` JS).
- Un `Payment` créé par `recordCashPayment()` avant ce lot (`collectionChannel` absent en base)
  continue de se lire avec `collectionChannel: null`, jamais une valeur reconstituée.
- Deux requêtes concurrentes sur `cash_collect_confirm` pour le même `sessionId` ne produisent
  jamais deux `Payment` (test de course explicite, même patron que les tests existants sur
  `handleEmitCustomerPhone`/`completeAuthentication` anon_emit).
- Aucun `Customer.phone` en clair n'apparaît dans la valeur de retour de
  `UssdInvoiceListService.listRecent()` (assertion de forme, pas seulement de comportement).

## Risques identifiés & mitigations

- **Risque 1 (préexistant, non corrigé dans ce lot, point 7 du cadrage)** :
  `handlePayConfirmation()` n'a pas de garde `tryClaimProcessingState()`. La capacité 1
  (« Voir et payer ») route vers ce même état sans changement — un rejeu réseau agrégateur pourrait
  théoriquement déclencher deux régénérations de lien de paiement (jamais deux paiements réels : ce
  chemin ne fait jamais qu'émettre un LIEN, pas encaisser). Mitigation : aucune dans ce lot par
  décision explicite du cadrage — à traiter par une story dédiée distincte, hors périmètre.
- **Risque 2** : le calcul du seuil de preuve cash est dupliqué (une fois dans la pré-vérification
  USSD pour le message, une fois dans `assertCashProofRequirement()` pour la garde réelle). Une
  dérive future de la logique de résolution du seuil (ex. un niveau d'escalade supplémentaire, G3)
  dans un seul des deux endroits romprait la cohérence du message affiché sans casser la sécurité
  réelle (la garde authentifiée resterait correcte, seul le message deviendrait trompeur). Mitigation
  : commentaire croisé explicite dans les deux fichiers pointant l'un vers l'autre ; test de
  non-régression qui vérifie que le seuil utilisé côté USSD et côté `PaymentsService` proviennent
  bien du même calcul sur un même jeu de fixtures (organisation avec et sans override).
- **Risque 3** : l'ajout de `flashSuggestedAt`/interception peut surprendre un marchand qui
  s'authentifie via *620# pour une raison n'ayant rien à voir avec une facture qui lui est propre
  (cas où le même MSISDN sert À LA FOIS de compte marchand ET de client d'un autre commerçant —
  plausible en pratique guinéenne, petits commerces). Le comportement reste correct fonctionnellement
  (c'est bien SON numéro qui a une facture récente), mais UX potentiellement déroutante. Hors
  périmètre technique — signalé pour product-manager, pas une mitigation technique à apporter ici.
- **Risque 4** : deux nouveaux index sur `invoice` (table déjà volumineuse en prod à terme) ajoutent
  un coût d'écriture marginal à chaque émission de facture. Mitigation : les deux index sont étroits
  (3 colonnes max, pas d'index sur des colonnes `Json`/`Bytes`), cohérents avec les index déjà
  existants sur cette même table (`@@unique([organizationId, number])` a un profil de coût similaire)
  — accepté comme coût normal d'écriture, pas un risque de correction à part entière.
- **Risque 5** : `EmissionChannel` réutilisé pour `Payment.collectionChannel` couple désormais deux
  modèles à un seul enum — une future valeur ajoutée pour l'un des deux usages (ex. un canal propre à
  l'émission qui n'aurait aucun sens pour une collecte) devra être évaluée pour LES DEUX modèles à la
  fois. Mitigation : commentaire explicite sur le champ (déjà spécifié point 4) qui documente ce
  couplage pour quiconque ajoute une valeur à `EmissionChannel` plus tard.
