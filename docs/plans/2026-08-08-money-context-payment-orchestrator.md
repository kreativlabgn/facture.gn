# Plan : Money Context — orchestrateur de paiement (C2, Phase 1)

## Contexte facture.gn
- Bounded context : **Money Context** (Squad Money) — nouveau service `apps/money-api`, séparé de `trust-api` (DAT §2 : "services séparés par bounded context, jamais un monolithe — isolation des pannes entre signature cryptographique haute fréquence et orchestration de paiements multi-opérateurs" ; DAT §1 : "Money Mesh — Service Node séparé — isole les pannes Djomy/Moneroo")
- Persona affecté : le payeur (client recevant un lien) et l'organisation émettrice — aucune UI dans ce plan, l'endpoint est appelé côté serveur (trust-api dans une phase future, curl/tests ici)
- Données sensibles manipulées : montants (GNF), futures clés API Djomy/Moneroo (pas encore en jeu — providers stub déterministes pour cette phase, TODO explicite pour le vrai HTTP)
- Impact réglementaire : ADR-072/073/074/076 (orchestration, grille commission, traçabilité par tentative)

## Problème (en 3 lignes max)

Aucun mécanisme n'existe pour générer un lien de paiement Mobile Money : le seul moyen d'encaissement disponible est le cash (C1). Sans orchestrateur multi-provider avec bascule automatique (Djomy primary, Moneroo fallback), le taux d'encaissement à distance ne peut pas décoller pour les ventes en ligne (Parcours Fanta/WhatsApp) — et un provider unique sans fallback expose à un risque de vendor lock-in et de panne totale (R-13).

## Solution retenue (en 5 lignes max)

Nouveau service `apps/money-api` (même stack NestJS/Vitest que `trust-api`, package Prisma partagé `packages/db`). Interface `PaymentProvider` unique (`createPaymentLink`/`verifyTransaction`/`handleWebhook`, ADR-073) implémentée par deux providers **stub déterministes** (`DjomyStubProvider`, `MonerooStubProvider` — même pattern que `StubEd25519CertificationService`, pas de vraies credentials sandbox disponibles). `PaymentProviderRegistry.resolve()` appelle Djomy en premier via un `CircuitBreakerService` à timeout dur 10s ; sur timeout/échec, bascule vers Moneroo avec retry x2. Chaque tentative (Djomy ou Moneroo, succès ou échec) est tracée dans `PaymentProviderAttempt` (ADR-076) pour l'auditabilité complète des bascules. Un endpoint `POST /payment-links` expose ce flux de façon autonome et démontrable — **non encore branché sur `invoices.service.ts.issue()`** (Phase 2, plan séparé).

## Alternatives écartées

- **Tout construire en une seule fois (orchestrateur + wiring trust-api + webhook receiver)** : écarté — trop large pour rester bite-sized, et mélangerait la partie la plus différenciante/risquée (le circuit breaker et la bascule primary→fallback, ADR-073) avec du câblage inter-service qui dépend de décisions non encore tranchées (synchrone bloquant vs événementiel). Prouver l'orchestrateur seul, isolément testable, avant de le brancher.
- **Implémenter le vrai HTTP Djomy/Moneroo dès maintenant** : écarté — aucune credential sandbox disponible dans cet environnement. Le stub garde l'interface `PaymentProvider` stable (mêmes signatures que la version réelle attendra), donc la migration vers le vrai HTTP n'impactera aucun appelant, exactement comme le stub de certification pour le Cert-Engine Rust.
- **Money Context dans le même process que trust-api (juste un nouveau module NestJS)** : écarté — viole directement le principe d'isolation des pannes du DAT §2. Un incident sur l'orchestrateur de paiement (timeout provider, bug de circuit breaker) ne doit jamais pouvoir dégrader la certification de facture, qui est le cœur de confiance du produit.
- **Package Prisma partagé pour `PrismaModule` (éviter la petite duplication entre trust-api et money-api)** : écarté pour ce plan — dupliquer ~15 lignes d'un module NestJS trivial est un moindre mal comparé à l'introduction prématurée d'un nouveau package partagé pour un seul cas d'usage ; à reconsidérer si un 3ᵉ service apparaît avec le même besoin.

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : scaffold `apps/money-api` (package.json, tsconfig.json, nest-cli.json, vitest config implicite via les mêmes devDependencies) — miroir exact de `apps/trust-api`
- [ ] Tâche 2 : `apps/money-api/src/common/prisma.module.ts` — copie du pattern `trust-api` (PRISMA_CLIENT global)
- [ ] Tâche 3 : `packages/db/prisma/schema.prisma` — enums `PaymentProviderName` (djomy/moneroo/orange_direct/mtn_direct), `PaymentProviderAttemptStatus` (pending/success/failed/timeout), modèle `PaymentProviderAttempt` (id, invoiceId, provider, status, providerRef, amountGnf, feeGateway, feePlatform, createdAt, settledAt) — pas de FK stricte vers `Invoice` depuis `money-api` (les deux services partagent la même base mais restent des bounded contexts séparés ; la FK Prisma existe au niveau schéma partagé, cohérent avec le choix déjà fait pour `Payment.invoiceId`)
- [ ] Tâche 4 : migration Prisma (même procédure `migrate diff` + fichier manuel + `migrate deploy`)
- [ ] Tâche 5 : `apps/money-api/src/payment-orchestrator/provider.interface.ts` — interface `PaymentProvider` (ADR-073) : `createPaymentLink(payload): Promise<PaymentLinkResult>`, `verifyTransaction(providerRef): Promise<TransactionStatus>`, `handleWebhook(payload): NormalizedWebhookResult` (signature posée, logique complète différée à la Phase 2)
- [ ] Tâche 6 : `apps/money-api/src/payment-orchestrator/providers/djomy-stub.provider.ts` — stub déterministe, configurable pour simuler un délai (test du circuit breaker), TODO(Djomy réel) explicite référençant ADR-072 (endpoints /confirm_otp, /verify_payment, /webhook)
- [ ] Tâche 7 : `apps/money-api/src/payment-orchestrator/providers/moneroo-stub.provider.ts` — même pattern, fallback
- [ ] Tâche 8 : `apps/money-api/src/payment-orchestrator/circuit-breaker.service.ts` — `callWithTimeout(fn, timeoutMs)` : timeout dur 10 000ms (ADR-073), rejette proprement au-delà (jamais un appel qui pend indéfiniment)
- [ ] Tâche 9 : `apps/money-api/src/payment-orchestrator/provider-registry.service.ts` — `resolve(payload)` : tente Djomy via le circuit breaker ; sur timeout/échec, retry Moneroo x2 (ADR-073) ; enregistre une `PaymentProviderAttempt` par tentative (y compris les échecs, pour l'audit complet des bascules)
- [ ] Tâche 10 : `apps/money-api/src/payment-links/payment-links.service.ts` — `createPaymentLink(invoiceId, organizationId, amountGnf)` : appelle le registry, retourne `{ paymentLinkUrl, provider, providerRef, expiresAt }`
- [ ] Tâche 11 : `apps/money-api/src/payment-links/payment-links.controller.ts` + `payment-links.module.ts` + `app.module.ts` + `main.ts` — `POST /payment-links`, port dédié (`.env` séparé, `PORT` distinct de trust-api)

## Tests à écrire AVANT le code

- [ ] Test 1 : `djomy-stub.provider.spec.ts` — `createPaymentLink()` retourne un lien et une référence déterministes pour un payload donné ; peut être configuré pour simuler un délai artificiel (utilisé par le test du circuit breaker)
- [ ] Test 2 : `circuit-breaker.service.spec.ts` — un appel qui dépasse 10s est rejeté proprement (timeout), un appel sous 10s retourne normalement
- [ ] Test 3 : `provider-registry.service.spec.ts` — `resolve()` retourne le résultat Djomy quand Djomy répond dans les temps
- [ ] Test 4 : `provider-registry.service.spec.ts` — `resolve()` bascule vers Moneroo quand Djomy timeout (>10s simulé), et l'`PaymentProviderAttempt` de Djomy est enregistrée en statut `timeout`
- [ ] Test 5 : `provider-registry.service.spec.ts` — Moneroo est retried x2 avant échec définitif si les deux tentatives échouent
- [ ] Test 6 : `provider-registry.service.spec.ts` — chaque tentative (Djomy ou Moneroo, succès ou échec) produit une ligne `PaymentProviderAttempt`, jamais une tentative silencieuse non tracée
- [ ] Test 7 : `payment-links.service.spec.ts` — `createPaymentLink()` retourne un résultat cohérent avec `fee_gateway`/`fee_platform` renseignés (ADR-074, structure présente même si le calcul exact de la grille 5 paliers reste simplifié à cette phase)

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`)
- [ ] Migration Prisma appliquée proprement, `prisma migrate status` propre
- [ ] Vérification E2E réelle : `apps/money-api` démarre indépendamment de `trust-api`, `POST /payment-links` répond avec un lien Djomy en conditions normales, puis avec un lien Moneroo quand le stub Djomy est configuré pour timeout — les deux tentatives visibles dans `payment_provider_attempt`
- [ ] Aucune régression sur `trust-api` (ce plan ne le touche pas)
- [ ] `dev-code-reviewer` passé sur le diff
- [ ] `dev-architect` consulté avant l'implémentation pour le détail fichier par fichier (nouveau service, décision de structure interne)

## Risques identifiés & mitigations

- Risque 1 : le stub Djomy/Moneroo donne une fausse impression de robustesse (tout marche "trop bien" en dev) → mitigation : TODO explicite et grep-able sur chaque provider stub référençant l'ADR correspondant, tests dédiés au chemin d'échec/timeout (pas seulement le chemin heureux)
- Risque 2 : `POST /payment-links` exposé sans authentification pour cette phase (aucun appelant externe légitime tant que non branché sur trust-api) → mitigation : documenté explicitement comme limite assumée de cette phase, authentification inter-service (API key ou mTLS) à trancher dans le plan de câblage (Phase 2) — jamais exposé publiquement avant cette étape
- Risque 3 : le circuit breaker à 10s pourrait bloquer un test unitaire pendant 10 vraies secondes si mal mocké → mitigation : `CircuitBreakerService` prend un timeout injectable, les tests utilisent des valeurs courtes (ex. 50ms) plutôt que d'attendre 10s réelles
- Risque 4 : dérive entre le schéma Prisma partagé et les deux services qui l'utilisent (money-api pourrait être tenté de modifier des tables appartenant à Trust Context) → mitigation : `PaymentProviderAttempt` reste sous la responsabilité exclusive de money-api pour les écritures ; aucune modification de `Invoice`/`Payment` dans ce plan

## Vérification bout-en-bout prévue

Démarrer `apps/money-api` seul (sans dépendre de `trust-api` en cours d'exécution). `POST /payment-links` avec un `DjomyStubProvider` en mode normal → réponse avec `provider: "djomy"`. Reconfigurer le stub pour simuler un délai > 10s → nouvelle requête → réponse avec `provider: "moneroo"`, et les deux tentatives (djomy timeout + moneroo success) visibles en base via `payment_provider_attempt`.
