# Plan : Wizard d'enrôlement agent terrain — profil, palier, première facture (2026-09-19)

**Statut : plan seul, aucun code livré. TDD à faire (backend-developer puis frontend-developer)
à partir du contrat ci-dessous, après revue de ce plan.**

## Contexte

`apps/web/src/app/admin/field-officer/page.tsx` + `actions.ts` implémentent
aujourd'hui un enrôlement agent terrain en une seule étape : nom du commerce,
MSISDN, attestation de consentement oral (L/2016/037). Testé
(`actions.spec.ts`). Appelle `enrolFieldMerchant()` (Server Action) →
`createAssistedOrganization()` (`@/lib/trust-api.ts`) → `POST
/organizations/assisted` (trust-api, `OrganizationsController.createAssisted`,
B5/ADR-107) → `OrganizationsService.createAssisted()`, qui crée
organisation + marchand (User) + `OrganizationMember` (owner) +
`AssistedSession` (preuve de consentement) + clé de signature racine, dans une
seule transaction Prisma.

Le fondateur veut remplacer ce formulaire simple par un wizard à étapes,
couvrant : profil complet du commerce, choix d'un palier commercial, et
génération d'une première facture réelle à la fin de l'enrôlement, pour que
l'agent quitte le point de vente avec un compte ET une preuve de facturation
déjà en main.

## Clarifications déjà tranchées (ne pas rouvrir)

Décidées en échange direct avec le fondateur avant ce plan :

1. **Le wizard remplace** `field-officer/page.tsx`/`actions.ts` — pas de
   coexistence des deux flux.
2. **Palier commercial** : réutilise `commercialTier` tel qu'il existe déjà
   (`freemium | starter | pro | enterprise | custom`, ADR-049, endpoint
   `POST /organizations/:id/commercial-tier`). Aucun nouvel enum, aucune
   "grille à 6 paliers" — cette mention dans la maquette initiale ne correspond
   à aucun ADR retrouvé dans ce dépôt et est abandonnée.
3. **Étape "passerelle de paiement" (Orange Money / MTN MoMo) supprimée.** Le
   seul enum provider existant est `PaymentProviderName { djomy, moneroo }`
   (`schema.prisma:1869`), un choix de PSP orchestré automatiquement par le
   circuit breaker Djomy→Moneroo (money-api) — jamais un rail télécom
   sélectionné par le marchand. Faire choisir "Orange Money" vs "MTN MoMo" à
   l'onboarding n'a pas d'équivalent côté serveur ; le client choisit son moyen
   de paiement au moment de payer, pas le marchand à l'avance.
4. **`activity` (secteur) et `address`** : n'existent nulle part sur
   `Organization` aujourd'hui. Traités ici comme deux nouveaux champs nullable
   simples (pas de conflit avec un concept existant, contrairement à 2/3
   ci-dessus) — à confirmer en revue de ce plan si le fondateur préfère les
   omettre plutôt que migrer le schéma.
5. **`isFormalised` n'est pas un nouveau champ** : `createAssistedOrganizationSchema`
   accepte déjà `nif`/`etaxNumber` en optionnel (conjoints, ADR-035). Le
   toggle "formalisé/non formalisé" du wizard pilote uniquement quels champs
   sont saisis et quel `regimeFiscal` est envoyé (`tpu` si non formalisé,
   `normal_sans_tva`/`normal_tva` si formalisé + NIF/eTax renseignés) — aucune
   colonne supplémentaire.

## Problème

1. Le brouillon de wizard fourni faisait un `fetch('/api/v1/organizations/assisted')`
   côté client (`'use client'`) — cette route n'existe pas dans
   `apps/web/src/app/api/` (le dossier n'existe pas du tout), et l'appel ne
   porte aucun jeton de session. Le flux réel passe par une Server Action
   (`"use server"`) qui appelle `requireSessionToken()` puis
   `createAssistedOrganization()` côté serveur — jamais un fetch direct
   navigateur→trust-api (frontière inter-services, CLAUDE.md).
2. `createAssistedOrganizationSchema` ne porte aujourd'hui ni `activity`, ni
   `address`, ni palier commercial, ni les champs d'une première facture —
   rien de tout cela ne peut être transmis à `createAssisted()` sans étendre
   le DTO et le service.
3. Aucune orchestration n'existe pour créer une facture immédiatement après un
   enrôlement assisté. `InvoicesService.create()` est un service NestJS
   séparé (numérotation, signature Ed25519 via la clé racine de
   l'organisation, lien de paiement) qui utilise son propre client Prisma —
   il ne peut pas être appelé *dans* la transaction de `createAssisted()` sans
   refactoriser sa gestion de transaction, ce qui casserait la garantie déjà
   documentée pour ses 65+ tests existants (`invoices.service.ts:98-104`).

## Solution retenue

### 1 — Schéma (`packages/db/prisma/schema.prisma`, model `Organization`)

Deux colonnes nullable ajoutées, migration écrite à la main :

```prisma
activity String? @map("activity")
address  String? @map("address")
```

Aucun index, aucune contrainte — champs déclaratifs, jamais vérifiés (même
discipline que `referenceMarche`/ADR-090). RLS : couvert par la politique
existante sur `organization` (ligne, pas colonne) — pas de migration RLS
séparée.

### 2 — DTO trust-api (`create-assisted-organization.dto.ts`)

Ajout de trois champs optionnels au schéma existant, sans toucher aux refines
déjà présents (NIF/eTax conjoints, exonération association) :

```ts
activity: z.string().min(1).optional(),
address: z.string().min(1).optional(),
commercialTier: z.enum(["freemium", "starter", "pro", "enterprise", "custom"]).default("freemium"),
initialInvoice: z
  .object({
    description: z.string().min(1),
    unitPrice: z.coerce.bigint().positive(),
  })
  .optional(),
```

`initialInvoice` optionnel : un agent qui n'a pas de vente témoin à saisir
(cas de figure existant, backlog) doit pouvoir enrôler sans facture — pas de
`.default()`, l'absence est un choix valide, pas une erreur.

### 3 — Service (`organizations.service.ts`, `createAssisted()`)

- `commercialTier` posé directement dans le `data` du `tx.organization.create()`
  — pas d'appel à `upgradeCommercialTier()` ici : cette méthode déclenche la
  conversion de parrainage (`convertirSiEligible`), qui n'a pas de sens pour
  une organisation qui vient de naître dans la même transaction (aucun
  rattachement de parrainage possible avant la fin de la transaction).
- Après le `commit` de la transaction (organisation + clé de signature déjà
  posées) : si `initialInvoice` est fourni, appel **séquentiel**, hors
  transaction, à `InvoicesService.create()` avec `organizationId` de
  l'organisation créée, `customerId: undefined` (vente anonyme, déjà supporté
  par `createInvoiceSchema`), une seule ligne
  `{ description, quantity: 1, unitPrice }`.
- Retour de `createAssisted()` étendu : `{ organization, invoice: Invoice | null }`
  — `invoice: null` si `initialInvoice` n'était pas fourni, jamais une erreur
  silencieuse.

### 4 — Web : Server Action (remplace le `fetch` client)

`apps/web/src/app/admin/field-officer/actions.ts` — `enrolFieldMerchant()`
étendu (nouvelle signature, un seul objet plutôt que des paramètres
positionnels vu le nombre de champs) pour transmettre `activity`, `address`,
`commercialTier`, `initialInvoice` à `createAssistedOrganization()`. Garde de
consentement serveur inchangée (`consentAttested` reste requis avant tout
appel réseau).

### 5 — Web : wizard (remplace `page.tsx`)

4 étapes (Profil → Formule → Première facture → Confirmation), pas 5 —
l'étape passerelle est retirée (clarification 3). Réutilise
`@/components/ui` (`Card`, `CardBody`, `Badge` — barrel confirmé existant).
Aucun fallback en dur sur la réponse serveur : `codeCompte`/`invoiceNumber`
manquants → erreur affichée (`role="alert"`), jamais une valeur de démo
substituée. Pas de brouillon `localStorage` (retenu par le fondateur dans son
propre brouillon le plus récent — pas réintroduit ici).

## Alternatives écartées

- **Nouvel enum "grille à 6 paliers" dédié à l'onboarding** — écarté :
  dupliquerait `commercialTier`, qui gouverne déjà l'accès aux fonctionnalités
  (ADR-049). Deux sources de vérité sur le palier d'un même compte créeraient
  une divergence garantie.
- **Champ `preferredMobileMoneyRail`** — écarté : aucun signal que Djomy/Moneroo
  puissent router dessus aujourd'hui ; ajouterait un champ jamais lu par
  money-api.
- **Facture créée dans la même transaction Prisma que l'organisation** —
  écarté pour cette itération : exigerait de faire accepter un client `tx`
  optionnel à `InvoicesService.create()`, un changement de signature qui
  touche son fichier de tests le plus dense du dépôt. Rouvrable dans un
  chantier séparé si le risque de double organisation (voir Risques) devient
  un problème réel en usage.

## Fichiers et tâches

**trust-api (backend-developer)**
- `packages/db/prisma/schema.prisma` + migration manuscrite (`activity`,
  `address` sur `Organization`)
- `organizations/dto/create-assisted-organization.dto.ts` (+ spec)
- `organizations/organizations.service.ts` (`createAssisted()` étendu + spec)

**web (frontend-developer)**
- `app/admin/field-officer/actions.ts` (+ `actions.spec.ts` étendu, même
  pattern de mock que l'existant : `vi.mock("@/lib/trust-api", ...)`)
- `app/admin/field-officer/page.tsx` → wizard 4 étapes (remplace le fichier)
- `lib/trust-api.ts` : signature de `createAssistedOrganization()` étendue

## Périmètre exclu — rappel explicite

- Aucune passerelle de paiement configurable par le marchand (clarification 3).
- Aucun brouillon persistant (`localStorage` ou autre) entre les étapes.
- Aucun changement à `upgradeCommercialTier()` ni à la logique de parrainage.
- Aucun changement côté money-api / Djomy / Moneroo.

## Critères de done

- `pnpm --filter db db:generate && pnpm --filter db build` après migration.
- Tests trust-api : DTO (rejet/acceptation des nouveaux champs optionnels,
  `initialInvoice` absent → comportement identique à aujourd'hui), service
  (organisation créée avec palier posé, facture créée quand `initialInvoice`
  fourni, `invoice: null` sinon, échec de création de facture après succès de
  l'organisation → erreur distincte, organisation NON annulée).
- Tests web : `actions.spec.ts` étendu sur le même pattern de mock existant.
- `pnpm turbo lint typecheck test` vert sur `trust-api` et `web`.

## Risques et limites

- **Défaillance partielle** : si l'organisation est créée mais que la
  création de la facture échoue ensuite (étape 3, hors transaction), un
  marchand **sans NIF** n'a aucune clé naturelle d'idempotence côté
  `createAssisted()` (contrairement à `createFromApip()`, qui a NIF+RCCM) —
  retenter l'enrôlement complet créerait une organisation en double. Ce plan
  ne résout pas ce cas : l'écran de confirmation doit distinguer "organisation
  créée, facture à refaire" plutôt que de proposer un nouveau bouton
  "Immatriculer" qui rejoue tout depuis l'étape 1. À trancher avant le TDD si
  le fondateur juge le risque réel en usage terrain.
- La facture générée ici alimente le même export FEC dont le plan comptable
  est une hypothèse OHADA/SYSCOHADA non validée par un comptable
  (`fec-generation.ts:20-22`, déjà documenté ailleurs) — pas un risque nouveau,
  juste un rappel que ce chantier n'en change rien.
