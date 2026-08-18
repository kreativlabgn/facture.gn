# Plan : Journal d'audit en lecture seule (G4)

## Contexte projet
- Module : Trust Context (`apps/trust-api`) + schéma partagé (`packages/db`)
- Persona affecté : `auditor` (nouveau rôle organisationnel V1, ADR-097), accessible aussi à `owner`/`admin`
- Données sensibles manipulées : historique d'événements de facturation (montants, métadonnées) — lecture seule stricte, aucune exception. Pas de PII nouvelle exposée au-delà de ce qu'`invoice_event` contient déjà.
- Impact réglementaire : aucun texte spécifique déclenché — story de conformité interne (traçabilité), pas un flux financier.

## Clarifications
- Q: G4 demande aussi la lecture de "l'historique des changements de rôle/permission", qui n'existe dans AUCUN modèle du schema actuel (`OrganizationMember` n'a qu'un `revokedAt`, pas d'historique temporel des changements de rôle). Livrer ce volet maintenant ou le scoper à part ? → R: **Scopé à part.** Ce plan livre uniquement le volet `invoice_event` (déjà en base, l'essentiel du volume réel). Le volet "historique RBAC" nécessite un nouveau modèle + son câblage sur tous les points d'écriture existants (`OrganizationsService`, `MandatesService`) — devient une story de suivi distincte, pas incluse ici.
- Q: Le filtre "par catégorie (facture, paiement, permission)" — comment le mapper sans le volet permission ? → R: **2 catégories dérivées statiquement du type `InvoiceEventType`** (`facture` / `paiement`, mapping documenté ci-dessous dans le code). La catégorie `permission` n'est pas exposée comme valeur acceptée par ce plan — un filtre demandé sur une valeur hors de l'union `facture`/`paiement` est rejeté par le schéma Zod (400), jamais une liste vide silencieuse qui masquerait l'absence du volet RBAC.
- Q: Pagination ? → R (défaut retenu, non re-demandé) : même pattern `take`/`skip` que partout ailleurs dans le repo (défaut 50, plafond 100).
- Q: `auditor` peut-il aussi accéder aux données via un mandat cabinet/CGA (comme `OrganizationAccessService` le permet pour d'autres rôles) ? → R (défaut retenu) : non — `auditor` est un rôle direct d'`OrganizationMember` uniquement pour ce plan, cohérent avec le périmètre minimal d'ADR-097 ("aucun de ces cinq rôles n'a encore d'écran"). Extension au mandat cabinet/CGA hors scope ici.

## Problème (en 3 lignes max)
Aucun moyen aujourd'hui de consulter l'historique de facturation d'une organisation à des fins de conformité sans avoir un accès complet de gestion (owner/admin) — ADR-097 a déclaré la permission `audit:view_log` et le rôle `auditor` mais aucun des deux n'existe encore dans le code.

## Solution retenue (en 5 lignes max)
Ajouter `auditor` à `OrganizationRole` (migration additive). Nouvelle méthode `OrganizationsService.listAuditLog(organizationId, { category, take, skip })` qui lit `InvoiceEvent` scopé aux factures de l'organisation, avec un mapping statique type→catégorie (`facture`/`paiement`). Nouvel endpoint `GET /organizations/:id/audit-log`, `@Roles("owner", "admin", "auditor")`, `@OrganizationIdSource("organization")` — même trio de patterns que `GET /organizations/:id/trust-score` déjà en place.

## Alternatives écartées
- **Construire aussi l'historique des changements de rôle/permission dans ce plan** : écarté (voir Clarifications) — gonflerait un ticket `[SHOULD]` à effort faible en feature de taille moyenne à large (nouveau modèle + instrumentation de tous les points d'écriture RBAC). Story de suivi séparée.
- **Nouveau module `audit-log` dédié** : écarté — un seul endpoint scopé à une organisation, mieux aligné avec le pattern déjà en place (`trust-score` vit directement dans `OrganizationsController`/`OrganizationsService`) que la surcharge d'un module + controller + service séparés pour une seule route.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — ajouter `auditor` à `enum OrganizationRole`
- [x] Tâche 2 : `packages/db/prisma/migrations/20260817140000_add_auditor_role/migration.sql` — migration manuelle (`ALTER TYPE "OrganizationRole" ADD VALUE 'auditor'`)
- [x] Tâche 3 : `pnpm --filter @facture-gn/db db:generate` — régénérer le client Prisma
- [x] Tâche 4 : Test — `organizations.service.spec.ts` : `listAuditLog()` retourne les événements des factures de l'organisation, scopés par `organizationId` (jamais ceux d'une autre organisation)
- [x] Tâche 5 : Test — `organizations.service.spec.ts` : `listAuditLog({ category: "paiement" })` ne renvoie que les types de la catégorie paiement (mapping statique)
- [x] Tâche 6 : Test — `organizations.service.spec.ts` : `listAuditLog({ category: "facture" })` ne renvoie que les types hors catégorie paiement
- [x] Tâche 7 : Test — `organizations.service.spec.ts` : pagination `take`/`skip`, plafond 100
- [x] Tâche 8 : `apps/trust-api/src/organizations/organizations.service.ts` — méthode `listAuditLog()` + constante `PAYMENT_RELATED_EVENT_TYPES`
- [x] Tâche 9 : `apps/trust-api/src/organizations/dto/audit-log-query.dto.ts` — schéma Zod `{ category: z.enum(["facture","paiement"]).optional(), take, skip }`
- [x] Tâche 10 : `apps/trust-api/src/organizations/organizations.controller.ts` — `GET :id/audit-log`, `@Roles("owner","admin","auditor")`, `@OrganizationIdSource("organization")`
- [x] Tâche 11 : `pnpm --filter trust-api typecheck && pnpm --filter trust-api test` — suite complète verte

## Tests à écrire AVANT le code
Voir Tâches 4-7 ci-dessus, toutes avant la Tâche 8 (implémentation du service).

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts
- Lecture seule stricte vérifiée : aucun endpoint d'écriture ajouté pour `auditor`, aucune route existante n'accepte `auditor` dans son `@Roles()` en dehors de ce nouvel endpoint
- `dev-domain-model-reviewer` OK si le mapping catégorie mérite un second regard (jugement de classification, pas un invariant strict)

## Clôture
Exécuté le 17/08/2026 — 11/11 tâches, 5 nouveaux tests, suite complète `apps/trust-api` verte (558 tests), typecheck et lint propres.

## Risques identifiés & mitigations
- **Ajout d'une valeur à `OrganizationRole`** : vérifier qu'aucun `switch`/mapping exhaustif sur cet enum ailleurs dans le code ne suppose une liste fermée de 7 valeurs (à contrôler en Tâche 2/3).
- **Mapping catégorie arbitraire** : documenté comme jugement de classification dans le code (commentaire), pas un contrat figé côté spec — un désaccord futur sur la catégorisation d'un type précis n'est pas un bug, juste un ajustement du mapping statique.
