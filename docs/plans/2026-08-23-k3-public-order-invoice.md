# Plan : Émettre une facture de commande publique via *620# ou PWA (K3)

## Contexte projet
- Module : Trust Context (`apps/trust-api`), aucune migration `packages/db` requise — `Invoice.referenceMarche`, `Customer.isPublicEntity`/`isPublicEntityConfirmed`/`publicBuyerAccountId` existent déjà dans `schema.prisma` (posés par le plan J1/J2 et par F16/ADR-105), mais `referenceMarche` n'est lu/écrit par aucun code (confirmé par grep : seul `InvoicesService.updateDraft()` l'accepte dans sa whitelist de patch, méthode elle-même câblée sur AUCUNE route).
- Canal PWA : `apps/web` (formulaire d'émission `InvoiceForm.tsx` + server action `actions.ts` + client `lib/trust-api.ts`).
- Persona : entrepreneur ayant gagné un marché public (10 personas PME existants, pas un nouveau persona) ; utilisateur feature phone (*620#) ou smartphone (PWA).
- Données sensibles : aucune nouvelle donnée sensible — `referenceMarche` est un texte libre non vérifié (ADR-090, "aucune vérification automatique"), jamais une donnée Trésor. Pas de nouveau risque LBC/FT au-delà de ce qui existe déjà sur l'émission de facture standard.
- Dépendance amont : F16 (`CustomersService.flagPublicEntity()`, déjà livré) est un prérequis fonctionnel — sans un client déjà marqué `isPublicEntity=true` côté PME (action PWA, réservée admin/owner), l'option 6.1 USSD n'a structurellement aucun client à proposer.

## Spec consultée
- `V/Backlog-facture-gn.md` L470-476 (K3, `[SHOULD]`, Réf ADR-086/ADR-090)
- `V/Registre-ADR-facture-gn.md` L388-390 (ADR-086 — scope Option 6 USSD, exclusion Trésor Niveau 3) et L407-409 (ADR-090 — TELEMO, `Invoice.reference_marche`, aucune vérification auto)
- `V/Spec USSD facture-gn.md` §2.6 (L71-83 — 6.1 émission condensée montant+référence optionnelle, 6.2 statut de validation, authentification standard §3) et §2.7 note (L89 — l'option 6 était réservée à K3 depuis l'origine, F13 déplacée en 7 pour ne jamais entrer en collision)

## Décisions de conception

### 1. Lien facture B2G ↔ `flagPublicEntity()`/`PublicBuyerAccount` en session USSD condensée
Le modèle existant impose qu'un `Customer` soit d'abord rattaché à un `PublicBuyerAccount` via `CustomersService.flagPublicEntity()` (F16, réservé admin/owner, PWA uniquement — Spec USSD §6 confirme explicitement que `customer:flag_public_entity` est hors périmètre USSD, "aucune n'a de sens sur un menu texte à profondeur limitée"). La session USSD <90s ne peut donc **jamais** créer ce rattachement elle-même.
**Décision retenue** : l'option 6.1 USSD sélectionne parmi les clients **déjà** `isPublicEntity=true` de l'organisation (posés en amont via la PWA, F16) :
- 0 client public → message explicite renvoyant vers l'application ("Marquez un client comme entité publique depuis l'application avant d'émettre une facture Commande Publique."), session terminée — jamais un blocage silencieux.
- 1 client public → sélection automatique, saisie condensée inchangée (montant puis référence marché) — cas majoritaire attendu (une PME a rarement plusieurs administrations clientes).
- >1 client public → écran de sélection numérotée, même mécanique déjà éprouvée que 5.3/5.4 (sélection de mandat cabinet/CGA) — pas un nouveau pattern UX.
Aucun appel à `flagPublicEntity()` depuis l'USSD. `isPublicEntityConfirmed` (confirmation DAF) n'est PAS exigé à l'émission — seul `isPublicEntity` conditionne l'émission (texte spec : "Génère une facture ... `customer.is_public_entity = true`"), la confirmation DAF ne conditionne que la visibilité côté portail Niveau 2 (déjà le comportement existant de `listReceivedInvoices()`/`validateLiquidation()`).

### 2. Option 6.2 — statut de validation, lecture seule côté PME
`PublicBuyerPortalService.validateLiquidation()`/`listReceivedInvoices()` sont scopés côté DAF (autorisation par `PublicBuyerAccountMember.userId`, jamais par organisation PME émettrice) — les réutiliser tels quels serait un mauvais scope d'autorisation pour un appelant PME.
**Décision retenue** : nouvelle méthode `UssdInvoiceListService.listPublicOrderStatus(organizationId)` — lecture seule, scopée par `organizationId` (comme `listRecent()` déjà existant), qui **expose** le champ `Invoice.validatedByAdministration` déjà positionné par `validateLiquidation()` — ne reconstruit aucune logique de validation, se contente de le lire. Aucune donnée Trésor (Niveau 3, ADR-080/086) n'est jamais exposée — hors scope, non construit, cohérent avec l'exclusion explicite de la spec.

### 3. Résolution du client public — pas de nouveau service injecté
Pour éviter d'élargir le constructeur de `UssdSessionService` (9 dépendances déjà, testé par ~50 `it()` qui construisent chacun l'instance inline sans factory), la nouvelle logique métier est ajoutée aux **deux services déjà injectés** :
- `UssdInvoiceService.listPublicEntityCustomers(organizationId)` (à côté de `resolveOrCreateCustomer`, même domaine "client")
- `UssdInvoiceService.emitInvoice(...)` gagne un 4e paramètre optionnel `referenceMarche?: string`, transmis tel quel à `InvoicesService.createDraft()` — même chemin d'émission que l'Option 4, aucun nouveau chemin parallèle (contrainte explicite de la tâche).
- `UssdInvoiceListService.listPublicOrderStatus(organizationId)` (à côté de `listRecent`, même domaine "liste")
Cela n'ajoute aucun paramètre de constructeur à `UssdSessionService` — seuls les fixtures `createFakeUssdInvoice`/`createFakeUssdInvoiceList` du spec gagnent des méthodes par défaut, zéro régression sur les ~50 tests existants qui construisent `UssdSessionService` inline.

### 4. Le gap PWA (`apps/web`) — évalué **minime**
`POST /invoices` (trust-api) route déjà `CreateInvoiceDto` → `InvoicesService.createDraft()` intégralement — le parcours PWA complet (sélection du client déjà marqué public entity via F16, saisie libre) fonctionne déjà pour TOUT SAUF `referenceMarche`, absent du schéma Zod `createInvoiceSchema` et jamais écrit par `createDraft()`. Correctif minimal :
- `create-invoice.dto.ts` : ajoute `referenceMarche?: string` au schéma Zod
- `invoices.service.ts` `createDraft()` : persiste `referenceMarche: dto.referenceMarche`
- `apps/web/src/lib/trust-api.ts` : ajoute `referenceMarche?: string` à `CreateInvoiceInput`
- `apps/web/src/app/dashboard/invoices/new/actions.ts` + `InvoiceForm.tsx` : un champ texte optionnel de plus, même précédent que `customerId`
Le choix du rail de financement (K4, ADR-088) reste hors scope K3 — non touché. Aucun test PWA n'est ajouté (aucun test existant pour `actions.ts`/`InvoiceForm.tsx` dans ce repo — `apps/web` n'a qu'un seul spec, `route-protection.spec.ts`, sans précédent pour tester une Server Action ou un composant de formulaire ; introduire ce précédent est hors scope K3).

## Alternatives écartées
- **Réutiliser `PublicBuyerPortalService.listReceivedInvoices()` pour 6.2** : écarté — scope d'autorisation DAF (par `PublicBuyerAccountMember`), pas PME émettrice ; réutiliser tel quel exposerait la mauvaise identité côté USSD (même risque déjà documenté dans le plan J1/J2, "Alternatives écartées").
- **Nouveau service `UssdPublicOrderService` injecté dans `UssdSessionService`** : écarté — élargit le constructeur (10e paramètre), casse la convention `expect.objectContaining` implicite d'aucun des ~50 `it()` existants qui construisent l'instance inline (pas de factory `createService()` dans ce fichier de spec) ; ajouter les méthodes aux services déjà injectés (`UssdInvoiceService`/`UssdInvoiceListService`) est strictement moins invasif pour un gain fonctionnel identique.
- **Exiger `isPublicEntityConfirmed=true` avant émission USSD** : écarté — la spec ne le demande pas (seul `is_public_entity` est cité), et l'exiger romprait le parcours normal (confirmation DAF survient APRÈS réception, jamais avant la première facture).

## Découpage en tâches bite-sized

### Groupe 1 — Combler le gap `referenceMarche` (fondation, réutilisé USSD + PWA)
- [x] Tâche 1 : Test — `invoices.service.spec.ts` : `createDraft()` persiste `referenceMarche` quand fourni
- [x] Tâche 2 : Test — `invoices.service.spec.ts` : `createDraft()` sans `referenceMarche` → comportement inchangé (non-régression)
- [x] Tâche 3 : `create-invoice.dto.ts` — ajoute `referenceMarche` optionnel au schéma Zod
- [x] Tâche 4 : `invoices.service.ts` `createDraft()` — persiste `referenceMarche: dto.referenceMarche`

### Groupe 2 — `UssdInvoiceService` : résolution client public + émission avec référence [dépend Groupe 1]
- [x] Tâche 5 : Test — `ussd-invoice.service.spec.ts` : `listPublicEntityCustomers()` filtre par `organizationId` + `isPublicEntity: true`
- [x] Tâche 6 : Test — `ussd-invoice.service.spec.ts` : `emitInvoice()` transmet `referenceMarche` à `createDraft()` quand fourni
- [x] Tâche 7 : Test — `ussd-invoice.service.spec.ts` : `emitInvoice()` sans `referenceMarche` → comportement inchangé (non-régression stricte des tests existants)
- [x] Tâche 8 : `ussd-invoice.service.ts` — `listPublicEntityCustomers(organizationId)`
- [x] Tâche 9 : `ussd-invoice.service.ts` — `emitInvoice()` gagne le 4e paramètre optionnel `referenceMarche`

### Groupe 3 — `UssdInvoiceListService` : statut de validation (6.2) [indépendant du Groupe 2]
- [x] Tâche 10 : Test — `ussd-invoice-list.service.spec.ts` : `listPublicOrderStatus()` filtre `documentType: invoice`, `customer.isPublicEntity: true`, exclut `draft`
- [x] Tâche 11 : `ussd-invoice-list.service.ts` — `listPublicOrderStatus(organizationId)`

### Groupe 4 — `UssdSessionService` : sous-menu Option 6 (6.1 + 6.2) [dépend Groupes 2, 3]
- [x] Tâche 12 : Test — authentification réussie sur l'option 6 → affiche le sous-menu "1. Émettre une facture / 2. Statut de validation"
- [x] Tâche 13 : Test — 6.1, un seul client public → sélection automatique, demande le montant directement
- [x] Tâche 14 : Test — 6.1, aucun client public → message explicite renvoyant vers l'application, session terminée
- [x] Tâche 15 : Test — 6.1, plusieurs clients publics → liste numérotée, sélection puis montant
- [x] Tâche 16 : Test — montant invalide → reprompt sans avancer d'état
- [x] Tâche 17 : Test — montant valide → demande la référence marché (optionnelle)
- [x] Tâche 18 : Test — référence renseignée → émission avec `referenceMarche` transmis tel quel
- [x] Tâche 19 : Test — référence laissée vide → émission SANS référence, même parcours exact (Backlog K3 : "Facture sans référence suit exactement le même parcours qu'une facture avec référence")
- [x] Tâche 20 : Test — plafond de vélocité dépassé (D4, cohérence avec Option 4) → message d'échec explicite, session terminée
- [x] Tâche 21 : Test — rejeu concurrent sur l'état `public_order_awaiting_reference` → une seule émission (même garde `tryClaimProcessingState` que l'Option 4/anon_emit)
- [x] Tâche 22 : Test — 6.2 → affiche le statut (validée / en attente) de chaque facture Commande Publique
- [x] Tâche 23 : Test — 6.2, aucune facture → message explicite, jamais un écran vide
- [x] Tâche 24 : `ussd-session.service.ts` — nouveaux états `public_order_menu`/`public_order_customer_select`/`public_order_awaiting_amount`/`public_order_awaiting_reference`, handlers, branche `pendingOption === "6"` dans `completeAuthentication()`, `ROOT_MENU`/`AUTHENTICATED_OPTIONS` mis à jour (le "trou volontaire" entre 5 et 7 se referme)

### Groupe 5 — PWA : exposer `referenceMarche` [dépend Groupe 1, indépendant des Groupes 2-4]
- [x] Tâche 25 : `apps/web/src/lib/trust-api.ts` — `CreateInvoiceInput.referenceMarche?: string`
- [x] Tâche 26 : `apps/web/src/app/dashboard/invoices/new/actions.ts` — lit `referenceMarche` du FormData, transmis si non vide
- [x] Tâche 27 : `apps/web/src/app/dashboard/invoices/new/InvoiceForm.tsx` — champ texte optionnel "Référence marché (TELEMO)"

### Groupe 6 — Clôture
- [x] Tâche 28 : `pnpm --filter trust-api typecheck && pnpm --filter trust-api test` — suite complète verte
- [x] Tâche 29 : `pnpm --filter trust-api lint` — aucune régression
- [x] Tâche 30 : `pnpm --filter web typecheck` (si script disponible) — vérifie la compilation du gap PWA. Note : `tsc --noEmit` échoue sur `src/app/layout.tsx(43,50): Cannot find name 'LayoutProps'` — confirmé **pré-existant** (même échec sur `git stash` avant les 3 fichiers touchés par K3, aucun rapport avec ce plan, probablement un type généré par `next build`/`.next/types` absent en environnement `--noEmit` seul). Les 3 fichiers modifiés par K3 (`trust-api.ts`, `actions.ts`, `InvoiceForm.tsx`) ne produisent eux-mêmes aucune erreur.

## Clôture
Toutes les tâches complètes, suite `trust-api` complète verte (1015 tests, 0 échec), `typecheck`/`lint` `trust-api` et `web` propres sur le code K3 (voir note Tâche 30 pour l'échec pré-existant sans rapport). Aucune migration `packages/db` nécessaire (schéma déjà en place).

## Tests à écrire AVANT le code
Voir Tâches 1-2 (référence marché DTO/service), 5-7 (UssdInvoiceService), 10 (UssdInvoiceListService), 12-23 (UssdSessionService, sous-menu complet) — tous listés avant leur tâche d'implémentation correspondante, pattern TDD identique à l'historique git existant (`test+feat`).

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts (`vitest run` sur `apps/trust-api`, aucune régression sur les ~50 tests existants de `ussd-session.service.spec.ts`)
- Le test de la Tâche 14 (0 client public → message explicite, jamais un blocage silencieux) est non-négociable — c'est le point de friction UX central de la Décision 1
- Le test de la Tâche 19 (référence vide → même parcours) est non-négociable — vérifie explicitement l'exigence Backlog K3
- `referenceMarche` jamais vérifié automatiquement nulle part (ADR-090) — aucun appel réseau TELEMO introduit
- Aucune donnée Trésor exposée par 6.2 (ADR-086, Niveau 3 non construit)
- Aucun nouveau paramètre de constructeur sur `UssdSessionService` (Décision 3)
