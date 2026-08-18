# Plan : F14 — Inviter un contrôleur fiscal en lecture seule

## Contexte projet
- Module : Trust Context — `apps/trust-api/src/organizations` (nouveau mécanisme d'invitation), `apps/trust-api/src/invoices` et `apps/trust-api/src/fec` (extension des rôles autorisés en lecture)
- Persona affecté : owner/admin (invite), contrôleur fiscal local invité (consulte)
- Données sensibles manipulées : accès en lecture aux factures d'une PME (montants, clients) — même niveau de sensibilité que l'accès `accountant_internal` déjà existant, aucune donnée nouvelle
- Impact réglementaire : aucun — ADR-104 confirme explicitement que ce mécanisme n'a "aucun rapport fonctionnel" avec la persona institutionnelle DGI (lecture agrégée nationale, ADR-079), c'est un accès individuel accordé par l'organisation elle-même

## Clarifications
- Q: Le rôle doit-il s'appeler `dgi_readonly` ou `tax_controller_readonly` ? → R: **`tax_controller_readonly`** — ADR-104 (17/08/2026) a explicitement renommé le rôle pour lever l'ambiguïté "facture.gn n'est jamais une autorité d'État". `dgi_readonly` ne doit plus être utilisé nulle part, y compris dans le code.
- Q: Un mécanisme d'invitation d'un membre d'organisation existe-t-il déjà, à réutiliser ? → R: **Non** — recherche exhaustive (`organizationMember.create`) : les seules créations existantes sont `role: "owner"` à la création d'organisation. Aucune route, aucun service ne permet aujourd'hui d'ajouter un membre à une organisation existante. F14 est donc la première story à construire ce mécanisme — le pattern le plus proche à réutiliser est `PracticesService.inviteMember()` (F8, résolution par `UserPhone`, vérification de non-doublon, création directe sans flux d'acceptation).
- Q: L'invité doit-il déjà avoir un compte facture.gn, ou peut-on l'inviter par SMS sans compte préexistant ? → R: **Doit déjà avoir un compte** (résolu via `UserPhone`), comme `PracticesService.inviteMember()`. Un flux d'invitation SMS pour un utilisateur sans compte est un mécanisme distinct (cf. F10/ADR-096 pour `client_portal`, jamais généralisé) — hors scope ici.
- Q: Que se passe-t-il si l'utilisateur invité a déjà été membre de l'organisation (même révoqué) ? → R: **Rejeté** (`ConflictException`) — `OrganizationMember` a une contrainte unique `(organizationId, userId)` permanente (pas de `leftAt` comme `PracticeMember`, seulement `revokedAt`). Réactiver un membre révoqué avec un nouveau rôle est un mécanisme distinct, non demandé par le Backlog — hors scope, à traiter par une story dédiée si le besoin apparaît.
- Q: `tax_controller_readonly` a-t-il accès à autre chose que factures + FEC (clients, journal d'audit, score de confiance) ? → R: **Non** — le Backlog est explicite : "consulter en lecture seule mes propres factures et exporter mon FEC". Seuls `GET /invoices`, `GET /invoices/:id` et `GET /organizations/:id/fec` sont concernés. Aucun ajout sur `customers`, `audit-log`, `trust-score`.

## Problème (en 3 lignes max)
Une PME qui subit un contrôle fiscal local doit aujourd'hui soit partager son PIN, soit donner un accès `accountant_internal` (bien plus large que nécessaire) à l'auditeur — aucun rôle en lecture seule strictement scopé aux factures + FEC n'existe.

## Solution retenue (en 5 lignes max)
Ajouter `tax_controller_readonly` à `OrganizationRole`. Un nouvel endpoint `POST /organizations/:id/members` (owner/admin uniquement) permet d'inviter un utilisateur déjà inscrit (résolu par téléphone via `UserPhone`) avec ce rôle, sans flux d'acceptation — même pattern que `PracticesService.inviteMember()` (F8). `tax_controller_readonly` s'ajoute ensuite au trio existant sur `GET /invoices`, `GET /invoices/:id` (jamais sur une route d'écriture) et à `FEC_ELIGIBLE_ROLES` (`fec.service.ts`).

## Alternatives écartées
- **Inviter un utilisateur sans compte facture.gn (flux SMS)** — écartée : mécanisme distinct (F10/ADR-096), jamais généralisé au-delà de `client_portal`, hors scope Backlog F14.
- **Endpoint générique `POST /organizations/:id/members` acceptant n'importe quel rôle** — écartée : même précédent que `invite-member.dto.ts` (F8), le schema restreint `role` à la seule valeur pertinente pour CETTE story (`tax_controller_readonly`), même si le champ reste nommé génériquement pour une extension future naturelle.
- **Réactiver un membre révoqué** — écartée : mécanisme de révocation/réactivation non demandé, non spécifié ; `ConflictException` simple si une ligne `OrganizationMember` existe déjà, peu importe son statut.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — ajouter `tax_controller_readonly` à `enum OrganizationRole`
- [ ] [P] Tâche 2 : migration `packages/db/prisma/migrations/20260818XXXXXX_add_tax_controller_readonly_role/migration.sql` (`ALTER TYPE OrganizationRole ADD VALUE`)
- [ ] [P] Tâche 3 : `apps/trust-api/src/organizations/dto/invite-organization-member.dto.ts` — `{ msisdn: msisdnSchema, role: z.enum(["tax_controller_readonly"]) }`
- [ ] Tâche 4 : `organizations.service.ts` — `inviteMember(organizationId, dto)` : résout `UserPhone`, vérifie l'absence de membership existant, crée `OrganizationMember`
- [ ] Tâche 5 : `organizations.controller.ts` — `POST :id/members` (`@Roles("owner","admin")`, `@OrganizationIdSource("organization")`)
- [ ] Tâche 6 : `invoices.controller.ts` — ajouter `tax_controller_readonly` à `@Roles()` de `GET /invoices` et `GET /invoices/:id` uniquement
- [ ] Tâche 7 : `fec.service.ts` — ajouter `tax_controller_readonly` à `FEC_ELIGIBLE_ROLES`

## Tests à écrire AVANT le code
- [ ] `organizations.service.spec.ts` : invite un utilisateur inscrit par téléphone → `OrganizationMember` créé avec `role: "tax_controller_readonly"`
- [ ] `organizations.service.spec.ts` : téléphone sans compte facture.gn → `NotFoundException`
- [ ] `organizations.service.spec.ts` : utilisateur déjà membre (actif) de l'organisation → `ConflictException`
- [ ] `organizations.service.spec.ts` : utilisateur déjà membre mais révoqué → `ConflictException` (pas de réactivation silencieuse)
- [ ] `roles.guard.spec.ts` : non-régression — aucune modification requise (idSource "organization" déjà testé)
- [ ] `fec.service.spec.ts` : un `tax_controller_readonly` membre actif peut exporter le FEC de son organisation
- [ ] `invoices.controller.ts` / test d'intégration ou vérification manuelle : `tax_controller_readonly` absent des `@Roles()` de toute route d'écriture (issue/void/convert/forfeit/regenerate) — non-régression par lecture du diff, pas nécessairement un test automatisé dédié

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- `dev-code-reviewer` OK
- `dev-security-reviewer` recommandé (élargissement d'accès en lecture à des données financières)

## Risques identifiés & mitigations
- Risque 1 : `tax_controller_readonly` ajouté par erreur à une route d'écriture (issue/void/...) → mitigation : revue explicite de chaque `@Roles()` touché, jamais un ajout en bloc sur tout le controller.
- Risque 2 : contrainte unique `(organizationId, userId)` non pré-vérifiée → erreur Prisma brute (P2002) au lieu d'un message actionnable → mitigation : vérification explicite via `findUnique` avant `create()`, même pattern que `PracticesService.inviteMember()`.
