# Plan : G3 — Détecter un pattern de contournement commission

## Contexte projet
- Module : Trust Context / Squad Trust (`apps/trust-api`), extension du moteur comportemental G1 (`payments/`)
- Persona affecté : aucun directement — détection système ; Squad Money (opérateurs internes facture.gn) consomme la revue manuelle
- Données sensibles manipulées : montants et méthodes de paiement (GNF), flux de commission — traiter avec la même rigueur qu'une donnée financière classique
- Impact réglementaire : rattaché au même moteur que G1/ADR-032 (LBC/FT, détection comportementale sans seuil minimal) ; anti-fuite commission (B-08, Risques-RACI)

## Clarifications
- Q: Que fait-on du signal "écart vs moyenne sectorielle/quartier" (aucune donnée de secteur/quartier dans le schéma) ? → R: Différé, gap documenté (pas de champ secteur/quartier ajouté ce MVP).
- Q: Profondeur d'application réelle des 4 niveaux ADR-091 ? → R: Niveaux 1-3 réellement appliqués (nudge modélisé en donnée, seuil de preuve abaissé par organisation, case de revue). Niveau 4 (restriction premium) modélisé sur l'organisation (`level_4_restricted`) mais **non branché** sur `plan-features-grid.ts`/H1 — follow-up séparé.
- Q: Déclenchement de l'escalade ? → R: Automatique none→level_1→level_2 sur détections répétées (même logique meilleur-effort que G1). Ouverture de la revue (level_3) et sa résolution (→ none ou → level_4) exigent une action explicite de Squad Money via un endpoint dédié, jamais automatique.
- Q: Le nudge Niveau 1 est-il livré (SMS/WhatsApp) ou seulement modélisé ? → R: Donnée seulement (event + champ organisation) — cohérent avec la convention du repo où le contenu réellement affiché à l'utilisateur (PWA/*620#) est hors scope backend.

## Problème (en 3 lignes max)
G1 (ADR-032) détecte déjà 2 patterns cash-only par paiement (montant rond, boucle client/montant) mais s'arrête à un événement de log — sans réponse graduée ni détection au niveau organisation. ADR-091 exige une échelle de conséquences à 4 niveaux jamais punitive au premier signal, sur un moteur mutualisé avec G1, avec deux signaux supplémentaires (récurrence sous le seuil de preuve, chute du ratio non-cash) que le code actuel marque explicitement "hors scope, réservé à G3".

## Solution retenue (en 5 lignes max)
Étendre `cash-anomaly-detection.ts` avec un 3ᵉ pattern (`sub_threshold_recurrence`) et un détecteur séparé au niveau organisation (chute du ratio non-cash). Ajouter `CommissionBypassLevel` sur `Organization` avec escalade automatique none→1→2 (seuil de preuve abaissé par override organisation). Ajouter un modèle `CommissionBypassCase` (pending/dismissed/restricted) pour la revue manuelle Squad Money, exposé via un contrôleur protégé par un nouveau guard à clé interne dédiée (même précédent que `DgiVerificationAuthGuard` — aucun `OrganizationRole` n'existe pour "Squad Money"). Déplacer la règle "preuve obligatoire au-delà du seuil" du DTO Zod statique (`create-payment.dto.ts`) vers le service, pour lire l'override par organisation.

## Alternatives écartées
- **Construire le signal sectoriel/quartier dès ce MVP** — écarté : aucune donnée de secteur/quartier n'existe, ADR-091 dit explicitement que les seuils précis restent à calibrer sur données pilotes ; ajouter un champ + une moyenne naïve serait de la sur-ingénierie sur un signal dont personne ne peut encore juger la pertinence.
- **Escalade entièrement automatique jusqu'au Niveau 4** — écarté : contredit le principe déjà établi pour G1 ("jamais un rejet/une action automatique"), et ADR-091 dit explicitement Niveau 3 = revue manuelle.
- **Modéliser l'escalade comme un simple champ mutable sur `Organization` sans historique** — écarté : ce repo a un précédent constant (`CreditLimitChangeRequest`, `AccountRecoveryRequest`) pour toute décision nécessitant une résolution humaine auditable ; un enum sans trace ne survivrait pas à une revue sécurité/domain-model sur un sujet de fraude.

## Découpage en tâches bite-sized (2–5 min chacune)

### Groupe A — Schéma & migration
- [ ] Tâche A1 : Ajouter `enum CommissionBypassLevel` (none/level_1_nudged/level_2_proof_threshold_lowered/level_3_under_review/level_4_restricted) et `enum CommissionBypassCaseStatus` (pending/dismissed/restricted) dans `schema.prisma`
- [ ] Tâche A2 : Ajouter `Organization.commissionBypassLevel` (default none) et `Organization.commissionBypassProofThresholdOverrideGnf` (nullable BigInt) dans `schema.prisma`
- [ ] Tâche A3 : Ajouter `model CommissionBypassCase` (id, organizationId, status, detectedPatterns Json, createdAt, resolvedAt?) + relation sur `Organization`
- [ ] Tâche A4 : Écrire la migration SQL à la main dans `packages/db/prisma/migrations/20260820140000_add_commission_bypass_tracking/migration.sql`
- [ ] Tâche A5 : `pnpm --filter @facture-gn/db db:generate` puis `pnpm --filter @facture-gn/db build` (ordre obligatoire, sinon typecheck trust-api casse sur un dist périmé)

### Groupe B — Moteur de détection (fichiers isolés, testables seuls)
- [ ] [P] Tâche B1 : Étendre `CashAnomalyPattern` avec `"sub_threshold_recurrence"` dans `cash-anomaly-detection.ts`, nouveaux paramètres `effectiveProofThreshold`/`sameOrgSubThresholdRecentCount`, constantes MVP documentées comme arbitraires (`SUB_THRESHOLD_BAND_RATIO`, `SUB_THRESHOLD_RECURRENCE_MIN_OCCURRENCES`)
- [ ] [P] Tâche B2 : Créer `non-cash-ratio-drop.ts` — fonction pure `detectNonCashRatioDrop({ priorNonCashRatio, recentNonCashRatio })`, constantes MVP documentées (`NON_CASH_RATIO_CONVERTED_FLOOR`, `NON_CASH_RATIO_DROP_THRESHOLD`, `RATIO_WINDOW_DAYS`)

### Groupe C — Escalade & câblage service (dépend de A + B)
- [ ] Tâche C1 : Créer `commission-bypass-escalation.service.ts` — `evaluateAndEscalate(organizationId, patterns)` : none→level_1, level_1→level_2 (pose l'override de seuil), no-op au-delà — meilleur effort, try/catch, jamais bloquant
- [ ] Tâche C2 : Dans `payments.service.ts::detectAndRecordCashAnomaly()`, calculer le seuil effectif (override ?? `CASH_PROOF_THRESHOLD_GNF_CENTIMES`), la récurrence sous seuil (requête org-wide sur la fenêtre existante) et le ratio non-cash (2 requêtes d'agrégat sur fenêtres glissantes), fusionner les patterns, appeler `evaluateAndEscalate()`
- [ ] Tâche C3 : Retirer les deux commentaires "hors scope G3/ADR-091" (lignes ~57-60 et ~239-241 de `payments.service.ts`), les remplacer par une note sur le gap restant (signal sectoriel)

### Groupe D — Refactor du seuil de preuve par organisation (le plus à risque, isolé)
- [ ] Tâche D1 : Retirer la règle "montant > seuil ⇒ preuve obligatoire" du `.refine()` de `create-payment.dto.ts` (garder uniquement la validation de forme : tout ou rien sur les 4 champs de preuve) — même traitement sur `record-deposit.dto.ts`
- [ ] Tâche D2 : Réimplémenter la règle dans `PaymentsService`/service de dépôt concerné, avec lookup de l'override organisation, avant la transaction de paiement
- [ ] Tâche D3 : Mettre à jour tous les tests existants qui asserraient l'ancien message d'erreur Zod (`create-payment.dto.spec.ts`, `record-deposit.dto.spec.ts` et tout test d'intégration du contrôleur qui en dépend)

### Groupe E — Revue manuelle Squad Money (module isolé, dépend de A)
- [ ] [P] Tâche E1 : Créer `commission-bypass-review-auth.guard.ts` (miroir exact de `dgi-verification-auth.guard.ts`, secret dédié `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY` — jamais réutiliser un secret existant)
- [ ] Tâche E2 : Créer `commission-bypass-review.service.ts` — `openCase(organizationId)` (exige `commissionBypassLevel === level_2_proof_threshold_lowered`, refuse si un case `pending` existe déjà) et `resolveCase(caseId, decision)` (`dismiss` → org repasse à `none`, clear l'override ; `restrict` → `level_4_restricted`, modélisé seulement)
- [ ] Tâche E3 : Créer `commission-bypass-review.controller.ts` — `POST /organizations/:id/commission-bypass-cases`, `POST /commission-bypass-cases/:id/resolve`, guard exclusif `CommissionBypassReviewAuthGuard` (jamais `@Roles()`/`RolesGuard` — aucun `OrganizationRole` ne représente Squad Money, même précédent que `verifyDgi()`)
- [ ] Tâche E4 : Enregistrer le nouveau module dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] `cash-anomaly-detection.spec.ts` : nouveau pattern `sub_threshold_recurrence` déclenché à partir du seuil de récurrence, ignoré en-dessous ; cumul avec les patterns existants
- [ ] `non-cash-ratio-drop.spec.ts` : chute significative détectée seulement si le ratio antérieur dépasse le plancher "déjà convertie" ; aucune détection si le ratio n'a jamais été significatif (évite le faux positif sur un commerce toujours cash)
- [ ] `commission-bypass-escalation.service.spec.ts` : none→level_1 sur 1ère détection, level_1→level_2 sur 2ᵉ détection (avec pose de l'override), no-op au-delà de level_2, jamais d'exception propagée si l'escalade échoue (meilleur effort)
- [ ] `payments.service.spec.ts` : le seuil de preuve effectif utilise l'override organisation quand il est posé, retombe sur la constante globale sinon ; un paiement cash légitime sans pattern ne déclenche aucune escalade
- [ ] `create-payment.dto.spec.ts` / `record-deposit.dto.ts` : mise à jour pour ne plus tester la règle de seuil au niveau DTO (déplacée), test dédié service pour le rejet si preuve manquante sous le seuil effectif
- [ ] `commission-bypass-review.service.spec.ts` : refuse d'ouvrir un case si l'organisation n'est pas à `level_2` ; refuse un 2ᵉ case `pending` en doublon ; `dismiss` réinitialise proprement (level→none, override cleared) ; `restrict` pose `level_4_restricted` sans toucher à aucune autre partie du système (non enforcement)
- [ ] `commission-bypass-review.controller.spec.ts` : route protégée exclusivement par `CommissionBypassReviewAuthGuard` (même style d'assertion que `organizations.controller.spec.ts::verifyDgi`)

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant dans ce document
- Tous les tests verts (suite complète, hors l'échec Postgres pré-existant connu et sans rapport)
- `pnpm --filter @facture-gn/db db:generate` + `build` exécutés après le changement de schéma
- Aucune donnée sensible loggée (montants/patterns en `metadata` Json, jamais en `logger.log` brut au-delà du message déjà existant)
- Aucun hardcoded secret — `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY` suit le même fail-fast au démarrage que les guards existants
- `dev-code-reviewer` OK, `dev-security-reviewer` OK (flux financier), `dev-domain-model-reviewer` OK (nouvel enum d'état + case model), `dev-test-quality-analyzer` OK

## Risques identifiés & mitigations
- **Groupe D touche un chemin déjà stable/certifié** (`create-payment.dto.ts`/`PaymentsService`, testé en profondeur, utilisé par le flux d'encaissement cash en production logique) → mitigation : faire passer ce plan par `dev-architect` avant le TDD (même précédent que E7, seule autre story de la session à modifier un chemin critique), traiter le Groupe D comme sa propre sous-tâche isolée avec regression complète de la suite `payments` avant de continuer
- **Requêtes d'agrégat supplémentaires à chaque paiement cash** (ratio non-cash sur 2 fenêtres) → mitigation : même tradeoff déjà accepté pour la requête de boucle client existante (STRUCTURING_LOOP), hors transaction, meilleur effort, échec non bloquant
- **Escalade concurrente** (deux paiements cash quasi simultanés sur la même organisation) pourrait faire sauter un niveau ou dupliquer une transition → mitigation : `evaluateAndEscalate()` doit relire `commissionBypassLevel` dans un `updateMany` avec clause `where: { commissionBypassLevel: <niveau attendu> }` (même pattern de garde de concurrence que K4/K5 `financeableInvoiceWhere`), jamais un simple `update` aveugle
- **Niveau 4 modélisé mais non appliqué** pourrait laisser croire à Squad Money qu'une restriction réelle a eu lieu → mitigation : documenter explicitement le gap dans le code (même style que le gap `revenue_share_credited`/H4) et dans ce plan — aucune activation UI/API de ce champ ailleurs dans le repo pour ce MVP

## Prochaine étape
Plan validé sur les points de scope ambigus (voir Clarifications). Vu le Groupe D (chemin critique déjà stable), passage recommandé par `dev-architect` avant `dev-tdd-enforcer` — même précédent que E7.
