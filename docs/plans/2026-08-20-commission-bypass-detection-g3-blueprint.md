# Blueprint : G3 — Détecter un pattern de contournement commission

Contrat de référence : [`2026-08-20-commission-bypass-detection-g3.md`](./2026-08-20-commission-bypass-detection-g3.md) (PLAN.md, validé). Ce document répond à "comment, précisément" pour les Groupes A à E.

## Phase 1 — Patterns trouvés (exploration)

### Le moteur G1 actuel (point d'ancrage)
- `apps/trust-api/src/payments/cash-anomaly-detection.ts:16-31` — `detectCashAnomalyPatterns({amount, sameAmountRecentCount})`, fonction pure, importe directement `CASH_PROOF_THRESHOLD_GNF_CENTIMES` depuis `dto/create-payment.dto.ts` (couplage direct DTO→détection).
- `apps/trust-api/src/payments/payments.service.ts:242-281` — `detectAndRecordCashAnomaly()`, méthode privée, meilleur effort (try/catch, jamais bloquant), appelée uniquement depuis `recordCashPayment()` (ligne 49) — **jamais** depuis `recordProviderPayment()`, `recordBankTransferPayment()`, `recordDepositPayment()`. Crée un `InvoiceEvent` type `suspicious_cash_pattern_detected` si `patterns.length > 0`.
- Commentaires d'ancrage explicites du plan G3 : lignes 57-60 et 239-241 de `payments.service.ts`.

### Le refine() à migrer (Groupe D)
- `dto/create-payment.dto.ts:22-33` et `dto/record-deposit.dto.ts:16-27` — même règle dupliquée : `amount <= CASH_PROOF_THRESHOLD_GNF_CENTIMES OU les 4 champs de preuve présents`. **Aucune autre règle structurelle** ("tout ou rien" indépendant du montant) n'existe aujourd'hui — pour un petit montant, un seul champ de preuve sur 4 est accepté sans erreur. Voir *Décision D-3* ci-dessous : le PLAN.md décrit la tâche D1 comme gardant "une validation de forme tout ou rien", mais cette règle n'existe pas dans le code actuel — c'est une invention, pas une préservation. Tranché : ne PAS l'ajouter (voir Rapport de cohérence, écart HIGH).
- `apps/trust-api/src/common/zod-validation.pipe.ts:16-22` — `ZodValidationPipe.transform()` lève `BadRequestException(result.error.flatten())` sur tout échec Zod → HTTP 400, corps `{formErrors: [], fieldErrors: {proofPhotoUrl: ["message"]}}`. C'est CE format qui change après la migration (voir Décision D-2).
- `dto/create-payment.dto.spec.ts:1-44` — 4 cas testés directement sur `createPaymentSchema.safeParse()`, migrent nécessairement vers des tests service (le schéma ne portera plus cette règle).

### Pattern garde de concurrence — K4/K5 (`financeableInvoiceWhere`)
- `apps/trust-api/src/financing/is-financeable.ts:19-26` — la fonction `where` Prisma est extraite séparément du prédicat de lecture, pour que les deux ne divergent jamais silencieusement (leçon actée en revue `dev-domain-model-reviewer`).
- `apps/trust-api/src/financing/financing.service.ts:42-49` — `tx.invoice.updateMany({where: financeableInvoiceWhere(id), data: {...}})`, `claimed.count === 0` → **throw** `ConflictException` (action utilisateur au premier plan : l'échec doit être visible).
- Différence clé avec G3 : K4/K5 est déclenché par un utilisateur qui attend une réponse synchrone claire (throw sur perte de course légitime). G3/`evaluateAndEscalate()` est un effet de bord meilleur-effort comme `detectAndRecordCashAnomaly()` lui-même (try/catch, jamais de throw) — perdre la course d'escalade signifie "un autre paiement concurrent a déjà fait avancer le niveau", ce qui est un no-op silencieux acceptable, pas une erreur.

### Pattern "case" avec résolution humaine — E5 (`CreditLimitChangeRequest`)
- `apps/trust-api/src/customers/customers.service.ts:120-148` (`proposeCreditLimit`) et `:155-179` (`resolveCreditLimitRequest`) — `updateMany({where: {id, status: "pending"}, data: {status: decision, resolvedAt, resolvedByUserId}})`, `claimed.count === 0` → throw `ConflictException` (ici aussi une action au premier plan, donc throw). Modèle à suivre pour `CommissionBypassCase`, à ceci près que G3 n'a **aucun `User` résolveur** (voir Décision E-2).

### Pattern guard à clé interne dédiée — `DgiVerificationAuthGuard`
- `apps/trust-api/src/common/dgi-verification-auth.guard.ts` — secret propre (`DGI_VERIFICATION_INTERNAL_KEY`), fail-fast au constructeur, comparaison `timingSafeEqual`, header `x-internal-api-key`. Miroir exact de `InternalAuthGuard` (money-api) mais **secret strictement distinct** — le commentaire ligne 9-11 insiste : ne jamais réutiliser un secret d'un autre périmètre de confiance.
- `organizations.controller.ts:47-53` (`verifyDgi`) — câblage : `@Public()` (court-circuite `JwtAuthGuard`) + `@ApiSecurity("internal-api-key")` + `@UseGuards(DgiVerificationAuthGuard)`, **aucun `@Roles()`** (le `RolesGuard` global devient no-op sans lui). Confirmé : "aucun rôle organisationnel n'existe pour cette action" — situation identique pour Squad Money.
- `dgi-verification-auth.guard.spec.ts` — 5 cas de test (clé absente au démarrage, header manquant, mauvaise clé, clé d'un autre périmètre refusée, clé exacte acceptée) — gabarit à dupliquer tel quel.

### Câblage module Nest minimal
- `financing/financing.module.ts` — le plus simple : `{controllers: [...], providers: [...]}`, pas d'`imports`.
- `fec/fec.module.ts` — variante avec `imports: [OrganizationAccessModule]` quand un service partagé est nécessaire.
- `payments/payments.module.ts` — `imports: [MoneyClientModule]`, et `MoneyClientModule` est **aussi** importé directement dans `app.module.ts:7` en plus d'être importé par `PaymentsModule` — precedent direct pour le double-import que ce blueprint réutilise (Décision C-3).
- `app.module.ts:34-62` — liste plate de modules, ordre non signifiant sauf les deux `APP_GUARD` (`JwtAuthGuard` puis `RolesGuard`).

### Modèle `Organization` (extension)
- `packages/db/prisma/schema.prisma:419-475` — style constant : `@map("snake_case")`, champs nullable avec commentaire expliquant le fallback en dur (voir `creditLimitApprovalThreshold:452-457`, précédent direct pour `commissionBypassProofThresholdOverrideGnf`).

## Phase 2 — Décisions d'architecture

### Décision A — Emplacement des nouveaux fichiers
Nouveau module top-level `apps/trust-api/src/commission-bypass/` (pas nesté sous `payments/`), miroir de `financing/`/`margin/`/`revenue-share/` : une story = un module autonome. `cash-anomaly-detection.ts` et le nouveau `non-cash-ratio-drop.ts` restent dans `payments/` (fonctions pures consommées uniquement par `PaymentsService`, même précédent que l'existant).

**Alternative écartée** : tout mettre dans `payments/` — rejetée, `commission-bypass/` porte un modèle Prisma et un contrôleur propres, distincts du domaine "encaissement" ; le pattern du repo est un module par story dès qu'un contrôleur+service dédié apparaît (financing/, margin/, revenue-share/, api-keys/, product-stock/ sont tous des exemples récents de scission plutôt que d'ajout dans un module voisin).

### Décision B — Le refine() migre entièrement, aucune règle structurelle ajoutée
`create-payment.dto.ts`/`record-deposit.dto.ts` perdent leur `.refine()` en entier. Le schéma redevient un `z.object({...})` plat, champs de preuve tous `.optional()` comme aujourd'hui. **Aucune** nouvelle règle "tout ou rien" indépendante du montant n'est ajoutée (voir Phase 1 : cette règle n'existe pas dans le code actuel, l'introduire serait un changement de comportement non demandé par le PLAN — un petit montant avec une preuve partielle reste accepté, exactement comme aujourd'hui).

### Décision C — Le seuil effectif est calculé et appliqué dans `PaymentsService`
Nouveau fichier pur `payments/cash-proof-requirement.ts` :
```ts
export function isCashProofRequirementMet(params: {
  amount: bigint;
  effectiveThresholdGnfCentimes: bigint;
  proofPhotoUrl?: string;
  proofGpsLat?: number;
  proofGpsLng?: number;
  proofSignature?: string;
}): boolean {
  return (
    params.amount <= params.effectiveThresholdGnfCentimes ||
    (params.proofPhotoUrl !== undefined &&
      params.proofGpsLat !== undefined &&
      params.proofGpsLng !== undefined &&
      params.proofSignature !== undefined)
  );
}
```
`PaymentsService` gagne une méthode privée `assertCashProofRequirement(organizationId, dto)` : charge `organization.commissionBypassProofThresholdOverrideGnf ?? CASH_PROOF_THRESHOLD_GNF_CENTIMES`, appelle `isCashProofRequirementMet()`, lève `BadRequestException("Photo, GPS et signature obligatoires pour un encaissement cash au-delà du seuil de preuve en vigueur pour cette organisation")` si non satisfait. Appelée par `recordCashPayment()` (avant `createPaymentAndApply`, juste après `getPayableInvoiceOrThrow`) et par `recordDepositPayment()` (avant l'`insert`, avec `proforma.organizationId` déjà en main — aucun lookup facture supplémentaire).

**Décision D — comportement observable volontairement changé, documenté** : le corps d'erreur passe de `BadRequestException(zodError.flatten())` (format `{fieldErrors: {proofPhotoUrl: [...]}}`) à `BadRequestException("message plat")`. Le code HTTP (400) est préservé, le corps ne l'est pas exactement — c'est un changement de contrat mineur mais réel, à couvrir explicitement dans les tests migrés (Groupe D3), pas une régression silencieuse.

`CommissionBypassEscalationService` (Groupe C) et `assertCashProofRequirement` (Groupe D) sont **découplés** : le premier écrit l'override, le second le lit à la prochaine requête — aucun couplage direct entre les deux fichiers, seule `Organization.commissionBypassProofThresholdOverrideGnf` fait le pont.

### Décision C-3 — Câblage module
`CommissionBypassModule` :
```ts
@Module({
  controllers: [CommissionBypassCasesController, CommissionBypassCaseResolutionController],
  providers: [CommissionBypassEscalationService, CommissionBypassReviewService],
  exports: [CommissionBypassEscalationService],
})
export class CommissionBypassModule {}
```
Importé **deux fois**, comme `MoneyClientModule` : dans `PaymentsModule` (pour injecter `CommissionBypassEscalationService` dans `PaymentsService`) et directement dans `AppModule` (pour enregistrer les deux contrôleurs de revue).

### Décision E — Deux contrôleurs, pas un
Même précédent que `RecurringTemplatesController`/`RecurringTemplateGenerationController` (mémoire projet) : les deux actions ont un `:id` de nature différente (organisation vs case). Découpage :
- `commission-bypass-cases.controller.ts` — `@Controller("organizations/:id/commission-bypass-cases")`, `POST` = ouverture (`:id` = organizationId)
- `commission-bypass-case-resolution.controller.ts` — `@Controller("commission-bypass-cases")`, `POST ":id/resolve"` (`:id` = caseId)

Chaque route : `@Public()` + `@ApiSecurity("internal-api-key")` + `@UseGuards(CommissionBypassReviewAuthGuard)`, **aucun `@Roles()`/`@OrganizationIdSource`** — même précédent exact que `verifyDgi()` (aucun `OrganizationRole` ne représente Squad Money).

### Décision E-2 — Pas d'acteur tracé sur la résolution
`CommissionBypassCase` n'a pas de `resolvedByUserId` : Squad Money n'est représenté par aucun `User` dans ce schéma (le seul précédent d'action "système" comparable, `verifyDgi()`, ne trace aucun acteur non plus). Le corps de la requête d'ouverture porte `detectedPatterns: string[]` (fourni par l'opérateur qui a lu le journal d'audit G4 avant d'agir) — c'est la seule trace de "pourquoi", pas de "qui".

### Décision escalade — garde de concurrence par `updateMany`, jamais de throw
```ts
// commission-bypass-escalation.service.ts
async evaluateAndEscalate(organizationId: string, patterns: CashAnomalyPattern[] | string[]) {
  if (patterns.length === 0) return;
  try {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.commissionBypassLevel === "none") {
      await this.prisma.organization.updateMany({
        where: { id: organizationId, commissionBypassLevel: "none" },
        data: { commissionBypassLevel: "level_1_nudged" },
      });
    } else if (organization.commissionBypassLevel === "level_1_nudged") {
      await this.prisma.organization.updateMany({
        where: { id: organizationId, commissionBypassLevel: "level_1_nudged" },
        data: {
          commissionBypassLevel: "level_2_proof_threshold_lowered",
          commissionBypassProofThresholdOverrideGnf: LOWERED_PROOF_THRESHOLD_GNF_CENTIMES,
        },
      });
    }
    // level_2/3/4 : aucune escalade automatique au-delà (voir PLAN, Clarifications).
  } catch (error) {
    this.logger.warn(`Escalade G3 best-effort échouée pour l'organisation ${organizationId} : ${(error as Error).message}`);
  }
}
```
`LOWERED_PROOF_THRESHOLD_GNF_CENTIMES = CASH_PROOF_THRESHOLD_GNF_CENTIMES / 2n` (500 000 GNF), constante MVP documentée arbitraire, colocalisée dans ce fichier. La clause `where` avec le niveau attendu **est** la garde de concurrence (même mécanisme que `financeableInvoiceWhere`), mais sans `updateMany().count===0` vérifié ni throw : perdre la course = no-op silencieux, cohérent avec le style meilleur-effort déjà établi pour `detectAndRecordCashAnomaly()` elle-même (jamais de `ConflictException` dans ce chemin).

### Décision — extension des signaux, découplage de `cash-anomaly-detection.ts`
Le fichier n'importe plus `CASH_PROOF_THRESHOLD_GNF_CENTIMES` depuis le DTO : il reçoit `effectiveProofThreshold: bigint` en paramètre, fourni par l'appelant (`PaymentsService`, qui l'a déjà calculé pour `assertCashProofRequirement`). Réduction de couplage assumée : le module de détection ne dépend plus jamais d'un DTO. Le seuil `round_amount` (déjà existant) bascule aussi sur ce même paramètre — cohérent avec le sens de la règle ("normalité du commerce sous le seuil de preuve", qui doit suivre le seuil abaissé par organisation, pas rester figé sur la constante globale).

```ts
export type CashAnomalyPattern = "round_amount" | "client_amount_loop" | "sub_threshold_recurrence";

const SUB_THRESHOLD_BAND_RATIO = 0.1; // "juste sous" = dans les 10% sous le seuil effectif — arbitraire MVP
const SUB_THRESHOLD_RECURRENCE_MIN_OCCURRENCES = 3; // même choix que STRUCTURING_LOOP_MIN_OCCURRENCES

export function detectCashAnomalyPatterns(params: {
  amount: bigint;
  sameAmountRecentCount: number;
  effectiveProofThreshold: bigint;
  sameOrgSubThresholdRecentCount: number;
}): CashAnomalyPattern[] {
  const patterns: CashAnomalyPattern[] = [];

  if (params.amount >= params.effectiveProofThreshold && params.amount % ROUND_AMOUNT_UNIT_CENTIMES === 0n) {
    patterns.push("round_amount");
  }
  if (params.sameAmountRecentCount >= STRUCTURING_LOOP_MIN_OCCURRENCES) {
    patterns.push("client_amount_loop");
  }

  const band = (params.effectiveProofThreshold * 10n) / 100n; // 10% = SUB_THRESHOLD_BAND_RATIO
  const bandFloor = params.effectiveProofThreshold - band;
  if (
    params.amount >= bandFloor &&
    params.amount < params.effectiveProofThreshold &&
    params.sameOrgSubThresholdRecentCount >= SUB_THRESHOLD_RECURRENCE_MIN_OCCURRENCES
  ) {
    patterns.push("sub_threshold_recurrence");
  }

  return patterns;
}
```
**Écart signature — breaking change assumé** : les 4 tests existants de `cash-anomaly-detection.spec.ts` doivent tous ajouter `effectiveProofThreshold: CASH_PROOF_THRESHOLD_GNF_CENTIMES, sameOrgSubThresholdRecentCount: 0` à leurs appels pour continuer à passer — ce n'est pas seulement un ajout de cas, c'est une mise à jour obligatoire des 4 cas existants (voir Rapport de cohérence, écart MEDIUM).

### `non-cash-ratio-drop.ts` (nouveau, fonction pure)
```ts
export const NON_CASH_RATIO_CONVERTED_FLOOR = 0.4; // sous ce seuil, l'org n'a jamais été "convertie" — rien à faire chuter
export const NON_CASH_RATIO_DROP_THRESHOLD = 0.5;   // chute relative d'au moins 50% du ratio antérieur
export const RATIO_WINDOW_DAYS = 30;

export function detectNonCashRatioDrop(params: { priorNonCashRatio: number; recentNonCashRatio: number }): boolean {
  if (params.priorNonCashRatio < NON_CASH_RATIO_CONVERTED_FLOOR) return false;
  const relativeDrop = (params.priorNonCashRatio - params.recentNonCashRatio) / params.priorNonCashRatio;
  return relativeDrop >= NON_CASH_RATIO_DROP_THRESHOLD;
}
```
Calcul des ratios dans `PaymentsService` (nouvelle méthode privée `computeNonCashRatio(organizationId, windowStart, windowEnd)`), deux requêtes `count()` (total vs `method: {not: "cash"}`) sur `Payment` filtré par `invoice.organizationId` — **org-wide, jamais scopé à un seul client** (contrairement à `sameAmountRecentCount` qui reste par client). Fenêtre `null` (aucun paiement) → signal ignoré, pas de faux positif sur une organisation neuve.

## Phase 2 — Conception des composants

| Fichier | Statut | Responsabilité |
|---|---|---|
| `packages/db/prisma/schema.prisma` | modifié | `CommissionBypassLevel`, `CommissionBypassCaseStatus`, champs `Organization`, modèle `CommissionBypassCase` |
| `packages/db/prisma/migrations/20260820140000_add_commission_bypass_tracking/migration.sql` | nouveau | DDL manuel (voir Séquence de build) |
| `apps/trust-api/src/payments/cash-anomaly-detection.ts` | modifié | +pattern `sub_threshold_recurrence`, découplage du DTO |
| `apps/trust-api/src/payments/cash-anomaly-detection.spec.ts` | modifié | 4 cas existants mis à jour + nouveaux cas |
| `apps/trust-api/src/payments/non-cash-ratio-drop.ts` | nouveau | signal ratio non-cash, fonction pure |
| `apps/trust-api/src/payments/non-cash-ratio-drop.spec.ts` | nouveau | tests |
| `apps/trust-api/src/payments/cash-proof-requirement.ts` | nouveau | prédicat pur seuil-vs-preuve |
| `apps/trust-api/src/payments/cash-proof-requirement.spec.ts` | nouveau | tests |
| `apps/trust-api/src/payments/payments.service.ts` | modifié | `assertCashProofRequirement()`, `computeNonCashRatio()`, extension de `detectAndRecordCashAnomaly()`, appel à `evaluateAndEscalate()`, retrait des 2 commentaires "hors scope" |
| `apps/trust-api/src/payments/payments.module.ts` | modifié | `imports: [MoneyClientModule, CommissionBypassModule]` |
| `apps/trust-api/src/payments/dto/create-payment.dto.ts` | modifié | retrait du `.refine()` |
| `apps/trust-api/src/payments/dto/create-payment.dto.spec.ts` | modifié | retrait des cas de seuil (migrent vers `payments.service.spec.ts`) |
| `apps/trust-api/src/payments/dto/record-deposit.dto.ts` | modifié | retrait du `.refine()` |
| `apps/trust-api/src/commission-bypass/commission-bypass-escalation.service.ts` | nouveau | `evaluateAndEscalate()` |
| `apps/trust-api/src/commission-bypass/commission-bypass-escalation.service.spec.ts` | nouveau | tests |
| `apps/trust-api/src/commission-bypass/commission-bypass-review-auth.guard.ts` | nouveau | miroir `DgiVerificationAuthGuard`, secret `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY` |
| `apps/trust-api/src/commission-bypass/commission-bypass-review-auth.guard.spec.ts` | nouveau | miroir des 5 cas de `dgi-verification-auth.guard.spec.ts` |
| `apps/trust-api/src/commission-bypass/commission-bypass-review.service.ts` | nouveau | `openCase()`, `resolveCase()` |
| `apps/trust-api/src/commission-bypass/commission-bypass-review.service.spec.ts` | nouveau | tests |
| `apps/trust-api/src/commission-bypass/dto/open-commission-bypass-case.dto.ts` | nouveau | `{detectedPatterns: string[]}` |
| `apps/trust-api/src/commission-bypass/dto/resolve-commission-bypass-case.dto.ts` | nouveau | `{decision: "dismiss" \| "restrict"}` |
| `apps/trust-api/src/commission-bypass/commission-bypass-cases.controller.ts` | nouveau | `POST organizations/:id/commission-bypass-cases` |
| `apps/trust-api/src/commission-bypass/commission-bypass-case-resolution.controller.ts` | nouveau | `POST commission-bypass-cases/:id/resolve` |
| `apps/trust-api/src/commission-bypass/commission-bypass-cases.controller.spec.ts` / `...-resolution.controller.spec.ts` | nouveau | miroir `organizations.controller.spec.ts::verifyDgi` (garde exclusive) |
| `apps/trust-api/src/commission-bypass/commission-bypass.module.ts` | nouveau | câblage |
| `apps/trust-api/src/app.module.ts` | modifié | `imports: [..., CommissionBypassModule]` |

## Flux de données

**Paiement cash normal** : `PaymentsController.create()` → `ZodValidationPipe(createPaymentSchema)` (structure seulement) → `PaymentsService.recordCashPayment()` → `getPayableInvoiceOrThrow()` → `assertCashProofRequirement(invoice.organizationId, dto)` (charge l'org, calcule le seuil effectif, throw 400 si preuve manquante) → `createPaymentAndApply()` (transaction) → `detectAndRecordCashAnomaly()` (meilleur effort, hors transaction) : calcule `sameAmountRecentCount`, `sameOrgSubThresholdRecentCount`, `priorNonCashRatio`/`recentNonCashRatio` → `detectCashAnomalyPatterns()` + `detectNonCashRatioDrop()` → si patterns → `InvoiceEvent` (`suspicious_cash_pattern_detected`) **et** `CommissionBypassEscalationService.evaluateAndEscalate(organizationId, patterns)` (best-effort, updateMany gardé par niveau attendu).

**Revue manuelle** : Squad Money (outil interne, clé `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY`) → `POST organizations/:id/commission-bypass-cases` → `CommissionBypassReviewService.openCase()` (exige `level_2`, refuse un `pending` en double, transaction `updateMany` level→`level_3_under_review` + `create` du case) → plus tard `POST commission-bypass-cases/:id/resolve` → `resolveCase()` (transaction `updateMany` case `pending`→`dismissed|restricted` + `update` organisation `none`|`level_4_restricted`).

## Séquence de build

1. **Groupe A** (schéma) : enums + champs `Organization` + modèle `CommissionBypassCase` → migration SQL manuelle → `db:generate` **puis** `build` (`packages/db`)
2. **Groupe B** (fonctions pures, [P] parallélisables) : `cash-proof-requirement.ts`, extension `cash-anomaly-detection.ts` (avec mise à jour des 4 tests existants), `non-cash-ratio-drop.ts` — chacun testé isolément avant tout câblage service
3. **Groupe D isolé en premier parmi C/D** (le plus à risque, testé seul avant d'ajouter l'escalade) : retrait des `.refine()`, `assertCashProofRequirement()` dans `PaymentsService`, migration des tests DTO → tests service, vérification manuelle que la suite `payments` complète reste verte avant de toucher à autre chose
4. **Groupe C** (escalade) : `commission-bypass-escalation.service.ts` seul + tests, puis câblage dans `detectAndRecordCashAnomaly()` (calcul des 2 nouveaux signaux + appel à `evaluateAndEscalate()`), retrait des commentaires "hors scope"
5. **Groupe E** (revue) : guard → service → DTOs → 2 contrôleurs → module → câblage `app.module.ts` + `payments.module.ts`
6. Regression complète (`pnpm --filter trust-api test`), typecheck, lint
7. `dev-code-reviewer`, `dev-security-reviewer`, `dev-domain-model-reviewer`, `dev-test-quality-analyzer`

## Détails critiques

- **Sécurité** : `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY` fail-fast au démarrage (constructeur du guard), jamais de valeur par défaut ; jamais réutiliser `DGI_VERIFICATION_INTERNAL_KEY`/`MONEY_API_INTERNAL_KEY` (3 périmètres de confiance strictement distincts désormais).
- **Non-régression Groupe D** : code HTTP 400 préservé, corps d'erreur change de forme (Zod `flatten()` → message plat) — documenté, pas silencieux.
- **Concurrence** : escalade = `updateMany` gardé, silencieux sur perte de course (meilleur effort) ; ouverture/résolution de case = `updateMany` gardé, **throw** `ConflictException` sur perte de course (action au premier plan, précédent E5/K4-K5).
- **Performance** : +1 lookup `Organization` par paiement cash (déjà fait ailleurs dans ce service, ex. `recordProviderPayment`) ; +2 `count()` pour le ratio non-cash, hors transaction, meilleur effort — même tradeoff déjà accepté pour `STRUCTURING_LOOP`.
- **Niveau 4** : `level_4_restricted` n'est lu par aucun autre module ce MVP (ni `plan-features-grid.ts`, ni aucun guard) — gap documenté dans le code au point de résolution du case, même style que le gap `revenue_share_credited`/H4.

## Phase 3 — Rapport de cohérence

| # | Écart | Sévérité | Détail |
|---|---|---|---|
| 1 | PLAN.md tâche D1 décrit une règle "tout ou rien" à *garder* qui n'existe pas dans le code actuel | **HIGH** | Si prise au pied de la lettre, cette tâche introduirait une nouvelle contrainte de validation (comportement changé pour les petits montants avec preuve partielle) non demandée ni discutée en Clarifications. Ce blueprint tranche : ne pas l'ajouter (Décision B). Le développeur doit lire cette tâche comme "retirer le refine, rien de plus" — signalé pour éviter une sur-implémentation en TDD. |
| 2 | Les 4 tests existants de `cash-anomaly-detection.spec.ts` ne sont pas explicitement listés comme "à modifier" dans le PLAN (seulement les nouveaux cas) | **MEDIUM** | Signature de `detectCashAnomalyPatterns()` change (2 nouveaux paramètres requis) → les 4 `it()` existants cassent à la compilation sans mise à jour. Couvert dans ce blueprint (Décision "extension des signaux"), à ne pas oublier en Groupe B. |
| 3 | Terminologie stable | — | Aucune dérive trouvée : `CommissionBypassLevel`/`CommissionBypassCase`/`evaluateAndEscalate` utilisés de façon identique entre PLAN.md et ce blueprint. |
| 4 | Couverture tâches↔build | — | Chaque tâche A1-A5/B1-B2/C1-C3/D1-D3/E1-E4 du PLAN a une étape correspondante en Séquence de build ; aucune étape orpheline ajoutée par ce blueprint au-delà des fichiers de test explicitement requis par le PLAN. |
| 5 | Emplacement des fichiers Groupe C/E (`commission-bypass/` vs `payments/`) non tranché par le PLAN | **LOW** | Le PLAN donne des noms de fichiers nus sans dossier. Ce blueprint tranche (Décision A) — cohérent avec le pattern dominant du repo (module par story), pas une contradiction, juste une précision manquante comblée. |
| 6 | Aucune duplication détectée avec du code existant | — | `financeableInvoiceWhere`/`CreditLimitChangeRequest`/`DgiVerificationAuthGuard` sont réutilisés comme **patterns**, jamais importés/étendus directement (domaines distincts) — pas de duplication, une réplication de pattern assumée. |

**Aucun écart CRITICAL.** Un écart HIGH (#1) et un MEDIUM (#2), tous deux résolus par les décisions de ce blueprint — rien ne bloque `dev-tdd-enforcer`, à condition que l'implémenteur suive ce document plutôt que la lettre littérale de la tâche D1 du PLAN.

## Prochaine étape
Blueprint validé, cohérence vérifiée (aucun écart CRITICAL). Prêt pour `dev-tdd-enforcer`, en commençant par le Groupe B (fonctions pures, parallélisables), puis le Groupe D isolé (le plus à risque) avant d'attaquer C et E.
