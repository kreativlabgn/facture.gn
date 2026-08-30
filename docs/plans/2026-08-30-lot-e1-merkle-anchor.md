# Plan : Lot E1 — Registre Merkle des factures + seam d'ancrage externe (Vague 3)

## Contexte projet
- **Module** : Trust Context — `apps/trust-api/src/certification/` (nouveau sous-module `merkle-anchor/`), `apps/trust-api/src/verification/`, `apps/trust-api/src/queue/` (BullMQ, Lot J3), `packages/db`.
- **Persona affecté** : vérificateur externe d'une facture (`GET /verify/:id`) — gagne une **preuve d'inclusion Merkle**. La PME / l'admin : aucun changement observable.
- **Données sensibles** : uniquement des hashes SHA-256 de factures (déjà publics via `/verify`). Aucun montant, aucun NIF, aucune clé. `dev-security-reviewer` léger.
- **Impact réglementaire** : renforce la preuve d'inaltérabilité (agrément PDP visé 2027). **eIDAS / TSA qualifié RFC 3161 = hors scope** (CdC). ADR-013 (MinIO WORM) et « IPFS + Cloudflare » (DAT) sont des cibles de publication compatibles avec le seam.

## Clarifications
- **Q : Ancre externe Bitcoin maintenant ?** → R : **Non.** Le seul client OpenTimestamps JS (`opentimestamps` 0.4.9) n'est plus maintenu depuis 2022 et dépend de `request`/`request-promise` (dépréciés, CVE runtime) → `audit-ci` bloquerait. Ce lot livre le **mécanisme Merkle + un seam `AnchorSink`** ; l'ancre externe réelle (Bitcoin RPC maintenu, ou IPFS+Cloudflare per DAT) = exploitation, tranchée plus tard. Pattern identique aux Lots K (contrat Cert-Engine) et I (RLS dormante).
- **Q : ADR ?** → R : `code/docs/architecture/adr-e1-merkle-anchor.md` — **ADR-115 provisoire**, porté dans `V/` quand propre.
- **Q (planning) : que contient une tranche ?** → R : les factures dont `issuedAt` est dans l'heure UTC `[H, H+1)`, `hash IS NOT NULL`, `anchorBatchId IS NULL`. Plus un **balayage** des retardataires (`issuedAt < H`, non ancrées) rattachés à la tranche courante (rare ; l'ancre prouve « existait avant T », une tranche légèrement plus tardive reste correcte).
- **Q (planning) : où sont stockées les feuilles ?** → R : **normalisé** — `Invoice.anchorBatchId` (FK, assignée une seule fois par le job de scellement). À la vérification : `SELECT hash FROM invoice WHERE anchor_batch_id = X ORDER BY hash ASC` → reconstruction de l'arbre → chemin d'inclusion. `ORDER BY hash` = ordre déterministe, reproductible par quiconque a les hashes. Pas de duplication des feuilles sur la tranche.
- **Q (planning) : arbre Merkle ?** → R : **RFC 6962** (Certificate Transparency) — feuille `SHA-256(0x00 ‖ hash_brut_32o)`, nœud interne `SHA-256(0x01 ‖ gauche ‖ droite)` (séparation de domaine, anti-second-preimage), nœud impair promu inchangé. Tranche vide (0 facture dans l'heure) → **pas de tranche créée**.

## Problème (3 lignes)
Aujourd'hui « vérifier une facture » = interroger l'API de facture.gn, qui recalcule hash + signature et répond « valide ». Un attaquant contrôlant la base peut ré-signer une facture altérée avec la clé (compromise) de l'organisation **et réécrire toute la chaîne `previousHash`** — la chaîne ne protège que l'ordre relatif *de ce que facture.gn stocke*. Il manque un **engagement compact, périodique, destiné à être ancré hors du contrôle de facture.gn**.

## Solution retenue (5 lignes)
Nouveau `apps/trust-api/src/certification/merkle-anchor/`. Modèle `MerkleAnchorBatch` = **registre horaire append-only de racines Merkle, chaînées** (`previousRoot`), trigger d'immuabilité (pattern J1, sur les colonnes d'identité seulement — les champs de résultat d'ancrage restent write-once-later). Un job BullMQ horaire (`merkle-anchor-seal`, opt-in `MERKLE_ANCHOR_ENABLED`) construit l'arbre RFC 6962 des hashes de l'heure, stocke la racine, l'enchaîne, assigne `Invoice.anchorBatchId`. Un job `merkle-anchor-flush` passe les tranches `pending` au seam `AnchorSink` (`NoopAnchorSink` par défaut → reste `pending` ; futurs sinks Bitcoin/IPFS). `GET /verify/:id` expose la **preuve d'inclusion** (chemin feuille→racine) + l'état de l'ancre externe.

## Alternatives écartées
- **`opentimestamps` npm maintenant** : non maintenu (2022), `request` runtime déprécié → `audit-ci` bloque.
- **Feuilles dupliquées sur la tranche (`leafHashes String[]`)** : ~90 Ko/tranche, ~65 Mo/mois, redondant. `Invoice.anchorBatchId` + `ORDER BY hash` est normalisé et tout aussi vérifiable.
- **Ancrer chaque facture individuellement (OTS par facture)** : ~1 M soumissions/mois, ingérable. La racine horaire couvre ~1400 factures en 32 octets.
- **Ancrer sur Ethereum / smart contract** : gas + wallet + surveillance, disproportionné pour le contexte guinéen frugal.
- **Chaîne de racines signée sur IPFS sans support immédiat** : reste « confiance facture.gn » — le seam permet de le brancher plus tard *avec* un ancrage immédiat.
- **Merkle binaire naïf sans séparation de domaine** : vulnérable au second-preimage (une feuille interprétable comme paire de nœuds). RFC 6962 l'interdit.

## Découpage en tâches

### Groupe 1 — cœur Merkle (fonctions pures, livrable seul, inerte)
- [ ] 1.1 `apps/trust-api/src/certification/merkle-anchor/merkle.ts` — pur, sans I/O :
  - `buildMerkleRoot(leafHashesHex: string[]): string` — RFC 6962, feuilles triées en amont par l'appelant (ou trier ici — à figer).
  - `buildInclusionProof(leafHashesHex: string[], targetHex: string): { siblingHex: string; side: "left" | "right" }[]`
  - `verifyInclusionProof(targetHex: string, proof, rootHex: string): boolean`
  - `leafHash(hex: string): string` (`SHA-256(0x00 ‖ bytes)`), `nodeHash(a, b)` (`SHA-256(0x01 ‖ a ‖ b)`).
  - Rejette : hex non 64 car., liste vide.
- [ ] 1.2 `merkle.spec.ts` — vecteurs connus : 1 feuille (root = leafHash), 2, 3 (impair), 4, 8 feuilles ; `verifyInclusionProof` vrai pour chaque feuille, faux si on altère la cible / un sibling / la racine ; ordre des feuilles déterministe.

### Groupe 2 — modèle + migration (dépend de rien)
- [ ] 2.1 `packages/db/prisma/schema.prisma` — `enum MerkleAnchorStatus { pending anchored failed }` ; `model MerkleAnchorBatch { id, hourStart @unique, merkleRoot, previousRoot, leafCount, anchorStatus @default(pending), anchorProof String?, anchorRef String?, anchoredAt DateTime?, createdAt, invoices Invoice[] }` `@@index([anchorStatus])` ; `Invoice` gagne `anchorBatchId String?` + relation + `@@index([anchorBatchId])`.
- [ ] 2.2 `packages/db/prisma/migrations/20260830150000_merkle_anchor_batch/migration.sql` (manuelle) : `CREATE TYPE`, `CREATE TABLE`, `ADD COLUMN invoice.anchor_batch_id` + FK `ON DELETE SET NULL` + index, **fonction plpgsql + trigger d'immuabilité** `merkle_anchor_batch_identity_immutable` : `BEFORE UPDATE` → `RAISE EXCEPTION` si `NEW.hour_start / merkle_root / previous_root / leaf_count` diffèrent de `OLD` ; `BEFORE DELETE` → `RAISE EXCEPTION`. Les colonnes `anchor_*` / `anchored_at` restent modifiables (write-once-later par le flush).
- [ ] 2.3 `docs/architecture/adr-e1-merkle-anchor.md` — ADR-115 provisoire.
- [ ] 2.4 migration RLS : `MerkleAnchorBatch` est **cross-organisation** (un batch couvre N orgs) → **pas** de politique RLS org (comme `payment_webhook`). Noter dans `rls-rollout.md`.

### Groupe 3 — seam + services (dépend de 1 + 2)
- [ ] 3.1 `merkle-anchor/anchor-sink.ts` — `interface AnchorSink { readonly name: string; anchor(rootHex: string, batchId: string): Promise<AnchorReceipt | null> }` ; `interface AnchorReceipt { proof: string; ref: string; anchoredAt: Date }` ; `NoopAnchorSink` (retourne `null`) ; token DI `ANCHOR_SINK`.
- [ ] 3.2 `merkle-anchor/merkle-anchor-seal.service.ts` — `sealHour(hourStart: Date)` **pur-ish** (Prisma injecté) : `findMany` factures `issuedAt ∈ [H, H+1) OR (issuedAt < H AND anchorBatchId NULL)`, `hash != null`, `anchorBatchId: null`, `orderBy: { hash: "asc" }` ; si 0 → return `{ skipped: true }` ; `previousRoot` = dernière tranche par `hourStart` ou `"GENESIS"` ; `buildMerkleRoot` ; `$transaction` → `create` batch + `updateMany({ where: { id: { in }, anchorBatchId: null }, data: { anchorBatchId } })` (garde `anchorBatchId: null` = idempotence). Catch `P2002` sur `hour_start @unique` → tranche déjà scellée (course) → skip.
- [ ] 3.3 `merkle-anchor/merkle-anchor-flush.service.ts` — `flushPending(limit)` : `findMany` batches `anchorStatus: pending` (les N plus anciens) ; pour chacun `try { receipt = await sink.anchor(root, id) }` (try/catch par tranche, jamais rejette) ; `receipt` → `update` `{ anchorStatus: anchored, anchorProof, anchorRef, anchoredAt }` ; `null` → laisser `pending` ; exception → compteur d'erreurs + log (pas `failed` tout de suite — le sink peut être transitoirement KO).
- [ ] 3.4 `merkle-anchor/merkle-anchor.processor.ts` — deux `@Processor` (`merkle-anchor-seal`, `merkle-anchor-flush`), wrappers minces (log du résumé, throw si tout échoue — pattern J3/C1).
- [ ] 3.5 `merkle-anchor/merkle-anchor.metrics.ts` — `trust_api_merkle_batches_sealed_total`, `trust_api_merkle_invoices_anchored_total`, `trust_api_merkle_flush_errors_total`, gauge `trust_api_merkle_pending_batches`.
- [ ] 3.6 `merkle-anchor/merkle-anchor.module.ts` — `registerQueue` ×2 + providers + `makeCounter/GaugeProvider` + `{ provide: ANCHOR_SINK, useClass: NoopAnchorSink }` + `onModuleInit` : `MERKLE_ANCHOR_ENABLED !== "true"` → warn + gauge 0 + return ; sinon `upsertJobScheduler("merkle-anchor-seal-hourly", { every: 1h })` + `("merkle-anchor-flush", { every: 30min })`, non-bloquant (try/catch), `defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 }`.
- [ ] 3.7 `apps/trust-api/src/app.module.ts` — importer `MerkleAnchorModule` (après `QueueModule`).
- [ ] 3.8 `.github/workflows/ci.yml` — `MERKLE_ANCHOR_ENABLED: "false"` ; `apps/trust-api/src/app.module.spec.ts` — idem `TEST_ENV`.
- [ ] 3.9 `apps/trust-api/.env.example` + `docker-compose.yml` — `MERKLE_ANCHOR_ENABLED`.

### Groupe 4 — extension de la vérification (dépend de 1 + 2)
- [ ] 4.1 `verification.service.ts` — `include: { anchorBatch: true }` ; nouveau champ `anchor` dans `PublicInvoiceVerification` : `null` si `anchorBatchId` null, sinon `{ batchId, hourStart, merkleRoot, previousRoot, leafHash, inclusionProof, externalAnchor: { status, ref, anchoredAt } }`. La preuve est **calculée à la volée** : `findMany({ where: { anchorBatchId }, select: { hash: true }, orderBy: { hash: "asc" } })` → `buildInclusionProof(hashes, invoice.hash)`.
- [ ] 4.2 `verification.service.spec.ts` — facture non ancrée → `anchor: null` ; facture ancrée → `inclusionProof` reconstruit la `merkleRoot` (round-trip `verifyInclusionProof`) ; `externalAnchor.status` reflète `anchorStatus`.
- [ ] 4.3 `verification.controller.spec.ts` — le champ `anchor` passe dans la réponse.

### Groupe 5 — clôture
- [ ] 5.1 `docs/runbooks/merkle-anchor.md` — ce qui est scellé, opt-in, seam `AnchorSink` (comment brancher un sink réel : Bitcoin RPC / IPFS+Cloudflare), observabilité, que faire d'une tranche `failed`, vérification manuelle d'une preuve d'inclusion.
- [ ] 5.2 revalidation : `tsc` + `eslint` + `vitest --coverage` (trust-api), `vitest` (money-api, db), `audit-ci`.

## Tests à écrire AVANT le code
- [ ] `merkle.spec.ts` (Groupe 1) — vecteurs 1/2/3/4/8 feuilles, round-trip preuve, détection d'altération (cible, sibling, racine), déterminisme.
- [ ] `merkle-anchor-seal.service.spec.ts` — 0 facture → skip ; N factures → 1 tranche, racine = `buildMerkleRoot`, `previousRoot` chaîné, `anchorBatchId` assigné, feuilles triées par `hash` ; retardataire (`issuedAt < H`) inclus ; course (`hour_start` P2002) → skip sans throw ; `updateMany` garde `anchorBatchId: null` (idempotence).
- [ ] `merkle-anchor-flush.service.spec.ts` — `NoopAnchorSink` → tranche reste `pending` ; sink renvoyant un receipt → `anchored` + champs remplis ; sink qui throw → tranche inchangée, compteur d'erreurs, pas de rejet ; une tranche KO n'empêche pas les suivantes.
- [ ] `merkle-anchor.module.spec.ts` — `MERKLE_ANCHOR_ENABLED != "true"` → aucun `upsertJobScheduler` ; échec d'armement → `onModuleInit` ne rejette pas.
- [ ] `verification.service.spec.ts` — preuve d'inclusion round-trip ; `anchor: null` si non ancrée.
- [ ] Smoke DI `app.module.spec.ts` — `MerkleAnchorModule` (2 files BullMQ) compile.

## Critères de done
- Aucun `[NEEDS CLARIFICATION]`.
- **`GET /verify/:id` d'une facture existante non ancrée** → `anchor: null`, aucune autre régression (test de garde).
- Colonnes d'identité d'une tranche (`hour_start`, `merkle_root`, `previous_root`, `leaf_count`) **immuables en base** (trigger) ; `DELETE` interdit.
- `Invoice.anchorBatchId` assignée **une seule fois** (garde `anchorBatchId: null` dans l'`updateMany`).
- Job de scellement **idempotent** (rejouer la même heure ne double rien).
- Opt-in `MERKLE_ANCHOR_ENABLED` (défaut off partout), non-bloquant au boot.
- `NoopAnchorSink` par défaut — aucune dépendance externe, aucun appel réseau.
- Tests verts, couverture ≥ seuils, `tsc` + `eslint` + `audit-ci` clean (aucune nouvelle dép).
- `dev-code-reviewer` + `dev-security-reviewer` (hashes, seam, second-preimage) + `dev-domain-model-reviewer` (`MerkleAnchorBatch` — registre append-only, chaînage) OK.

## Risques & mitigations
- **R1 — arbre Merkle non reproductible par un tiers** (ordre des feuilles, séparation de domaine). → RFC 6962 documenté dans l'ADR + le runbook ; ordre `hash ASC` ; vecteurs de test.
- **R2 — retardataires : une facture apparaît après scellement de son heure.** → Le job balaie `issuedAt < H AND anchorBatchId NULL` vers la tranche courante ; documenté (l'ancre prouve « avant T », une tranche plus tardive reste valide).
- **R3 — `Invoice.anchorBatchId` ré-assignée** (2e run) → `updateMany({ where: { anchorBatchId: null } })` ; test.
- **R4 — course sur le scellement d'une heure** → `hour_start @unique` + catch `P2002` → skip.
- **R5 — le trigger d'immuabilité bloque le flush** (qui doit écrire `anchor_status`) → le trigger ne compare QUE les 4 colonnes d'identité, laisse passer les `anchor_*`. Test d'intégration gaté.
- **R6 — RLS (dormante) + table cross-org** → pas de politique RLS sur `merkle_anchor_batch` (comme `payment_webhook`) ; le job de scellement lit les factures de toutes les orgs (client non scopé). Noter au runbook RLS.
- **R7 — la preuve d'inclusion calculée à la volée coûte cher sur `/verify`** (public, potentiellement scrappé) → `findMany` sur `anchor_batch_id` indexé, ~1400 hashes, arbre en mémoire O(n log n) trivial ; pas de cache pour l'instant, à surveiller.
- **R8 — un futur sink réel (Bitcoin RPC) réintroduit une dépendance lourde** → le seam isole ça dans un module optionnel, chargé seulement si `MERKLE_ANCHOR_SINK` le désigne ; `audit-ci` réévalué à ce moment.

## Séquence
1. Groupe 1 (Merkle pur) — livrable seul.
2. Groupe 2 (modèle + migration + ADR).
3. Groupe 3 (seam + jobs) — dépend de 1+2.
4. Groupe 4 (vérification) — dépend de 1+2.
5. Groupe 5 — runbook + clôture.

**Après le PLAN → `dev-architect`** (nouvelle brique d'archi : registre Merkle + seam d'ancrage) pour le blueprint fichier par fichier avant TDD.
