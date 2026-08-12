# Plan : Vue factures/clients d'une organisation cliente depuis le cabinet

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (backend, nouveau petit module `cabinet-view` dans `apps/trust-api`) + frontend (`apps/web/src/app/cabinet/organizations/[organizationId]/`).
- Persona affecté : personnel de cabinet comptable/gestionnaire/fiduciaire/CGA (`accountant_external`, `business_manager`) consultant les factures et clients d'une organisation mandante.
- Données sensibles manipulées : factures (montants), clients (téléphone, NIF) d'une organisation qui n'est PAS celle de l'appelant — élargit l'accès financier existant, pas une nouvelle catégorie de donnée. **security-reviewer recommandé avant merge.**
- Impact réglementaire : aucun direct.

## Investigation préalable

`GET /invoices?organizationId=` et `GET /customers?organizationId=` existent déjà mais sont gardés par `RolesGuard`/`@Roles()`, qui ne connaît QUE `OrganizationMember` (voir plan `organization-mandate-access-guard`, déjà mergé). Un cabinet avec mandat actif ne peut pas les utiliser — 403 garanti.

Décision déjà actée dans le plan précédent : ne pas modifier `RolesGuard` ni les routes existantes (rayon d'impact trop large, 40+ endpoints). Ce plan suit exactement le précédent déjà établi par `FecService`/`FecController` (`organizations/:id/fec`) : une route dédiée, path-scopée par organisation, autorisation en service via `OrganizationAccessService` (déjà construit), jamais `@Roles()`.

`InvoicesService.findAllByOrganization(organizationId, { take?, skip? })` et `CustomersService.findAllByOrganization(organizationId, { take?, skip? })` existent déjà et sont exportés par `InvoicesModule`/`CustomersModule` — aucune nouvelle requête Prisma à écrire, seulement le branchement.

## Décision d'architecture

**Backend** — nouveau module `apps/trust-api/src/cabinet-view/` :
- `cabinet-view.controller.ts` — `@Controller("organizations/:id")`, deux routes :
  - `GET /organizations/:id/invoices` → `organizationAccess.assertAccess(id, user.id, ELIGIBLE_ROLES)` puis `invoicesService.findAllByOrganization(id, {take, skip})`
  - `GET /organizations/:id/customers` → même garde, `customersService.findAllByOrganization(id, {take, skip})`
- `ELIGIBLE_ROLES` = `["owner", "admin", "accountant_internal", "cashier", "field_agent"]` — identique au trio déjà utilisé par `GET /invoices`/`GET /customers` existants (aucun élargissement de qui, PARMI LES MEMBRES DE L'ORGANISATION, peut lire — seul l'ajout du chemin mandat change).
- `cabinet-view.module.ts` — importe `InvoicesModule`, `CustomersModule`, `OrganizationAccessModule`.

**Deux routes qui coexistent pour lister la même donnée** (`/invoices?organizationId=` scopé membre, `/organizations/:id/invoices` scopé membre-ou-mandat) — délibéré, même précédent que `/organizations/:id/fec` à côté de `/invoices`. Alternative (modifier la route existante) explicitement écartée, voir plan précédent.

**Frontend** — `apps/web/src/app/cabinet/organizations/[organizationId]/page.tsx` : écran listant factures + clients de l'organisation cliente sélectionnée (lecture seule, même discipline que `cabinet/page.tsx` — pas de données inventées). Accessible depuis un lien "Voir" sur chaque ligne de `cabinet/page.tsx` (liste des mandats déjà existante). `src/lib/trust-api.ts` : deux nouvelles fonctions `listOrganizationInvoicesForCabinet(token, organizationId)` / `listOrganizationCustomersForCabinet(token, organizationId)`.

## Alternatives écartées

**Réutiliser `listInvoices()`/`listCustomers()` existants côté frontend en pointant vers les routes existantes** — impossible, ces routes rejettent un cabinet avec mandat (403), c'est précisément le bug corrigé ici.

**Fusionner facture+client en un seul écran avec deux sections** vs **deux onglets séparés** — un seul écran avec deux sections (factures puis clients), plus simple, cohérent avec la densité déjà pratiquée dans `dashboard/page.tsx` qui mélange déjà plusieurs sections sur une page.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `cabinet-view.controller.spec.ts` — invoques les deux routes avec un `OrganizationAccessService`/`InvoicesService`/`CustomersService` mockés : vérifie l'ordre d'appel (garde avant lecture), la propagation de l'erreur si `assertAccess` rejette, le passthrough des résultats
- [ ] Tâche 2 (GREEN) : `cabinet-view.controller.ts`, `cabinet-view.module.ts`, enregistrement dans `app.module.ts`
- [ ] Tâche 3 : `src/lib/trust-api.ts` — deux fonctions clientes
- [ ] Tâche 4 : `cabinet/organizations/[organizationId]/page.tsx` — écran, lien "Voir" ajouté sur `cabinet/page.tsx`

## Critères de done
- Suite trust-api verte, suite web verte
- Un `accountant_external` avec mandat actif peut charger l'écran ; un utilisateur sans membership ni mandat reçoit 403
- typecheck + lint verts des deux côtés

## Risques identifiés & mitigations
- Risque 1 : oublier la garde sur une des deux routes (copier-coller) → mitigation : test explicite par route vérifiant que `assertAccess` est appelé AVANT le service de lecture (pas juste que les deux sont appelés).
- Risque 2 : montants/NIF de clients tiers exposés à un cabinet sans mandat par une régression future → mitigation : `security-reviewer` avant merge, checklist dédiée données financières.
