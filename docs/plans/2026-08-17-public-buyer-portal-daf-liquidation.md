# Plan : Portail acheteur public — validation DAF de la liquidation (J1, J2)

## Contexte projet
- Module : Trust Context (`apps/trust-api`) + schéma partagé (`packages/db`)
- Persona affecté : DAF / chef de service dépense d'une administration cliente (nouveau persona, distinct des 10 personas PME) ; côté PME, tout `owner`/`admin` qui marque un client comme entité publique
- Données sensibles manipulées : encours financier fournisseur d'une administration publique (montants agrégés), identité de l'administration (nom) — pas de PII citoyen. Accès cross-organisation par construction (le DAF n'est membre d'aucune des organisations PME dont il consulte les factures) → risque IDOR si l'autorisation est mal scopée. `dev-security-reviewer` obligatoire avant merge.
- Impact réglementaire : aucun texte spécifique déclenché par J1/J2 elles-mêmes ; s'inscrit dans le positionnement anti-R-02 (éviter un modèle centralisé façon El Fatoora) — la validation reste un acte de l'administration cliente, jamais une action interne facture.gn.

## Clarifications
- Q: J1/J2 dépendent de `Customer.isPublicEntity`/`publicBuyerAccountId` (F16), absents du schema actuel (confirmé : commentaire explicite "marqués V2, jamais scaffoldés ici" sur le modèle `Customer`). On inclut une tranche minimale de F16 ? → R: **Oui** — sans elle, J1/J2 n'a structurellement aucune facture à présenter (même raisonnement qu'ADR-105). Tranche minimale seulement : champ + un endpoint pour lier un client, pas de UI, pas de story F16 complète.
- Q: Comment un `PublicBuyerAccount` est-il créé (onboarding institutionnel non spécifié par le backlog) ? → R: **Self-service**, même pattern que `ProfessionalPractice.create()` — n'importe quel utilisateur authentifié peut en créer un et en devient automatiquement `public_buyer_validator`. Aucune vérification institutionnelle en V1 (précédent direct : les cabinets/CGA démarrent pareil).
- Q: Une PME peut-elle lier son client à n'importe quel `PublicBuyerAccount` existant ? → R: **Oui, liste consultable, choix libre** (`GET /public-buyer-accounts`, même pattern que `GET /practices` pour les CGA). Pas de conséquence financière automatique tant que le DAF n'a pas lui-même validé la liquidation — risque de faux positif jugé acceptable en V1.
- Q: Pagination du dashboard J2 ? → R (défaut retenu, non re-demandé) : réutiliser le pattern `take`/`skip` déjà standard (`organizationScopedListQuerySchema`), adapté à un filtre par `publicBuyerAccountId` au lieu de `organizationId`.
- Q: Revalidation d'une facture déjà `validatedByAdministration = true` ? → R (défaut retenu, non re-demandé) : idempotent — un second appel renvoie 200 sans dupliquer l'`InvoiceEvent` (même logique défensive que `Payment.idempotencyKey`, sans nouvelle colonne : on vérifie l'état courant avant d'écrire).

## Problème (en 3 lignes max)
Un DAF n'a aujourd'hui aucun moyen de recevoir les factures certifiées qui lui sont adressées, ni de formaliser la reconnaissance de dette (liquidation) qui conditionne tout financement B2G futur. Sans ce portail Niveau 2, le positionnement institutionnel précoce face au risque R-02 (modèle centralisé) reste une intention non vérifiable.

## Solution retenue (en 5 lignes max)
Nouvelle entité de premier niveau `PublicBuyerAccount` (parallèle à `Organization`, même famille architecturale que `ProfessionalPractice`), self-service, avec un membre unique `public_buyer_validator`. `Customer` gagne `isPublicEntity`/`publicBuyerAccountId` pour qu'une PME rattache un client à une administration. Un nouveau module `apps/trust-api/src/public-buyer` expose la liste/consultation d'encours (J2) et la validation de liquidation (J1), avec autorisation **entièrement inline** dans le service — jamais via `RolesGuard`/`@Roles()`, qui présument à tort un appelant membre de l'organisation PME.

## Alternatives écartées
- **Modéliser `public_buyer_validator` comme un `OrganizationRole` de plus** : écarté — `OrganizationRole` est structurellement scopé à une `Organization` PME (7 valeurs existantes, toutes vérifiées via `OrganizationMember`) ; un DAF n'est membre d'aucune organisation PME. Même raisonnement déjà tranché pour `practice_admin`/`business_manager` (ADR-068, jamais un `OrganizationRole`).
- **Réutiliser `RolesGuard` + `@OrganizationIdSource("invoice")` sur les routes du portail DAF** : écarté — ce guard résout l'organisation PME propriétaire de la facture et vérifie que l'appelant en est membre. Un DAF authentique échouerait systématiquement ce contrôle (il n'est jamais `OrganizationMember` de la PME). Autorisation inline dans `PublicBuyerPortalService` à la place, contre `PublicBuyerAccountMember` + `Customer.publicBuyerAccountId`.

## Découpage en tâches bite-sized (2–5 min chacune)

### Groupe 0 — Fondations schema (bloquant tout le reste)
- [x] Tâche 1 : `packages/db/prisma/schema.prisma` — ajouter `enum PublicBuyerAccountMemberRole { public_buyer_validator }`, `model PublicBuyerAccount` (id, name, createdAt), `model PublicBuyerAccountMember` (id, publicBuyerAccountId, userId, role, joinedAt — même forme que `PracticeMember`)
- [x] Tâche 2 : `packages/db/prisma/schema.prisma` — ajouter `Customer.isPublicEntity Boolean @default(false)`, `Customer.publicBuyerAccountId String?` + relation vers `PublicBuyerAccount`
- [x] Tâche 3 : `packages/db/prisma/schema.prisma` — ajouter `liquidation_validated` à `enum InvoiceEventType`
- [x] Tâche 4 : `packages/db/prisma/migrations/20260817090000_add_public_buyer_portal/migration.sql` — écrire la migration manuelle (cohérent avec les migrations précédentes du repo, toutes écrites à la main)
- [x] Tâche 5 : `pnpm --filter @facture-gn/db db:generate` — régénérer le client Prisma

### Groupe 1 — F16 minimal : lier un client à une administration [P après Groupe 0]
- [x] Tâche 6 : Test — `customers.service.spec.ts` : `flagPublicEntity()` pose `isPublicEntity=true` + `publicBuyerAccountId` sur un client existant de l'organisation appelante
- [x] Tâche 7 : Test — `customers.service.spec.ts` : `flagPublicEntity()` rejette un `publicBuyerAccountId` inexistant
- [x] Tâche 8 : `apps/trust-api/src/customers/dto/flag-public-entity.dto.ts` — schéma Zod `{ publicBuyerAccountId: uuid }`
- [x] Tâche 9 : `apps/trust-api/src/customers/customers.service.ts` — méthode `flagPublicEntity(customerId, publicBuyerAccountId)`
- [x] Tâche 10 : `apps/trust-api/src/customers/customers.controller.ts` — `POST :id/flag-public-entity`, `@Roles("owner", "admin")` (réservé, ADR-105/ADR-083 — même trio restreint que `merge()`), `@OrganizationIdSource("customer")`

### Groupe 2 — Onboarding self-service du PublicBuyerAccount [P après Groupe 0]
- [x] Tâche 11 : Test — `public-buyer-accounts.service.spec.ts` : `create()` crée le compte et ajoute le créateur comme `public_buyer_validator` (même garantie que `PracticesService.create()`)
- [x] Tâche 12 : `apps/trust-api/src/public-buyer/dto/create-public-buyer-account.dto.ts` — schéma Zod `{ name: string }`
- [x] Tâche 13 : `apps/trust-api/src/public-buyer/public-buyer-accounts.service.ts` — `create()`, `listActive()`
- [x] Tâche 14 : `apps/trust-api/src/public-buyer/public-buyer-accounts.controller.ts` — `POST /public-buyer-accounts` (aucun `@Roles()`, tout utilisateur authentifié — même justification que `PracticesController.create()`), `GET /public-buyer-accounts` (liste active, pour le sélecteur PME du Groupe 1 et transparence)

### Groupe 3 — J1 : valider la liquidation [dépend Groupes 0, 1, 2]
- [x] Tâche 15 : Test — `public-buyer-portal.service.spec.ts` : `validateLiquidation()` refuse un appelant qui n'est pas `PublicBuyerAccountMember` du compte propriétaire du client de la facture (cas IDOR — le test qui protège contre la régression la plus grave de ce plan)
- [x] Tâche 16 : Test — `public-buyer-portal.service.spec.ts` : `validateLiquidation()` refuse une facture dont le client n'a pas `publicBuyerAccountId` renseigné (pas une facture B2G)
- [x] Tâche 17 : Test — `public-buyer-portal.service.spec.ts` : `validateLiquidation()` sur une facture `draft` échoue (jamais avant `issued` — la liquidation suppose une créance certifiée)
- [x] Tâche 18 : Test — `public-buyer-portal.service.spec.ts` : `validateLiquidation()` pose `validatedByAdministration=true` + crée un `InvoiceEvent(type: liquidation_validated, actorId: <user DAF>)` sur une facture éligible
- [x] Tâche 19 : Test — `public-buyer-portal.service.spec.ts` : appel répété sur une facture déjà validée → 200 idempotent, aucun second `InvoiceEvent` créé
- [x] Tâche 20 : `apps/trust-api/src/public-buyer/public-buyer-portal.service.ts` — `validateLiquidation(invoiceId, requesterUserId)`
- [x] Tâche 21 : `apps/trust-api/src/public-buyer/public-buyer-portal.controller.ts` — `POST /public-buyer/invoices/:invoiceId/validate-liquidation` (`JwtAuthGuard` seul, **aucun** `@Roles()`/`@OrganizationIdSource` — autorisation entièrement dans le service, cf. Alternatives écartées)

### Groupe 4 — J2 : dashboard encours fournisseurs [dépend Groupes 0, 1, 2 ; peut être fait en parallèle du Groupe 3]
- [x] Tâche 22 : Test — `public-buyer-portal.service.spec.ts` : `listReceivedInvoices()` ne renvoie que les factures `issued+` des clients rattachés au `PublicBuyerAccount` de l'appelant, jamais celles d'un autre compte
- [x] Tâche 23 : Test — `public-buyer-portal.service.spec.ts` : `listReceivedInvoices()` calcule l'encours total (`SUM(amountDue)`) sur le même périmètre
- [x] Tâche 24 : `apps/trust-api/src/public-buyer/public-buyer-portal.service.ts` — `listReceivedInvoices(requesterUserId, { take, skip })`
- [x] Tâche 25 : `apps/trust-api/src/public-buyer/public-buyer-portal.controller.ts` — `GET /public-buyer/invoices` (`JwtAuthGuard` seul, même raisonnement d'autorisation inline que Tâche 21)

### Groupe 5 — Câblage & clôture
- [x] Tâche 26 : `apps/trust-api/src/public-buyer/public-buyer.module.ts` — regrouper les 2 controllers + le service + `PublicBuyerAccountsService`
- [x] Tâche 27 : `apps/trust-api/src/app.module.ts` — enregistrer `PublicBuyerModule`
- [x] Tâche 28 : `V/openapi-facture-gn.yaml` — ajouter `POST /public-buyer-accounts`, `GET /public-buyer-accounts`, `POST /customers/{id}/flag-public-entity` (absents de la version actuelle, qui ne documentait que la lecture/validation en supposant le compte déjà créé)
- [x] Tâche 29 : `pnpm --filter trust-api typecheck && pnpm --filter trust-api test` — suite complète verte

## Tests à écrire AVANT le code
Voir Tâches 6-7 (F16), 11 (onboarding), 15-19 (J1), 22-23 (J2) ci-dessus — tous listés avant leur tâche d'implémentation correspondante, pattern TDD identique à l'historique git existant (`test+feat`).

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts (`vitest run` sur `apps/trust-api`)
- Le test de la Tâche 15 (refus IDOR cross-compte) est non-négociable — c'est le risque de sécurité central de ce plan
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- `dev-security-reviewer` OK (accès cross-organisation par construction)
- `dev-domain-model-reviewer` OK (nouvelle entité `PublicBuyerAccount`, nouveau statut implicite `validatedByAdministration` sur `Invoice`)

## Clôture
Exécuté le 17/08/2026 — 29/29 tâches, 15 nouveaux tests (+ 2 sur `CustomersService`), suite complète `apps/trust-api` verte (549 tests) hors `invoice-numbering.service.integration.spec.ts` (échec préexistant, indépendant de ce plan — nécessite un Postgres réel non disponible ici, vérifié par comparaison avant/après ces changements). Reste à faire avant merge : `dev-code-reviewer`, `dev-security-reviewer`, `dev-domain-model-reviewer`, `dev-test-quality-analyzer`.

## Risques identifiés & mitigations
- **IDOR cross-organisation** : un DAF pourrait valider/consulter des factures qui ne lui sont pas destinées si l'autorisation inline est mal écrite → mitigation : test dédié (Tâche 15) + revue sécurité obligatoire, jamais de `RolesGuard` réutilisé ici (voir Alternatives écartées).
- **Migration Prisma sur `Customer`/`Invoice` déjà peuplés** : nouvelles colonnes toutes nullable/`@default(false)` → aucune donnée existante cassée, migration additive uniquement.
- **Ajout d'une valeur à `InvoiceEventType`** : vérifier qu'aucun `switch`/mapping exhaustif sur cet enum (notifications, exports FEC/UBL) ne suppose une liste fermée avant cet ajout — à contrôler en Tâche 3.
- **Confusion `validatedByAdministration` avec un paiement effectif** : le champ existe déjà mais n'a aucun consommateur — s'assurer qu'aucun code de paiement/webhook ne l'interprète par erreur comme "payé" (ADR-080 : liquidation ≠ ordonnancement ≠ paiement).
