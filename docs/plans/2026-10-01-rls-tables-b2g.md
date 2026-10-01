# Plan : RLS des tables B2G (`b2g_case`, `telemo_award`, `ocaecg_license`) et garde d'exhaustivité du registre — ADR-111 / ADR-126

## Contexte projet
- Module : Platform Context (isolation multi-tenant au niveau base) — `packages/db`,
  `apps/trust-api` (tests d'intégration)
- Persona : PME fournisseur de l'État (dont les dossiers B2G sont stockés), DAF d'une
  entité publique (`registerObjection`), cabinet (agrément `OcaecgLicense`), ops (rollout RLS)
- Données sensibles : lien facture ↔ marché public ↔ fournisseur (`b2g_case`), NIF
  fournisseur et montant d'attribution (`telemo_award`), numéro d'agrément et raison sociale
  d'un cabinet (`ocaecg_license`)
- Impact réglementaire : Loi L/2016/037/AN — défense en profondeur au-delà du filtre
  applicatif `organizationId`

## Contexte
La migration `20260917100000_add_public_command_telemo_b2g_ocaecg` (ADR-126, Phase 4 & 5)
a créé trois tables sans les enrôler dans le registre RLS. Constaté le 2026-10-01 sur un
Postgres 16 vierge où les 87 migrations ont été appliquées : `b2g_case` et `telemo_award`
portent `organization_id`, `ocaecg_license` porte `cabinet_id` (→ `organization`), et les
trois ont `relrowsecurity = false`, aucune politique.

Le dépôt pose la règle lui-même — migration `20260911120000_ocr_document` : « sans
politique, elle serait le seul trou du registre RLS … une table sans politique y reste
intégralement lisible par TOUTE organisation ». Ni l'ADR-126 ni `docs/runbooks/rls-rollout.md`
ne prévoient d'exception pour ces trois tables.

## Clarifications
- Q : d'autres tables à colonne de tenant sont-elles hors RLS ? → R : oui, quatre, et elles
  sont des **exceptions documentées**, pas des oublis : `data_rights_request` (registre
  cross-organisation, ADR-E2 §« cross-organisation » + runbook), `practice_member` et
  `professional_practice` (« restent hors RLS, aucune story ne les expose cross-tenant »,
  runbook § scope practice ; plan `2026-09-05-rls-practice-scope`, « alternatives écartées »),
  et les registres sans colonne de tenant (`user`, `user_phone`, `revoked_token`,
  `partner`, `payment_webhook`, `merkle_anchor_batch`, …). Seules les trois tables B2G sont
  de vrais oublis.
- Q : activer `FORCE` / le rôle `facture_app` maintenant ? → R : **non**, hors périmètre.
  Les politiques sont dormantes (prédicat `(org IS NULL AND practice IS NULL) OR …`) tant
  que le rôle applicatif non-propriétaire n'est pas armé (runbook, étapes 2 à 4). Cette
  tranche ne change aucun comportement de production aujourd'hui ; elle empêche que
  l'armement ultérieur laisse ces trois tables grandes ouvertes.
- Q : la RLS casse-t-elle un appelant existant ? → R : **non**. Un seul code touche ces
  tables : `PublicBuyerPortalService.registerObjection`, qui lit et écrit `b2g_case` dans une
  transaction où `setOrganizationScope(tx, invoice.organizationId)` est posé **avant** tout
  accès. `telemo_award` et `ocaecg_license` n'ont aucun consommateur. (Correction d'une
  affirmation de la description de la PR #28 : le client non scopé est la lecture préalable de
  `invoice`, un schéma préexistant — `validateLiquidation` — sans lien avec ces tables.)
- Q : `ocaecg_license` est-elle une donnée de tenant ou un registre de référence ? → R :
  **ouvert, tranché prudemment** : la clé `cabinet_id` désigne une `organization` ; on
  applique la politique d'isolation sur `cabinet_id`, sûre par défaut. Aucun consommateur
  n'existe : à rouvrir si un parcours « vérifier un agrément » (lecture transverse) est
  construit. Les lignes sans cabinet (`cabinet_id IS NULL`) ne sont visibles d'aucun scope
  d'organisation — seulement des sessions non scopées.

## Problème
Trois tables de données de tenant sont hors du registre RLS, et rien dans le dépôt ne
détecte qu'une nouvelle table y échappe : l'oubli de la migration `20260917…` est passé sans
qu'aucun test, revue ni CI ne le voie.

## Solution retenue
1. **Migration écrite à la main** `20261001090000_rls_b2g_ocaecg_tables`, sur le modèle exact
   de la section RLS de `20260911120000_ocr_document` : `ENABLE` + `FORCE ROW LEVEL SECURITY`,
   politique unique `org_isolation FOR ALL` (même prédicat dormant, `USING` et `WITH CHECK`),
   `GRANT … TO facture_app` conditionnel à l'existence du rôle. Clé `organization_id` pour
   `b2g_case` et `telemo_award` (avec l'échappement `rls_practice_sees_org` pour la vue
   cabinet mandatée) ; clé `cabinet_id` pour `ocaecg_license`.
2. **Garde d'exhaustivité** (test d'intégration, base réelle) : toute table du schéma `public`
   portant `organization_id`, `practice_id` ou `cabinet_id` doit être sous RLS, FORCÉE, avec au
   moins une politique — sauf une liste d'exceptions **nommée et justifiée** dans le test. Une
   exception obsolète (table disparue ou enrôlée depuis) fait échouer le test : la liste ne
   peut pas pourrir.
3. **Test d'étanchéité comportemental** sous le rôle `facture_app` : un scope B ne voit, ne
   modifie ni n'insère les lignes de A sur les trois tables ; l'accès de `registerObjection`
   (lecture + mise à jour de `b2g_case` dans le scope de sa propre organisation) continue de
   fonctionner.
4. **Documentation** : registre des tables hors RLS (exceptions) et consigne « nouvelle table »
   dans `docs/runbooks/rls-rollout.md` ; note d'amendement dans l'ADR-126.

## Alternatives écartées
- **Déclarer les trois tables « hors RLS » comme exceptions** : écarté pour `b2g_case` et
  `telemo_award` — elles portent un `organization_id` de PME et leur contenu est une donnée
  de tenant ; aucune justification cross-tenant n'existe (contrairement à
  `data_rights_request`). Pour `ocaecg_license`, l'option reste ouverte (registre
  réglementaire quasi public) ; on choisit l'isolation, réversible par une migration d'une ligne.
- **Politique séparée par commande (SELECT / INSERT / …)** : écarté — le dépôt utilise
  partout une politique unique `FOR ALL` ; en écarter une seule fragiliserait la lecture du
  registre.
- **Activer `FORCE` et armer `facture_app` dans la même tranche** : écarté, c'est le chantier
  supervisé du runbook (étapes 2-4) ; le mélanger masquerait une régression applicative.
- **Un test unitaire avec mock Prisma** : écarté — seul un Postgres réel voit `pg_class`,
  `pg_policies` et le comportement de `SET LOCAL ROLE`.

## Découpage
- [x] Tâche 1 : `apps/trust-api/src/common/rls-registry.integration.spec.ts` (RED)
- [x] Tâche 2 : `packages/db/prisma/migrations/20261001090000_rls_b2g_ocaecg_tables/migration.sql` (GREEN)
- [x] Tâche 3 : `docs/runbooks/rls-rollout.md` + note d'amendement `docs/architecture/adr-126-…md`
- [ ] Tâche 4 : revalidation — migrate deploy sur base vierge, `prisma migrate diff` (aucune
      dérive), suite d'intégration complète, lint, typecheck, tests ; revues répétées (sécurité)

## Tests à écrire AVANT le code
- Test 1 (exhaustivité) : aucune table à colonne de tenant n'est hors RLS hors exceptions
  nommées ; aucune exception n'est obsolète.
- Test 2 (registre) : `b2g_case`, `telemo_award`, `ocaecg_license` — `relrowsecurity` et
  `relforcerowsecurity` vrais, une seule politique `org_isolation` de commande `ALL`.
- Test 3 (étanchéité, rôle `facture_app`) : scope B ne lit pas la ligne de A par son id seul ;
  scope B ne met pas à jour la ligne de A (0 ligne affectée) ; scope B ne peut pas insérer une
  ligne pour A (violation de politique) ; scope A voit et modifie la sienne.
- Test 4 (non-régression de l'appelant) : l'accès de `registerObjection` à `b2g_case`
  (`findUnique` puis `update`) sous le rôle applicatif et le scope de sa propre organisation.
- Test 5 : une attribution non rattachée (`telemo_award.organization_id IS NULL`) est
  invisible d'un scope d'organisation.

## Critères de done
- Tests 1 à 5 verts sur Postgres 16 avec le rôle `facture_app` armé, rouges avant la migration.
- 88 migrations appliquées sur base vierge ; `prisma migrate diff` migrations ↔ `schema.prisma`
  vide ; suite trust-api complète (spécs d'intégration incluses) verte ; lint et typecheck verts.
- Aucune modification de code applicatif (`apps/*/src` hors spec) : la RLS reste dormante.
- Revue de sécurité répétée jusqu'à une passe qui confirme « solide ».

## Risques et limites
- Risque 1 : le prédicat est **dormant sans scope, de façon permanente** (vérifié sur
  Postgres 16 sous `facture_app` : requête sans scope = toutes les lignes visibles ; scope
  posé = lignes de ce seul tenant ; chaîne vide = comme sans scope). La RLS protège donc les
  sessions SCOPÉES contre un mauvais scope ou un filtre applicatif oublié ; elle ne rend pas
  un accès non scopé impossible. Un futur appelant non scopé sur ces tables ne serait **pas**
  détecté, même après l'armement du rôle (étapes 2-4). Mitigation : le filtre applicatif
  `organizationId` reste obligatoire ; la garde d'exhaustivité et la consigne runbook
  obligent chaque nouvelle table à porter la politique dès sa migration. Passer en
  « fail-closed » (retirer l'échappement dormant une fois tout le code scopé) est un chantier
  distinct, non fait ici — voir la précision ajoutée au runbook.
- Risque 2 : le test comportemental ne s'exécute que si `facture_app` existe sur la base de
  test (comme `ocr-vision.integration.spec.ts`) ; en CI, seule l'exhaustivité (`pg_class` /
  `pg_policies`) est garantie. Mitigation : documenté ; le rôle peut être créé dans le job CI
  par une tranche ultérieure.
- Risque 3 : `ocaecg_license` — sémantique de `cabinet_id` à confirmer avec le produit (voir
  Clarifications). Réversible.
