# Plan : Lot J2 — Droits des personnes (Loi L/2016/037/AN)

> **Plan figé** (snapshot de conception). Deux décisions ont évolué en revue et
> sont portées par `docs/architecture/adr-e2-data-rights.md` (ADR-116), qui fait
> foi : `subject_phone_hash` = **HMAC keyed** (pas SHA-256 nu) et **nullable** ;
> l'enum `DataRightsRequestOutcome` n'a **pas** de valeur `refused_legal_retention`
> (`completed | partial | failed`).

## Contexte projet
- **Module** : Platform Context (RBAC & audit) + Trust Context (données `Customer`/`User`). Nouveau sous-module `apps/trust-api/src/data-rights/`.
- **Persona affecté** : le particulier (client d'une PME, **sans compte facture.gn** le plus souvent) ; l'owner/admin de la PME qui traite la demande pour son client ; un rôle **ops plateforme** (clé interne dédiée) pour les cas transverses multi-organisations.
- **Données sensibles manipulées** : nom / téléphone / NIF de particuliers (`Customer`), nom / téléphones (`User`), `invoice_event.actor_id` (UUID pseudonyme). → `dev-security-reviewer` **et** `dev-domain-model-reviewer` obligatoires avant merge.
- **Impact réglementaire** : Loi **L/2016/037/AN** (protection des données — droits d'accès, de rectification, d'effacement, d'opposition) ; **OHADA/SYSCOHADA Article 23** + **Loi L/2021/024/AN** (LBC/FT) = obligations de conservation qui **limitent** le droit à l'effacement ; agrément **PDP visé Q3 2027** (ce lot doit produire le registre défendable devant le régulateur).

## Clarifications
- Q (périmètre) : **Accès (export) + anonymisation `Customer` + politique de rétention formelle (ADR-116)**. Rectification & opposition → documentées comme état des lieux + gap dans la politique, pas d'endpoint dans ce lot (il n'existe aujourd'hui aucun endpoint de rectification `Customer` — gap pré-existant).
- Q (tension append-only J1/E1) : **anonymisation en place sur les tables mutables** (`Customer`, `User`) via colonnes tombstone + `anonymizedAt`. `invoice` / `invoice_event` / `merkle_anchor_batch` = **hors périmètre d'effacement** au titre de la conservation légale, documenté dans la politique. `invoice_event.actor_id` reste (UUID pseudonyme pointant vers un `User` désormais anonymisé). **Jamais de `DISABLE TRIGGER`.**
- Q (déclencheur / identité) : **owner/admin de la PME** (`POST /customers/:id/anonymize`, `@OrganizationIdSource("customer")`, même trio que `merge()`) + **chemin ops plateforme** (`POST /internal/data-rights/*`, guard `DATA_RIGHTS_INTERNAL_KEY` — même précédent que `DGI_VERIFICATION_INTERNAL_KEY` / `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY`).
- Q (`Customer.phone` à l'anonymisation) : **`phone` → `null`**. Le portail client (`ClientPortalOtpService` / `ClientPortalService`, lookup `where: { phone }`) ne retrouve plus la personne — cohérent avec l'effacement, aucun changement de code portail nécessaire (un `null` ne matche jamais). Ligne `Customer` conservée pour l'intégrité des factures.

## Problème (3 lignes)
facture.gn traite des données personnelles de particuliers (clients d'une PME, souvent sans compte) sans aucun mécanisme pour honorer les droits de la Loi L/2016/037 : impossible de répondre de façon traçable à « quelles données avez-vous sur moi », « anonymisez-moi ». La dimension benchmark J « droits des personnes » est à 0. Les triggers append-only J1/E1 rendent une partie des données non-modifiables en place — il faut trancher la composition droits / conservation légale **avant** de coder.

## Solution retenue (5 lignes)
Quatre livrables : **(A)** une politique de rétention formelle par finalité + ADR-116 + runbook ops (le livrable que J1/J3 ont explicitement reporté ici) ; **(B)** un registre `DataRightsRequest` **append-only** (trigger, pattern J1) — la preuve opposable au régulateur PDP ; **(C)** le **droit d'accès** : un service qui assemble le dossier PII d'une personne (résolue par téléphone) en JSON structuré, scopé à l'organisation de l'appelant PME ou transverse pour l'ops ; **(D)** l'**anonymisation `Customer`** : tombstone des colonnes PII + `anonymizedAt`, avec distinction **anonymisation complète** (aucune facture conservée) vs **partielle** (factures sous conservation OHADA → on efface le contact `phone`/`creditLimit`/`possibleDuplicateOf` mais on **garde `name` + `nif`** requis par la facture légale, avec date d'échéance de conservation enregistrée).

## Alternatives écartées
- **`DISABLE TRIGGER` supervisé pour purge réelle des tables immuables** — écarté pour ce lot : contredit frontalement J1/E1 (à peine mergés), aucune obligation légale n'exige la destruction avant échéance de conservation, et la procédure de « bris de glace » ouvre un vecteur d'altération de la preuve. Reste une option documentée dans la politique pour l'après-échéance (10 ans), pas construite.
- **Crypto-erasure** (chiffrer les PII au repos, jeter la clé) — écarté : chantier transverse (toucher tous les points d'écriture `Customer`/`User`, gestion de clés par sujet), disproportionné pour le volume réel et l'échéance.
- **Compensating event dans `invoice_event`** — écarté : `InvoiceEventType` est indexé sur une facture, l'anonymisation d'un `Customer` n'est pas un événement de facture. Le registre `DataRightsRequest` dédié est le bon niveau.
- **Nouveau rôle RBAC `privacy_officer`** — écarté (YAGNI) : owner/admin PME + clé ops interne couvrent les deux chemins réels sans ajouter un 8ᵉ `OrganizationRole` à faire vivre.
- **Refuser toute anonymisation dès qu'une facture existe** — écarté : légalement trop conservateur (la facture n'a pas besoin du `phone` ni de la limite de crédit du client) et sans valeur démontrable. L'anonymisation partielle est plus juste et plus défendable.

## Découpage en tâches bite-sized

### Groupe A — Politique de rétention + ADR + runbook (doc, aucun code) — livrable reporté par J1/J3
- [ ] [P] A1 : créer `docs/compliance/data-retention-policy.md` — tableau par **finalité** : catégorie de données (identité client, contact, fiscal, événements, sessions, tokens…), finalité du traitement, base légale (L/2016/037 / OHADA Art. 23 / L/2021/024 / contrat), durée de conservation, **ce que l'effacement atteint / n'atteint pas** et pourquoi. Inclut l'état des lieux rectification (aucun endpoint `Customer` aujourd'hui — gap) et opposition (`notificationChannel` partiel — gap).
- [ ] [P] A2 : créer `docs/architecture/adr-e2-data-rights.md` (**ADR-116 provisoire** — même convention que ADR-114/115, `V/` sale) : décision anonymisation-en-place + exclusion légale documentée + registre append-only + les deux chemins (PME / ops). Alternatives écartées reprises de ce plan.
- [ ] [P] A3 : créer `docs/runbooks/data-rights.md` — procédure ops : (1) traiter une demande d'accès (PME vs transverse) ; (2) traiter une demande d'anonymisation ; (3) cas multi-organisations ; (4) demande portant sur un `User` (compte) — renvoyée au support, hors scope de ce lot ; (5) lire le registre `DataRightsRequest`.
- [ ] [P] A4 : `docs/runbooks/rls-rollout.md` — note : `data_rights_request` est cross-organisation (`organization_id` nullable pour l'ops), **hors politique RLS** (comme `merkle_anchor_batch` / `payment_webhook`).

### Groupe B — Registre `DataRightsRequest` (append-only) — testable/livrable seul
- [ ] B1 : `packages/db/prisma/schema.prisma` — `model DataRightsRequest` : `id`, `kind DataRightsRequestKind`, `outcome DataRightsRequestOutcome`, `subjectPhoneHash String` (SHA-256 du msisdn normalisé — jamais le numéro en clair dans le registre), `requestedByUserId String?` (null = ops), `viaOps Boolean @default(false)`, `organizationId String?` (null = transverse), `affectedCustomerIds String[]`, `note String?`, `createdAt`. Enums `DataRightsRequestKind { access anonymization }`, `DataRightsRequestOutcome { completed partial refused_legal_retention failed }`. `@@index([subjectPhoneHash])`. `@@map("data_rights_request")`.
- [ ] B2 : migration manuelle `packages/db/prisma/migrations/<ts>_data_rights_request/migration.sql` — `CREATE TYPE` × 2, `CREATE TABLE`, index, **fonction plpgsql `reject_data_rights_request_mutation()` + trigger `BEFORE UPDATE OR DELETE FOR EACH ROW`** (`LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`, `ERRCODE = 'restrict_violation'`, `CREATE OR REPLACE TRIGGER`) — copie exacte du pattern `20260830120000_invoice_event_append_only`. TRUNCATE non couvert (reset CI, cohérent avec J1).
- [ ] B3 : `pnpm --filter @facture-gn/db db:generate && build`.
- [ ] B4 : `packages/db/src/data-rights-request-append-only.integration.spec.ts` — gated `DATABASE_URL` (pattern `invoice-event-append-only.integration.spec.ts`) : INSERT OK, UPDATE rejeté, DELETE rejeté.

### Groupe C — Droit d'accès (export du dossier PII) — testable/livrable seul
- [ ] C1 : `apps/trust-api/src/data-rights/subject-data.ts` (pur) — `normalizeMsisdn(raw): string` + `hashMsisdn(msisdn): string` (SHA-256 hex, `@noble/hashes` déjà présent) + type `SubjectDataExport`.
- [ ] C2 : `apps/trust-api/src/data-rights/data-rights.service.ts` — `exportSubjectData({ phone, organizationId | null }): Promise<SubjectDataExport>` : résout les `Customer` par `phone` normalisé (filtré à `organizationId` si PME, tous sinon), assemble pour chacun : champs `Customer` (hors `possibleDuplicateOf`), la liste de **ses factures** en métadonnées non-PII (`number`, `certificationId`, `documentType`, `status`, `issuedAt`, `totalTtc`, `disputeStatus` — jamais les lignes, qui appartiennent à la PME), le `PublicBuyerAccount` lié le cas échéant. Ajoute le compte `User`/`UserPhone` **si** le msisdn correspond à un `UserPhone` (nom, langue, téléphones, memberships — jamais `passwordHash`/`pinHash`). Écrit un `DataRightsRequest` `kind: access`, `outcome: completed` (ou `failed` si exception). Retourne aussi `{ generatedAt, subjectPhoneHash }`.
- [ ] C3 : `apps/trust-api/src/data-rights/dto/export-subject-data.dto.ts` — Zod `{ phone: string (E.164-ish, non vide) }`.
- [ ] C4 : `apps/trust-api/src/customers/customers.controller.ts` — `POST customers/data-rights/export` `@Roles("owner","admin")` (pas de `@OrganizationIdSource` — `organizationId` vient du JWT de l'appelant), délègue à `DataRightsService.exportSubjectData({ phone, organizationId: <jwt> })`.
- [ ] C5 : `apps/trust-api/src/data-rights/internal-data-rights.controller.ts` — `POST internal/data-rights/export`, `@UseGuards(DataRightsInternalAuthGuard)`, `@Public()` (hors JWT), body `{ phone }` → `exportSubjectData({ phone, organizationId: null })` (transverse).
- [ ] C6 : `apps/trust-api/src/data-rights/data-rights-internal-auth.guard.ts` — copie de `dgi-verification-auth.guard.ts`, secret `DATA_RIGHTS_INTERNAL_KEY`.
- [ ] C7 : `apps/trust-api/src/common/secrets.ts` — déclarer `DATA_RIGHTS_INTERNAL_KEY` (`required: false`, `requiredInProduction: true`, `format: "hexMin32"`, purpose).
- [ ] C8 : `apps/trust-api/src/data-rights/data-rights.module.ts` — providers `DataRightsService`, 2 contrôleurs, guard. Importé dans `app.module.ts` après `RetentionModule`/`MerkleAnchorModule`.
- [ ] C9 : `.env.example` / `docker-compose.yml` / `.github/workflows/ci.yml` / `app.module.spec.ts` `TEST_ENV` — `DATA_RIGHTS_INTERNAL_KEY` (valeur de test hex).

### Groupe D — Anonymisation `Customer` — testable/livrable seul
- [ ] D1 : `packages/db/prisma/schema.prisma` — `Customer.anonymizedAt DateTime? @map("anonymized_at")`. Migration `<ts>_customer_anonymized_at/migration.sql` : `ALTER TABLE "customer" ADD COLUMN "anonymized_at" TIMESTAMP(3);` + `CREATE INDEX` sur `anonymized_at` (partiel `WHERE anonymized_at IS NOT NULL` — audit rapide). `db:generate && build`.
- [ ] D2 : `apps/trust-api/src/data-rights/anonymization.ts` (pur) — `CUSTOMER_NAME_TOMBSTONE = "Client anonymisé"` ; `retentionExpiryOf(invoices): Date | null` = `max(issuedAt) + 10 ans` sur les factures conservées ; `isRetainedInvoice(inv): boolean` = `documentType === "invoice" && status ∈ {issued, partially_paid, paid, voided}`.
- [ ] D3 : `data-rights.service.ts` — `anonymizeCustomerById(customerId, { requestedByUserId | null, viaOps })` :
  - `$transaction` avec `pg_advisory_xact_lock(hashtext('customer:'||organizationId||':'||phone))` **avant** toute lecture (même clé que `CustomersService.create()` dédup — sérialise contre une création concurrente sur le même téléphone).
  - charge le `Customer` + ses `Invoice` ; si `anonymizedAt != null` → no-op, `outcome: completed`, note « déjà anonymisé ».
  - `retained = invoices.filter(isRetainedInvoice)` :
    - `retained.length === 0` → **anonymisation complète** : `name = TOMBSTONE`, `phone = null`, `nif = null`, `creditLimit = null`, `possibleDuplicateOf = null`, `notificationChannel = sms` (défaut), `anonymizedAt = now`. `outcome: completed`.
    - sinon → **anonymisation partielle** : `phone = null`, `creditLimit = null`, `possibleDuplicateOf = null`, `notificationChannel = sms`, `anonymizedAt = now` ; **`name` et `nif` conservés** (portés par des factures légales). `outcome: partial`, `note` = `"name/nif conservés jusqu'à " + retentionExpiry.toISOString()`.
  - écrit un `DataRightsRequest` `kind: anonymization`, `affectedCustomerIds: [customerId]`, `subjectPhoneHash`, `organizationId`, l'`outcome`.
  - retourne `{ outcome, retentionExpiry, customerId }`.
- [ ] D4 : `data-rights.service.ts` — `anonymizeSubjectByPhone({ phone, organizationId | null, ... })` (chemin ops + réutilisé nulle part ailleurs) : résout tous les `Customer` par `phone` (scopé ou non), applique `anonymizeCustomerById` à chacun, agrège en **un seul** `DataRightsRequest` (`affectedCustomerIds` = tous), `outcome` = `partial` si au moins un partiel, sinon `completed`, `failed` si tous échouent.
- [ ] D5 : `CustomersService.create()` / `importCustomers()` — le `findFirst` de dédoublonnage par téléphone doit **ignorer les lignes `anonymizedAt != null`** (`where: { …, anonymizedAt: null }`) : une personne anonymisée ne doit jamais être « re-matchée » ni réactivée via `possibleDuplicateOf`.
- [ ] D6 : `CustomersService.merge()` / `flagPublicEntity()` / `proposeCreditLimit()` — refuser si `customer.anonymizedAt != null` (`ConflictException` « client anonymisé — opération impossible »). Vérifié tôt.
- [ ] D7 : `customers.controller.ts` — `POST customers/:id/anonymize` `@Roles("owner","admin")` `@OrganizationIdSource("customer")` → `anonymizeCustomerById(id, { requestedByUserId: <jwt.sub>, viaOps: false })`.
- [ ] D8 : `internal-data-rights.controller.ts` — `POST internal/data-rights/anonymize` (guard interne, `@Public()`), body `{ phone }` → `anonymizeSubjectByPhone({ phone, organizationId: null, viaOps: true })`.
- [ ] D9 : `data-rights.module.ts` — importer `CustomersModule` si besoin de `CustomersService`, ou injecter Prisma directement (le service fait ses propres requêtes — préférer Prisma direct, pas de dépendance croisée de module).

## Tests à écrire AVANT le code

### Groupe B
- [ ] `data-rights-request-append-only.integration.spec.ts` (gated) : INSERT accepté ; `UPDATE … SET note` rejeté `restrict_violation` ; `DELETE` rejeté.

### Groupe C
- [ ] `subject-data.spec.ts` : `normalizeMsisdn` (`+224 620 00 11 22` / `224620001122` / `0620001122` → forme canonique unique) ; `hashMsisdn` déterministe, 64 hex, jamais le numéro en clair.
- [ ] `data-rights.service.spec.ts` (export) :
  - assemble le dossier d'un `Customer` connu (champs client + métadonnées factures sans lignes) ;
  - **scope PME** : `organizationId` fixé → ne renvoie QUE les `Customer` de cette organisation même si le même téléphone existe ailleurs ;
  - **scope ops** : `organizationId: null` → renvoie les `Customer` de toutes les organisations ;
  - inclut le bloc `User`/`UserPhone` quand le msisdn est un compte, **jamais** `passwordHash`/`pinHash` ;
  - écrit un `DataRightsRequest` `kind: access`, `outcome: completed`, `subjectPhoneHash` = hash(msisdn), `requestedByUserId` renseigné (PME) / null (ops).
- [ ] `internal-data-rights.controller` : 401 sans header / mauvaise clé ; 200 avec `DATA_RIGHTS_INTERNAL_KEY`.
- [ ] RBAC : `cashier` / `field_agent` → 403 sur `POST customers/data-rights/export`.

### Groupe D
- [ ] `anonymization.spec.ts` : `isRetainedInvoice` (draft / proforma / quote → false ; issued / paid / voided → true) ; `retentionExpiryOf` = max(issuedAt)+10 ans.
- [ ] `data-rights.service.spec.ts` (anonymize) :
  - **aucune facture conservée** → `name = "Client anonymisé"`, `phone/nif/creditLimit/possibleDuplicateOf` nuls, `anonymizedAt` posé, `outcome: completed` ;
  - **≥1 facture `issued`** → `phone/creditLimit/possibleDuplicateOf` nuls MAIS `name` + `nif` **conservés**, `outcome: partial`, `note` porte l'échéance = max(issuedAt)+10 ans ;
  - **idempotence** : ré-appeler sur un `Customer` déjà `anonymizedAt` → no-op, `outcome: completed`, aucune 2ᵉ écriture de PII ;
  - `DataRightsRequest` écrit avec `affectedCustomerIds` correct ;
  - **dédoublonnage** : `CustomersService.create()` avec le téléphone d'un `Customer` anonymisé → nouvelle ligne, **`possibleDuplicateOf` = null** (la ligne anonymisée est ignorée) ;
  - `merge()` / `flagPublicEntity()` / `proposeCreditLimit()` sur un `Customer` anonymisé → `ConflictException` ;
  - **concurrence** : deux `anonymizeCustomerById` concurrents (advisory lock) → une seule écriture effective, pas de corruption ;
  - **ops par téléphone** : `anonymizeSubjectByPhone` transverse anonymise 2 `Customer` de 2 organisations, un seul `DataRightsRequest` `outcome: partial`.
- [ ] `app.module.spec.ts` : le graphe DI compile avec `DataRightsModule` (+ `DATA_RIGHTS_INTERNAL_KEY` dans `TEST_ENV`).

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant (aucun dans ce document).
- Tous les tests verts ; coverage trust-api ≥ gate (stmts 90 / branches 92 / functions 79 / lines 90).
- `tsc` + `eslint` propres (trust-api, money-api, db) ; `vitest` money-api + db ; `audit-ci` pass (aucune dépendance nouvelle — `@noble/hashes` déjà là).
- Aucune donnée sensible loggée : le registre ne stocke que `subjectPhoneHash`, jamais le numéro ; l'export n'est jamais loggé ; jamais `passwordHash`/`pinHash`/`encryptedPrivateKey` dans une réponse.
- Aucun secret hardcodé ; `DATA_RIGHTS_INTERNAL_KEY` via `secrets.ts`.
- `dev-code-reviewer` OK ; `dev-security-reviewer` OK ; `dev-domain-model-reviewer` OK.
- `V/` **non modifié** (ADR-116 reste dans `code/docs/` — `V/` sale).

## Risques identifiés & mitigations
- **R1 — anonymisation partielle jugée non conforme** (garder `name`/`nif` alors que la personne demande l'effacement). → Mitigation : c'est le compromis standard « effacement vs obligation légale de conservation » ; la politique (A1) et l'ADR (A2) le motivent explicitement (facture légale OHADA, échéance 10 ans enregistrée) ; l'échéance est stockée dans `DataRightsRequest.note` → une purge post-échéance est possible plus tard.
- **R2 — course anonymisation / création de client sur le même téléphone** (le portail client ou un import recrée la personne juste après). → Mitigation : `pg_advisory_xact_lock` sur la même clé que `CustomersService.create()` (précédent E3) ; D5 exclut les lignes anonymisées du dédoublonnage.
- **R3 — le chemin ops interne devient un vecteur d'exfiltration** (export transverse de toutes les PII plateforme via une clé). → Mitigation : secret strictement dédié (`secrets.ts`, `requiredInProduction`), `@Public()` mais derrière le guard, chaque appel trace un `DataRightsRequest` immuable (`viaOps: true`, `requestedByUserId: null`) ; runbook A3 encadre l'usage.
- **R4 — casser le portail client / le dédoublonnage / la certification**. → Mitigation : `phone → null` n'impacte aucun lookup (`where: { phone }` ne matche jamais `null`) ; `invoice.hash` / `invoice_event` / `certificationId` **jamais touchés** (le service n'écrit que sur `customer`) ; suite `client-portal` + `invoices` + `verification` rejouée en non-régression.
- **R5 — `Customer.name` NOT NULL**. → Mitigation : tombstone `"Client anonymisé"`, jamais `null` ; test dédié.
- **R6 — `DataRightsRequest` non chaîné / falsifiable par `facture_app` (INSERT libre)**. → Même limite déjà documentée pour `invoice_event` (J1) : le trigger empêche l'altération/suppression, pas l'injection d'une ligne forgée. Hors scope (chantier hash-chaining commun avec J1) — noté dans l'ADR.

## Séquence de revue
Groupes A→D livrés puis : `dev-code-reviewer` + `dev-security-reviewer` (sous-agent) + `dev-domain-model-reviewer` (sous-agent) en parallèle. `dev-architect` **non requis** : pas de nouvelle brique d'infra (pas de BullMQ, pas de seam externe) — un sous-module CRUD + un registre append-only qui réutilisent des patterns déjà établis (J1 trigger, guards internes, advisory lock E3).
