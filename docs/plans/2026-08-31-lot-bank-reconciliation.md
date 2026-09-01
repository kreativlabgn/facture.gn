# Plan : Lot rapprochement bancaire (ADR-052)

## Contexte projet
- **Module** : Trust Context (paiements). Nouveau sous-module
  `apps/trust-api/src/bank-reconciliation/` — nom explicite pour éviter la
  collision avec `apps/money-api/src/reconciliation/` (réconciliation des
  tentatives provider Djomy/Moneroo, concept **différent**). Réutilise
  `PaymentsService.recordBankTransferPayment` (C3, chemin critique — jamais
  modifié).
- **Persona affecté** : owner / admin / `accountant_internal` d'une PME
  (Aïssatou, Mamadou). Nouvel écran PWA « rapprochement bancaire ».
- **Données sensibles manipulées** : montants GNF, **libellés de virement**
  (peuvent contenir nom / NIF / IBAN du payeur), flux financiers. →
  `dev-security-reviewer` **et** `dev-domain-model-reviewer` obligatoires.
  `dev-resilience-reviewer` recommandé (rapprochement = détection, jamais un
  encaissement silencieux).
- **Impact réglementaire** : Loi **L/2021/024/AN** (LBC/FT — traçabilité des
  mouvements d'argent, détection comportementale sans seuil) ; **OHADA Art. 23**
  (le `Payment` créé reste immuable après collecte) ; ADR-052 (« bank_transfer
  rapprochement asynchrone »), ADR-061 (marquage manuel restreint cash/virement).
  Positionnement non négociable : **détection passive, jamais d'intégration
  bancaire active** (aucune API banque consommée).

## Clarifications
- Q (périmètre) : **virements entrants de la PME → factures payables**. Pas de
  détection passive du paiement Trésor B2G Rail B (canal/portail distinct —
  fast-follow). Pas d'entité `BankStatementImport` (les transactions portent un
  `importBatchId` texte pour regrouper, suffisant).
- Q (source des transactions) : **tableau JSON fourni par l'appelant** — la PWA
  parse le fichier bancaire (CSV/OFX/MT940). Même précédent que l'import clients
  E9 (« parsing laissé à la PWA »). Le backend ne parse aucun fichier.
- Q (application d'une correspondance) : **suggérer puis confirmer** — le staff
  valide chaque `(transaction ↔ facture)` avant que le `Payment` soit créé.
  Jamais d'auto-application. Pas de « dé-confirmation » : une erreur se corrige
  par avoir + remboursement (flux existant C13/ADR-063).
- Q (dédoublonnage d'une transaction) : **empreinte** =
  `SHA-256(organizationId ‖ valueDate(ISO date) ‖ amountCentimes ‖ label normalisé)`,
  contrainte `@unique`. Ré-importer le même relevé ne crée pas de doublons
  (retour : `imported` / `duplicate` par ligne). La clé d'idempotence du
  `Payment` à la confirmation = `bank-reconciliation:<transactionId>` (jamais une
  collision avec la saisie manuelle `POST bank-transfer`, qui passe un UUID v4
  client).

## Problème (3 lignes)
Un virement reçu n'a aujourd'hui aucun outil : le staff le repère sur son relevé
bancaire et le saisit à la main, facture par facture (`recordBankTransferPayment`,
C3). Résultat : virements oubliés (impayés fantômes) ou mal imputés (factures
« payées à tort »). Il faut importer les virements du relevé, les rapprocher
automatiquement des factures en attente, et confirmer d'un geste.

## Solution retenue (5 lignes)
Nouveau modèle `BankTransaction` (une ligne de relevé importée + son état). Un
service `BankReconciliationService` : **(import)** dédoublonne par empreinte et
persiste les virements entrants ; **(suggestion)** un moteur pur classe, pour
chaque transaction non rapprochée, les factures payables de l'organisation par
`(montant exact, référence de facture dans le libellé, fenêtre de date)` avec un
niveau de confiance ; **(confirmation)** le staff valide un couple `(transaction,
facture)` → le service revendique la transaction (garde d'état) puis délègue à
`PaymentsService.recordBankTransferPayment` (idempotence, paiement partiel,
transitions de statut, régénération du lien — inchangé) ; **(ignore)** le staff
écarte une transaction (pas un virement client, déjà traité ailleurs). Colonnes
d'identité de `BankTransaction` immuables en base (trigger, pattern J1/E1) ;
`DELETE` interdit.

## Alternatives écartées
- **Parsing du fichier bancaire côté backend** — écarté : chaque banque guinéenne
  a son format / ses variantes de CSV ; c'est un chantier de parsing à part
  entière, et la PWA a déjà le fichier sous la main. Le backend prend un contrat
  JSON stable.
- **Auto-application des correspondances « certaines »** — écarté : introduit un
  chemin d'écriture financière non supervisé. Un faux positif (deux factures au
  même montant, référence absente) = facture payée à tort, réversible seulement
  par avoir. Le gain de clics ne vaut pas le risque (cf. contexte projet,
  `dev-resilience-reviewer` : « facture marquée payée à tort »).
- **Réutiliser / étendre `money-api/ReconciliationService`** — écarté : ce
  service réconcilie des `PaymentProviderAttempt` (webhooks Djomy/Moneroo
  perdus) ; le rapprochement bancaire ne touche ni provider ni webhook. Même
  famille de mot, domaine disjoint — un sous-module trust-api dédié.
- **Entité `BankStatementImport` (agrégat de lot)** — différée : un
  `importBatchId` texte sur `BankTransaction` suffit à regrouper un import pour
  l'affichage et l'audit ; l'agrégat (compte, période, solde d'ouverture/clôture)
  est un raffinement fast-follow.
- **`BankTransaction` entièrement append-only** — écarté : l'état
  (`unmatched → matched | ignored`) DOIT muter. Compromis : colonnes d'identité
  immuables + `DELETE` interdit (trigger), colonnes d'état libres — même patron
  que `merkle_anchor_batch` (E1).
- **Détection passive du paiement Trésor (B2G Rail B)** — hors périmètre (canal
  distinct, `validatedByAdministration` en attente, pas de relevé PME côté
  Trésor). Fast-follow documenté dans l'ADR.

## Découpage en tâches bite-sized

### Groupe A — Modèle `BankTransaction` + migration — testable/livrable seul
- [x] A1 : `packages/db/prisma/schema.prisma` — `model BankTransaction` :
  `id`, `organizationId`, `importBatchId String`, `valueDate DateTime`
  (`@db.Date` — date de valeur, pas d'heure), `amountCentimes BigInt`
  (positif — virements **entrants** seulement), `rawLabel String`,
  `counterpartyLabel String?` (nom du donneur d'ordre si la banque le fournit),
  `bankRef String?`, `fingerprint String @unique`, `state BankTransactionState @default(unmatched)`,
  `matchedInvoiceId String?`, `matchedPaymentId String? @unique`,
  `importedByUserId String`, `resolvedByUserId String?`, `resolvedAt DateTime?`,
  `createdAt`. Relations : `organization`, `matchedInvoice Invoice?`
  (`onDelete: Restrict`), `matchedPayment Payment?` (`onDelete: Restrict`).
  `@@index([organizationId, state])`. `@@map("bank_transaction")`. Enum
  `BankTransactionState { unmatched  matched  ignored }`.
- [x] A2 : `Invoice` + `Payment` + `Organization` + `User` — relations inverses
  (`bankTransactionsMatched Invoice[]` etc. — nommage cohérent avec l'existant).
- [x] A3 : migration manuelle `packages/db/prisma/migrations/<ts>_bank_transaction/migration.sql` :
  `CREATE TYPE "BankTransactionState"`, `CREATE TABLE`, index (`fingerprint`
  unique, `matched_payment_id` unique, `(organization_id, state)`), FK
  (`organization_id`, `matched_invoice_id` ON DELETE RESTRICT, `matched_payment_id`
  ON DELETE RESTRICT). **Fonction plpgsql `reject_bank_transaction_identity_mutation()`**
  (`LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`,
  `ERRCODE = 'restrict_violation'`, `CREATE OR REPLACE TRIGGER`) : `DELETE` →
  exception ; `NEW.organization_id / value_date / amount_centimes / raw_label /
  fingerprint / import_batch_id / created_at IS DISTINCT FROM OLD` → exception.
  Trigger `bank_transaction_identity_immutable BEFORE UPDATE OR DELETE FOR EACH ROW`.
  (TRUNCATE non couvert — reset CI, cohérent J1.) Copie du patron
  `20260830150000_merkle_anchor_batch`.
- [x] A4 : `pnpm --filter @facture-gn/db db:generate && build`.
- [x] A5 : `packages/db/src/bank-transaction-identity-immutable.integration.spec.ts`
  — gated `DATABASE_URL` (pattern `merkle` / `invoice-event`) : INSERT OK,
  `UPDATE state` OK, `UPDATE amount_centimes` rejeté, `DELETE` rejeté.

### Groupe B — Moteur de rapprochement (pur) — testable/livrable seul
- [x] B1 : `apps/trust-api/src/bank-reconciliation/bank-matching.ts` (pur) :
  - `normalizeLabel(s): string` — minuscules, espaces/ponctuation compressés,
    accents retirés (pour l'empreinte ET la recherche de référence).
  - `fingerprint({ organizationId, valueDate, amountCentimes, rawLabel }): string`
    = `SHA-256` hex (`@noble/hashes`) de `org ‖ valueDate.toISOString().slice(0,10) ‖ amountCentimes ‖ normalizeLabel(rawLabel)`.
  - `type MatchConfidence = "strong" | "probable" | "weak"`.
  - `interface MatchSuggestion { invoiceId: string; confidence: MatchConfidence; reasons: string[] }`.
  - `suggestMatches(tx, candidates): MatchSuggestion[]` — pour chaque facture
    payable candidate : `reasons` = `["montant exact"]` si `invoice.amountDue === tx.amountCentimes` ;
    `["référence FG-… dans le libellé"]` / `["référence GN-… dans le libellé"]`
    si `normalizeLabel(rawLabel)` contient `normalizeLabel(invoice.number)` ou
    `invoice.certificationId` ; `["émise dans la fenêtre"]` si
    `0 ≤ (valueDate − issuedAt) ≤ MATCH_DATE_WINDOW_DAYS`. `confidence` =
    `strong` si (montant exact **ET** référence), `probable` si l'un des deux
    forts, `weak` sinon (fenêtre seule). Trié `strong > probable > weak`, puis
    `amountDue` le plus proche. Jamais de suggestion sans au moins une `reason`.
- [x] B2 : `apps/trust-api/src/bank-reconciliation/bank-reconciliation.constants.ts` :
  `MATCH_DATE_WINDOW_DAYS = 30`, `MAX_IMPORT_BATCH_SIZE = 500`,
  `MAX_SUGGESTIONS_PER_TX = 10`.

### Groupe C — `BankReconciliationService` — testable/livrable seul
- [x] C1 : `apps/trust-api/src/bank-reconciliation/dto/import-bank-transactions.dto.ts` —
  Zod : `{ importBatchLabel?: string, transactions: Array&lt;{ valueDate: string (date ISO), amountCentimes: coerce.bigint().positive(), rawLabel: string.min(1), counterpartyLabel?: string, bankRef?: string }&gt; }`,
  tableau `.min(1).max(MAX_IMPORT_BATCH_SIZE)`.
- [x] C2 : `apps/trust-api/src/bank-reconciliation/dto/confirm-match.dto.ts` —
  `{ invoiceId: z.string().uuid() }`.
- [x] C3 : `bank-reconciliation.service.ts` — `importTransactions(organizationId, dto, userId)` :
  génère un `importBatchId` (uuid) ; pour chaque ligne calcule l'empreinte ;
  `createMany({ skipDuplicates: true })` OU boucle `create` + catch P2002 →
  compte `imported` vs `duplicate` par ligne ; retourne
  `{ importBatchId, imported, duplicate, results: [...] }`. Aucune suggestion
  calculée ici (lecture séparée).
- [x] C4 : `bank-reconciliation.service.ts` — `listTransactions(organizationId, { state?, importBatchId?, take?, skip? })` :
  `findMany` scopé org, trié `valueDate desc`. Pour les transactions
  `unmatched`, calcule les suggestions : **un seul** `invoice.findMany` des
  factures payables de l'org (`status ∈ {issued, partially_paid}`), puis
  `suggestMatches` par transaction en mémoire (jamais un N+1). Retourne
  `[{ ...transaction, suggestions }]`, `suggestions` plafonné à
  `MAX_SUGGESTIONS_PER_TX`.
- [x] C5 : `bank-reconciliation.service.ts` — `confirmMatch(organizationId, transactionId, invoiceId, userId)` :
  1. `updateMany({ where: { id: transactionId, organizationId, state: "unmatched" }, data: { state: "matched", matchedInvoiceId: invoiceId, resolvedByUserId: userId, resolvedAt: now } })`
     — **revendication d'abord** ; `count === 0` → `ConflictException`
     (« transaction déjà rapprochée / ignorée / introuvable »). Ferme la course
     « deux confirm concurrents sur la même transaction vers des factures
     différentes » (sinon la clé d'idempotence dérivée renverrait le mauvais
     `Payment`).
  2. `try { payment = await paymentsService.recordBankTransferPayment(invoiceId, { amount: tx.amountCentimes }, ` `` `bank-reconciliation:${transactionId}` `` `) }`
     `catch (e) { revert la revendication (updateMany state matched + matchedPaymentId null → unmatched, champs resolved nuls) ; throw e }`.
     `recordBankTransferPayment` fait déjà : facture existe + payable + montant
     ≤ `amountDue` + idempotence + `applyPaymentToInvoice` + `regenerateLink`.
  3. `bankTransaction.update({ where: { id: transactionId }, data: { matchedPaymentId: payment.id } })`.
  4. retourne `{ transaction, payment }`.
- [x] C6 : `bank-reconciliation.service.ts` — `ignoreTransaction(organizationId, transactionId, userId)` :
  `updateMany({ where: { id, organizationId, state: "unmatched" }, data: { state: "ignored", resolvedByUserId: userId, resolvedAt: now } })` ;
  `count === 0` → `ConflictException`. (Pas de « ré-activation » d'une
  transaction ignorée dans ce lot — fast-follow si besoin.)

### Groupe D — Contrôleur + module + câblage
- [x] D1 : `bank-reconciliation.controller.ts` — `@Controller("organizations/:id/bank-reconciliation")`,
  `@ApiBearerAuth()`. Routes, toutes `@OrganizationIdSource("organization")`,
  `@Roles("owner", "admin", "accountant_internal")` :
  - `POST import` `{ transactions }` → `importTransactions(id, dto, user.id)`
  - `GET transactions` `?state=&importBatchId=&take=&skip=` → `listTransactions`
  - `POST transactions/:transactionId/confirm` `{ invoiceId }` → `confirmMatch(id, transactionId, dto.invoiceId, user.id)`
  - `POST transactions/:transactionId/ignore` → `ignoreTransaction(id, transactionId, user.id)`
- [x] D2 : `bank-reconciliation.module.ts` — `imports: [PaymentsModule]`,
  `providers: [BankReconciliationService]`, `controllers: [BankReconciliationController]`.
  `PaymentsModule` gagne `exports: [PaymentsService]`.
- [x] D3 : `app.module.ts` — `BankReconciliationModule` après `DataRightsModule`.
- [x] D4 : `app.module.spec.ts` — le graphe DI compile (aucun secret nouveau).
- [x] D5 : `docs/runbooks/bank-reconciliation.md` — format JSON attendu, moteur de
  suggestion, procédure de correction d'un faux rapprochement (avoir +
  remboursement), note LBC/FT, note RLS (`bank_transaction` scopé org).
- [x] D6 : `docs/architecture/adr-c-bank-reconciliation.md` (**ADR-117 provisoire**,
  `V/` sale) : import JSON, suggérer-puis-confirmer, empreinte, réutilisation du
  chemin C3, colonnes d'identité immuables, fast-follows (B2G Rail B, parsing
  fichier, agrégat d'import, dé-confirmation).
- [x] D7 : `docs/runbooks/rls-rollout.md` — `bank_transaction` scopé org
  (politique RLS standard, pas cross-org comme merkle/data_rights).

## Tests à écrire AVANT le code

### Groupe A
- [ ] `bank-transaction-identity-immutable.integration.spec.ts` (gated) : INSERT
  OK ; `UPDATE state` OK ; `UPDATE amount_centimes` / `raw_label` rejeté
  `restrict_violation` ; `DELETE` rejeté.

### Groupe B
- [ ] `bank-matching.spec.ts` :
  - `normalizeLabel` : `"VIR SEPA / FG-2026-000042 / SARL DELTA"` →
    minuscules, sans ponctuation ; accents retirés.
  - `fingerprint` : déterministe, 64 hex ; deux montants différents → empreintes
    différentes ; l'heure de `valueDate` ne change rien (date seule).
  - `suggestMatches` :
    - montant exact + `number` dans le libellé → `confidence: "strong"`, deux
      `reasons`.
    - montant exact seul → `"probable"`.
    - `certificationId` dans le libellé seul → `"probable"`.
    - émise il y a 10 j, aucun autre signal → `"weak"`.
    - émise il y a 40 j (hors fenêtre), aucun autre signal → **aucune
      suggestion**.
    - 2 factures au même montant exact → 2 suggestions `"probable"`, triées par
      proximité de `amountDue`.
    - facture `draft` / `paid` / d'une autre org → jamais candidate.

### Groupe C
- [ ] `bank-reconciliation.service.spec.ts` (`importTransactions`) :
  - persiste chaque ligne avec l'empreinte ; retour `imported: N`.
  - ré-import de la même ligne (même empreinte, P2002) → `duplicate`, pas de
    doublon.
  - `valueDate` invalide / `amountCentimes` négatif → rejeté par le DTO (test DTO).
- [ ] `bank-reconciliation.service.spec.ts` (`listTransactions`) :
  - un seul `invoice.findMany` quel que soit le nombre de transactions (pas de
    N+1) ; suggestions attachées aux `unmatched` uniquement ; plafond
    `MAX_SUGGESTIONS_PER_TX`.
- [ ] `bank-reconciliation.service.spec.ts` (`confirmMatch`) :
  - revendique la transaction (`state → matched`) **avant** d'appeler
    `paymentsService.recordBankTransferPayment` ; passe la clé
    `bank-reconciliation:<txId>` et `amount = amountCentimes`.
  - `recordBankTransferPayment` lève (facture non payable) → la revendication est
    **annulée** (`state` revient à `unmatched`), l'exception remonte.
  - succès → `matchedPaymentId` renseigné, retour `{ transaction, payment }`.
  - transaction déjà `matched` / `ignored` → `ConflictException`, aucun appel à
    `recordBankTransferPayment`.
  - transaction d'une autre organisation → `ConflictException` (garde
    `organizationId` dans le `where`).
- [ ] `bank-reconciliation.service.spec.ts` (`ignoreTransaction`) : `unmatched →
  ignored` ; déjà résolue → `ConflictException`.
- [ ] `bank-reconciliation.controller.spec.ts` : `@Roles` = owner/admin/
  accountant_internal, `@OrganizationIdSource("organization")` sur les 4 routes ;
  délégation correcte (params + `user.id`).
- [ ] `app.module.spec.ts` : DI compile avec `BankReconciliationModule`.

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` (aucun dans ce document).
- Tests verts ; coverage trust-api ≥ gate (stmts 90 / branches 92 / functions 79 / lines 90).
- `tsc` + `eslint` propres (trust-api, money-api, db) ; `vitest` money-api + db ;
  `audit-ci` pass (aucune dépendance nouvelle — `@noble/hashes` déjà présent).
- **`PaymentsService.recordBankTransferPayment` et `createPaymentAndApply` non
  modifiés** (diff = 0 sur ces méthodes).
- Aucune donnée sensible loggée : les `rawLabel` / `counterpartyLabel` ne sont
  jamais loggés ; jamais un montant + libellé en clair dans un log.
- Aucun secret hardcodé.
- `dev-code-reviewer` OK ; `dev-security-reviewer` OK ; `dev-domain-model-reviewer` OK.
- `V/` non modifié (ADR-117 reste dans `code/docs/`).

## Risques identifiés & mitigations
- **R1 — faux rapprochement : facture marquée payée à tort.** → Mitigation :
  suggérer-puis-confirmer (jamais d'auto) ; `recordBankTransferPayment` refuse
  déjà un montant > `amountDue` et une facture non payable ; le moteur n'accorde
  `strong` qu'avec montant **exact** + référence ; la correction passe par le
  flux avoir + remboursement existant (documenté runbook).
- **R2 — course : deux `confirm` concurrents sur la même transaction vers des
  factures différentes.** La clé d'idempotence dérivée (`bank-reconciliation:<txId>`)
  renverrait le `Payment` de la 1ʳᵉ facture à la 2ᵉ confirmation. → Mitigation :
  **revendication d'abord** (`updateMany where state: unmatched`), `count 0` →
  409, avant tout appel au paiement.
- **R3 — `recordBankTransferPayment` échoue après la revendication.** → Mitigation :
  `try/catch` qui annule la revendication (`state → unmatched`, champs `resolved`
  nuls) et re-lève ; `matchedPaymentId` n'est posé qu'après succès.
- **R4 — ré-import du même relevé → doublons de transactions → double
  encaissement.** → Mitigation : empreinte `@unique` ; import idempotent
  (`skipDuplicates` / catch P2002) ; même si une transaction est ré-créée par un
  bug, la clé d'idempotence `Payment` reste `bank-reconciliation:<txId>` (un
  `txId` unique).
- **R5 — libellé de virement contenant du PII payeur (nom, NIF).** → Mitigation :
  `rawLabel`/`counterpartyLabel` scopés à l'organisation (RLS standard), jamais
  loggés, jamais exposés hors de l'organisation ; documenté dans la politique de
  rétention (catégorie « transaction bancaire », finalité rapprochement,
  conservation alignée sur le `Payment` — OHADA 10 ans).
- **R6 — la détection d'anomalie cash (G1) se déclenche sur un virement.** →
  Mitigation : le chemin `recordBankTransferPayment` n'appelle PAS
  `detectAndRecordCashAnomaly` (vérifié — commentaire du code : « ce moteur reste
  strictement cash-only »). Ne pas l'ajouter.
- **R7 — `BankTransaction` mutée après coup (montant, libellé) pour maquiller un
  détournement.** → Mitigation : colonnes d'identité immuables (trigger,
  pattern J1/E1) ; `DELETE` interdit ; test d'intégration Postgres réel.

## Séquence de revue
Groupes A→D livrés puis : `dev-code-reviewer` + `dev-security-reviewer`
(sous-agent) + `dev-domain-model-reviewer` (sous-agent) + `dev-resilience-reviewer`
(sous-agent — gestion d'erreur du `confirm` / revendication / annulation) en
parallèle. `dev-architect` **non requis** : pas de nouvelle brique d'infra
(pas de BullMQ, pas d'intégration externe) ; réutilise le chemin C3 et les
patrons établis (contrôleur imbriqué sous `organizations`, `@OrganizationIdSource`,
fonction de matching pure comme `commission-bypass` / `cash-anomaly-detection`,
trigger d'identité comme E1).
