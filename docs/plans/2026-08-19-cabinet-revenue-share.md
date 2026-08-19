# Plan : H4 — Calculer et créditer le revenue share cabinet/CGA

## Contexte projet
- Module : Capital Context — nouveau module `apps/trust-api/src/revenue-share`
- Persona affecté : `practice_admin` (et par extension tout `PracticeMember` de la pratique — cabinet comptable ou CGA)
- Données sensibles manipulées : montants de commission — sensibilité comparable à `cost_price`/marge (E7), jamais exposée hors de la pratique concernée
- Impact réglementaire : aucun

## Clarifications
- Q: "Calcul quotidien, crédit mensuel" (Backlog/ADR-071/DAT) implique un automate planifié — construire un premier système de cron dans ce repo ? → R: **Non** — recherche exhaustive : aucune infrastructure de planification (`@nestjs/schedule`, `@Cron`) n'existe nulle part dans ce repo. Construire le premier cron serait une nouvelle brique d'architecture hors scope de cette story (même discipline que F15 : gestion des clés API livrée, authentification+logs différés). **Calcul déclenché manuellement** (endpoint `POST .../generate`) plutôt qu'automatique — le mécanisme de crédit et le calcul sont corrects, seule l'automatisation temporelle est différée à une story d'infrastructure séparée.
- Q: "Client mandaté" = le client final de la PME, ou la PME elle-même (cliente du cabinet) ? → R: **La PME elle-même** — "chaque client" du cabinet/CGA désigne les organisations PME sous mandat actif (`Mandate.organizationId`), pas les `Customer` de ces PME. Le montant de base est `Payment.platformFeeAmount` (la commission facture.gn déjà perçue), sommé par organisation mandatée.
- Q: "Encaissable via payment_link_payout... ou déductible de l'abonnement Partner" — les deux modes construits ? → R: **Seul `payment_link_payout`**, en réutilisant le pattern déjà établi par `refunds.service.ts` : statut `pending`, **aucune exécution réelle Djomy Payout** (aucune intégration n'existe nulle part dans ce repo pour ce rail). "Déductible de l'abonnement" dépend de H3 (facturation de l'abonnement Partner), qui n'existe pas — hors scope, à ajouter quand H3 sera livrée.
- Q: Unité des montants ? → R: Centimes GNF, cohérent avec `Payment.platformFeeAmount` et `commission-grid.ts` déjà existants. Plafond 5 000 GNF/mois/client = `500_000n` centimes.
- Q: Rôle habilité à consulter/générer le revenue share ? → R: Tout `PracticeMember` actif (`leftAt: null`) peut consulter — cohérent avec `PracticesService.listMembers()` ("tout membre actif suffit, pas seulement practice_admin"). Génération restreinte à `practice_admin` (action qui crée un enregistrement financier, cohérent avec la restriction déjà appliquée à `inviteMember()`, F8).

## Problème (en 3 lignes max)
Un cabinet/CGA avec des clients PME mandatés n'a aujourd'hui aucun moyen de voir ou de faire créditer le revenue share de 10 % (ADR-071) que ses clients lui rapportent — la donnée existe (`Payment.platformFeeAmount`) mais rien ne l'agrège ni ne la restitue.

## Solution retenue (en 5 lignes max)
Nouveau module `revenue-share/` : `POST /practices/:id/revenue-share/generate` (practice_admin) calcule, pour chaque mandat actif de la pratique sur la période en cours, `10% × somme(Payment.platformFeeAmount)` plafonné à 500 000 centimes/organisation, et crée des `RevenueShareCredit` (statut `pending`, mode `payment_link_payout`, jamais d'exécution réelle — même convention que les remboursements). `GET /practices/:id/revenue-share` (tout `PracticeMember` actif) liste les crédits déjà générés.

## Alternatives écartées
- **Cron automatique quotidien** — écartée : aucune infrastructure de planification dans ce repo, chantier séparé.
- **Exécution réelle du virement Djomy Payout** — écartée : aucune intégration Djomy Payout n'existe nulle part (ni pour les remboursements, ni ailleurs) — cohérent avec `refunds.service.ts` qui documente déjà cette même limite.
- **Mode "déductible de l'abonnement"** — écartée : dépend de H3 (non livrée).
- **Génération automatique à chaque paiement** — écartée : contredit "crédit mensuel" (Backlog), un crédit doit correspondre à une période fermée, jamais un flux continu recalculé à chaque webhook.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — `enum RevenueShareCreditStatus { pending paid }` + modèle `RevenueShareCredit` (id, practiceId, organizationId, periodMonth (`String`, format `YYYY-MM`), grossCommissionCentimes, creditedAmountCentimes, status, createdAt) + `@@unique([practiceId, organizationId, periodMonth])` (jamais deux crédits pour la même pratique/organisation/mois)
- [ ] Tâche 2 : migration Prisma
- [ ] [P] Tâche 3 : `apps/trust-api/src/revenue-share/revenue-share-grid.ts` — `REVENUE_SHARE_RATE_BPS = 1000`, `REVENUE_SHARE_CAP_PER_CLIENT_CENTIMES_GNF = 500_000n`
- [ ] Tâche 4 : `revenue-share.service.ts` — `generate(practiceId, periodMonth)` : mandats actifs → somme `platformFeeAmount` par organisation sur la période → taux+plafond → upsert `RevenueShareCredit` (idempotent : régénérer un mois déjà généré met à jour, ne duplique jamais)
- [ ] Tâche 5 : `revenue-share.service.ts` — `listByPractice(practiceId)`
- [ ] Tâche 6 : `revenue-share.controller.ts` — 2 routes sous `/practices/:id/revenue-share`, autorisation inline (PracticeMember, pas `@Roles()` — practice_admin/PracticeMember ne sont pas des `OrganizationRole`)
- [ ] Tâche 7 : `revenue-share.module.ts`, enregistrement `app.module.ts`

## Tests à écrire AVANT le code
- [ ] `revenue-share.service.spec.ts` : calcule 10% de la somme des `platformFeeAmount` pour un mandat actif sur la période
- [ ] `revenue-share.service.spec.ts` : plafonne à 500 000 centimes même si 10% dépasse ce montant
- [ ] `revenue-share.service.spec.ts` : ignore les mandats non `active` (pending/revoked/expired)
- [ ] `revenue-share.service.spec.ts` : régénérer la même période met à jour le crédit existant, jamais un doublon (upsert)
- [ ] `revenue-share.service.spec.ts` : `status: "pending"`, `method` implicite `payment_link_payout` — jamais marqué payé automatiquement
- [ ] `revenue-share.controller.ts` / service : seul `practice_admin` peut déclencher `generate`, tout membre actif peut lister
- [ ] `revenue-share.controller.ts` / service : un membre ayant quitté (`leftAt` renseigné) ne peut ni générer ni lister

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts
- Aucune donnée sensible loggée
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` recommandé (invariant plafond, idempotence de la génération)

## Risques identifiés & mitigations
- Risque 1 : double génération créant deux crédits pour la même période → mitigation : `@@unique([practiceId, organizationId, periodMonth])` + upsert, jamais un `create` nu.
- Risque 2 : mandat révoqué en cours de mois compté quand même → mitigation : filtre `status: "active"` au moment de la génération (comportement "au moment du calcul", cohérent avec l'absence de cron — pas de rétro-calcul historique).
