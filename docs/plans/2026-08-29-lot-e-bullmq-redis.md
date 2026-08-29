# Plan : Lot E — BullMQ + Redis (brique de traitement asynchrone durable)

## Contexte projet
- Module : **Money Context** (`apps/money-api`) — c'est là que vit l'orchestration de paiement. Nouvelle infra transverse (Redis). `packages/db` inchangé (aucune migration).
- Persona : indirect — un payeur (Mobile Money) dont le webhook s'est perdu ; l'organisation qui attend que sa facture passe `paid`.
- Données sensibles : montants GNF, `providerRef` (déjà manipulés par money-api). Aucune nouvelle. Redis ne stocke que des métadonnées de job (id de tentative, pas de secret).
- Impact réglementaire : positif — ferme la boucle « le client a payé mais la facture n'est pas à jour », le pire scénario de confiance (LBC/FT : une réconciliation active trace ce qu'un webhook perdu masquerait).

## Décision de périmètre (validée par l'utilisateur : « Lot E »)
Le DAT spécifie « Redis 7 + BullMQ ». Plusieurs besoins descopés faute de queue (rappels I2, rétention, payout, revenue share). **Lot E ne construit qu'UN worker réel** — la **réconciliation des paiements** (le plus haute valeur : argent réel non tracé) — et **pose le pattern** (module queue, connexion Redis, job répétable, processeur mince) pour que les autres suivent sans refaire l'infra.

## Clarifications
- Q : un service worker dédié (`apps/worker`) ou BullMQ dans money-api ? → R : **dans money-api** — la réconciliation a besoin du `ProviderResolverService`, du `PaymentConfirmationClient` et de Prisma, tous déjà là. Un `apps/worker` séparé (bon long terme) est une décision d'archi distincte, hors Lot E.
- Q : la logique de réconciliation dans le processeur BullMQ ? → R : **non** — logique dans `ReconciliationService` (injectable pur, Prisma/provider/client mockables), le `@Processor` est un wrapper de 3 lignes. Testabilité maximale, couplage BullMQ minimal.
- Q : idempotence de la confirmation depuis la réconciliation ? → R : **déjà garantie** — `recordProviderPayment()` utilise `providerRef` comme `Payment.idempotencyKey @unique` (ADR-076). Une course réconciliation × webhook est résolue par la contrainte unique, jamais un double paiement.
- Q : fréquence ? → R : job répétable toutes les **5 minutes** ; ne traite que les `PaymentProviderAttempt` `pending`/`timeout` créés il y a **> 1 h** (laisse le webhook normal faire son travail d'abord).
- Q : docker-compose ? → R : `docker-compose.yml` **minimal** (postgres + redis, infra dev) — un compose complet avec les 3 apps est benchmark I1 (Vague 2). CI : ajouter un service `redis`.

## Découpage

### Groupe 1 — Infra & dépendances
- [ ] T1 : `apps/money-api/package.json` — `bullmq`, `@nestjs/bullmq`, `ioredis`.
- [ ] T2 : `docker-compose.yml` (racine) — `postgres:16` + `redis:7-alpine`, volumes nommés, ports 5432/6379. Le README documente `docker compose up -d` comme alternative au Postgres portable.
- [ ] T3 : `.github/workflows/ci.yml` — service `redis:7-alpine` dans le job `build` + `REDIS_URL` env.
- [ ] T4 : `apps/money-api/.env.example` — `REDIS_URL="redis://localhost:6379"` + `RECONCILIATION_ENABLED` (défaut `true`) + `RECONCILIATION_STALE_MINUTES` (défaut 60).

### Groupe 2 — Module queue
- [ ] T5 : `apps/money-api/src/queue/queue.config.ts` — `buildRedisConnection()` pur : `{ url: process.env.REDIS_URL ?? "redis://localhost:6379", maxRetriesPerRequest: null, lazyConnect: true }` (lazyConnect : le smoke test DI compile sans Redis) + spec.
- [ ] T6 : `apps/money-api/src/queue/queue.module.ts` — `BullModule.forRootAsync` avec la connexion ; `@Global`.

### Groupe 3 — Réconciliation (logique pure)
- [ ] T7 : `apps/money-api/src/reconciliation/reconciliation.service.ts` — `runOnce(): Promise<ReconciliationSummary>` :
  - `paymentProviderAttempt.findMany({ where: { status: { in: ["pending","timeout"] }, createdAt: { lt: now - staleMinutes }, providerRef: { not: null } } })` ;
  - par tentative : `provider = providerResolver.resolve(attempt.provider)` (null → `skipped++`, log) ; `result = await provider.verifyTransaction(attempt.providerRef)` ;
    - `success` → `paymentProviderAttempt.update({ status: "success", settledAt })` puis `confirmationClient.confirm({ invoiceId, amountGnf, provider, providerRef, feeGatewayGnf })` (`confirmed++`) ; un échec de `confirm()` est **loggé et compté** (`confirmFailed++`), jamais avalé silencieusement, jamais bloquant pour les autres tentatives ;
    - `failed` → `update({ status: "failed" })` (`failed++`) ;
    - `pending` → rien (`stillPending++`).
  - Retourne le résumé (jamais `throw` sur une tentative isolée — une API provider en panne ne doit pas bloquer les autres).
- [ ] T8 : `reconciliation.service.spec.ts` — les 4 branches + provider inconnu + `confirm()` qui échoue (compté, pas propagé) + tentative récente ignorée + `providerRef` null ignoré.

### Groupe 4 — Processeur BullMQ
- [ ] T9 : `reconciliation.processor.ts` — `@Processor("reconciliation")` `process()` → `this.reconciliationService.runOnce()` ; log du résumé. Spec : délègue et retourne le résumé.
- [ ] T10 : `reconciliation.module.ts` — `BullModule.registerQueue({ name: "reconciliation" })` ; `onModuleInit` ajoute un job répétable `every: 5min` (idempotent — `jobId` fixe) SI `RECONCILIATION_ENABLED !== "false"`. Providers : `ReconciliationService`, `ReconciliationProcessor`. Importe `PaymentOrchestratorModule` (resolver) + `WebhooksModule` (confirmation client) ou re-déclare.
- [ ] T11 : `app.module.ts` (money-api) — importe `QueueModule` + `ReconciliationModule`.

### Groupe 5 — Smoke DI money-api
- [ ] T12 : `apps/money-api/src/app.module.spec.ts` — compile l'AppModule (`lazyConnect` → pas de Redis requis), `PRISMA_CLIENT` mocké. Garde contre un câblage BullMQ/DI cassé (même valeur que le smoke trust-api ajouté en Lot A).

## Tests AVANT le code
- [ ] `queue.config.spec.ts` : `REDIS_URL` respecté / défaut ; `lazyConnect: true`, `maxRetriesPerRequest: null`.
- [ ] `reconciliation.service.spec.ts` : voir T8 (le cœur — ~8 cas).
- [ ] `reconciliation.processor.spec.ts` : `process()` appelle `runOnce()` et retourne le résumé.
- [ ] `app.module.spec.ts` : compile.

## Critères de done
- `pnpm turbo lint typecheck test` vert (trust-api inchangé ; money-api + coverage)
- `app.module.spec.ts` (trust-api ET money-api) vert
- CI : le job `build` a un service `redis` ; la CI reste verte
- `docker-compose.yml` valide (`docker compose config`)
- Aucun secret dans `docker-compose.yml` (mots de passe dev triviaux, cohérent avec `.env.example` existant)
- La réconciliation ne peut JAMAIS produire un double paiement (idempotence `providerRef`, tracée dans un test)
- Un échec d'API provider ou de `confirm()` sur une tentative n'interrompt jamais le traitement des autres (testé)
- `dev-code-reviewer` OK · `dev-resilience-reviewer` OK (worker qui touche de l'argent : zéro échec silencieux, tout compté/loggé) · `dev-security-reviewer` OK (nouvelle surface : Redis — vérifier qu'aucune donnée sensible n'y transite, que `REDIS_URL` n'est pas loggée)

## Risques & mitigations
- **R1 — le smoke DI money-api exige Redis** : `lazyConnect: true` dans la connexion → `BullModule`/`Queue` se construisent sans connecter. `moduleRef.close()` nettoie.
- **R2 — job répétable dupliqué à chaque redémarrage** : `jobId` fixe + `BullMQ` dédoublonne les repeatables par clé — `upsertJobScheduler`/`add` avec `repeat` + `jobId` stable. Testé au niveau `onModuleInit` (mock queue).
- **R3 — réconciliation × webhook : double confirmation** : `Payment.idempotencyKey = providerRef` (unique) → la 2ᵉ `confirm()` renvoie le paiement existant. Test dédié (mock `confirm()` qui simule un 409 idempotent → compté comme `confirmed`, pas `confirmFailed`).
- **R4 — une API provider lente bloque le job entier** : `verifyTransaction` par tentative dans une boucle `for…of` séquentielle avec `try/catch` par itération — une tentative en erreur est comptée `skipped`/`errored` et on continue. Pas de `Promise.all` (une rejection tuerait le lot). Accepté : un lot lent finit au prochain tick.
- **R5 — Redis indisponible en prod** : `maxRetriesPerRequest: null` + BullMQ retry natif ; le worker est un *complément* au webhook (chemin nominal), jamais le seul chemin — une panne Redis dégrade la réconciliation, jamais l'encaissement. Documenté.
- **R6 — introduire une dépendance infra** : c'est explicitement la décision (DAT « Redis 7 + BullMQ »). `RECONCILIATION_ENABLED=false` permet de désactiver le worker sans retirer la brique (déploiement progressif).
