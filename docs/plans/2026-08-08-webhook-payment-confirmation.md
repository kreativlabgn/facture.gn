# Plan : Réception webhook & confirmation automatique de paiement (C2, Phase 2b)

## Contexte facture.gn
- Bounded context : Money Context (`PAYMENT_WEBHOOKS`, ADR-075, nouveau contrôleur) **et** Trust Context (nouvel endpoint de confirmation, `PaymentsService` étendu)
- Persona affecté : toute organisation ayant émis une facture avec lien de paiement (C2 Phase 2a) — sa facture passe automatiquement à `paid`/`partially_paid` sans action manuelle
- Données sensibles manipulées : confirmation d'un mouvement d'argent réel — erreur possible = argent non comptabilisé ou double-compté
- Impact réglementaire : ADR-075 (idempotence webhook), ADR-076 (déjà en place, corrélation via `PaymentProviderAttempt`)

## Problème (en 3 lignes max)

La Phase 2a génère un lien de paiement à l'émission, mais rien ne confirme automatiquement qu'il a été payé — la facture reste `issued` indéfiniment même après paiement réel du client. Sans réception webhook, chaque paiement par lien nécessiterait une vérification manuelle, ce qui contredit la promesse même de l'orchestrateur (ADR-073).

## Solution retenue (en 5 lignes max)

`POST /webhooks/:provider` (money-api, public — l'authentification est la signature du payload, pas un secret partagé) résout le provider par nom, appelle `provider.handleWebhook(rawPayload)` (déjà construit en Phase 1), rejette si `signatureValid` est faux. Dédoublonnage strict par `PAYMENT_WEBHOOKS.@@unique([provider, providerRef])` : une ligne n'est insérée qu'**après** confirmation réussie côté trust-api — un webhook rejoué avant confirmation réussie est donc retraité (jamais un état à moitié traité). Seul `normalizedStatus: "paid"` déclenche un appel **non best-effort** vers `POST /invoices/:id/payments/provider-confirmation` (trust-api, nouveau, authentifié par `InternalAuthGuard` symétrique à la Phase 2a) : si cet appel échoue, `money-api` répond en erreur au fournisseur pour déclencher une **redélivraison** — jamais un échec avalé. `PaymentsService.recordProviderPayment()` réutilise l'incrément atomique déjà corrigé en C1 (extrait en méthode partagée, pas dupliqué), idempotent par `providerRef` (unique et naturel, pas de header client).

## Alternatives écartées

- **Best-effort avec timeout court, comme la Phase 2a** : écarté — la classe de conséquence est différente. Un lien de paiement manquant est récupérable (C18) et sans impact financier ; un paiement confirmé mais jamais enregistré est une perte de traçabilité d'argent réel, silencieuse pour le marchand. Le mécanisme de redélivraison des fournisseurs de webhook (standard de l'industrie) sert de filet de sécurité, sans avoir à construire une file d'attente/retry maison.
- **File d'attente asynchrone (BullMQ/Redis) pour fiabiliser la confirmation** : écarté pour ce plan — même raisonnement que les plans précédents (pas d'infra scaffoldée), et le pattern "redélivraison côté fournisseur + dédoublonnage strict côté nous" atteint la même fiabilité sans nouvelle brique.
- **Machine à états de transition webhook (pending → paid, multi-délivrance)** : écarté — les providers stub ne produisent jamais qu'un seul statut déterministe (`paid`), donc cette complexité n'est motivée par aucun besoin actuel. Le dédoublonnage strict (une ligne = un traitement définitif) suffit ; à réévaluer si les vraies API Djomy/Moneroo (Phase 3, hors scope) envoient effectivement des transitions de statut.
- **Vraie vérification de signature HMAC dès maintenant** : écarté — même limite que tout le reste de l'orchestrateur, aucune credential/algorithme réel disponible. Le code **gate** correctement sur `signatureValid` (déjà posé en Phase 1 avec un avertissement explicite sur le stub), prêt pour la vraie implémentation sans changer les appelants.

## Découpage en tâches bite-sized (2–5 min chacune)

- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — enum `WebhookNormalizedStatus` (paid/failed/pending), modèle `PaymentWebhook` (id, provider [réutilise `PaymentProviderName`], providerRef, payload Json, normalizedStatus, signatureValid, processedAt, createdAt), `@@unique([provider, providerRef])`
- [ ] Tâche 2 : migration Prisma (même procédure manuelle)
- [ ] Tâche 3 : `apps/money-api/src/payment-orchestrator/provider-resolver.service.ts` — résout un `PaymentProvider` par son nom (`PaymentProviderName`), réutilise les tokens `DJOMY_PROVIDER`/`MONEROO_PROVIDER` déjà câblés
- [ ] Tâche 4 : `apps/trust-api/src/common/internal-auth.guard.ts` — nouveau, mirroir exact de celui de money-api (même secret `MONEY_API_INTERNAL_KEY`, même comparaison à temps constant)
- [ ] Tâche 5 : `apps/trust-api/src/payments/dto/confirm-provider-payment.dto.ts` — schéma Zod : `amountGnf`, `provider`, `providerRef`, `feeGatewayGnf`
- [ ] Tâche 6 : `apps/trust-api/src/payments/payments.service.ts` — extraire `applyPaymentToInvoice()` (incrément atomique + statut, logique déjà correcte de C1) en méthode privée partagée ; nouvelle méthode `recordProviderPayment()` (idempotence par `providerRef`, `method: "payment_link"`, `platformFeeAmount`/`gatewayFeeAmount` non nuls)
- [ ] Tâche 7 : `apps/trust-api/src/payments/payments.controller.ts` — `POST /invoices/:id/payments/provider-confirmation`, `@Public()` + `@UseGuards(InternalAuthGuard)` (jamais de rôle humain — appel machine-à-machine)
- [ ] Tâche 8 : `apps/money-api/src/webhooks/payment-confirmation-client.ts` — appelle trust-api, timeout généreux (pas agressif comme Phase 2a — on **veut** attendre la confirmation), ne catch jamais silencieusement (laisse l'appelant décider de la redélivraison)
- [ ] Tâche 9 : `apps/money-api/src/webhooks/webhooks.service.ts` — `handleIncomingWebhook(provider, rawPayload)` : résout le provider, appelle `handleWebhook()`, rejette si signature invalide, dédoublonne via lookup `PaymentWebhook` existant, corrèle via `PaymentProviderAttempt` (par `providerRef`), si `paid` → confirme (non best-effort) puis insère `PaymentWebhook` ; si `pending`/`failed` → insère directement pour audit
- [ ] Tâche 10 : `apps/money-api/src/webhooks/webhooks.controller.ts` + `webhooks.module.ts` — `POST /webhooks/:provider`, **public** (pas d'`InternalAuthGuard` — l'authentification est la signature du payload)
- [ ] Tâche 11 : câblage `app.module.ts` des deux services

## Tests à écrire AVANT le code

- [ ] Test 1 : `payments.service.spec.ts` (étendu) — `recordProviderPayment()` fait passer la facture à `paid`/`partially_paid` selon le montant, réutilisant le même comportement d'incrément atomique déjà testé pour le cash (cumul correct sous deux confirmations successives)
- [ ] Test 2 : `payments.service.spec.ts` — `recordProviderPayment()` est idempotent par `providerRef` (replay renvoie le paiement existant, ne double-crédite jamais)
- [ ] Test 3 : `payments.controller.spec.ts` (nouveau, ou vérification E2E) — la route `provider-confirmation` est bien protégée par `InternalAuthGuard` et marquée `@Public()` (pas de JWT humain requis, mais la clé interne l'est)
- [ ] Test 4 : `webhooks.service.spec.ts` — rejette (signature invalide) sans jamais appeler trust-api ni insérer de ligne `PaymentWebhook`
- [ ] Test 5 : `webhooks.service.spec.ts` — un webhook déjà traité (ligne `PaymentWebhook` existante) est retraité comme un no-op, ne rappelle jamais trust-api une seconde fois
- [ ] Test 6 : `webhooks.service.spec.ts` — `normalizedStatus: "paid"` avec confirmation trust-api réussie → insère la ligne `PaymentWebhook`
- [ ] Test 7 : `webhooks.service.spec.ts` — `normalizedStatus: "paid"` avec échec de confirmation trust-api → **ne insère PAS** la ligne `PaymentWebhook`, propage l'échec (pour que le contrôleur réponde en erreur au fournisseur)
- [ ] Test 8 : `webhooks.service.spec.ts` — `normalizedStatus: "pending"`/`"failed"` → insère directement pour audit, n'appelle jamais trust-api
- [ ] Test 9 : `webhooks.service.spec.ts` — `providerRef` inconnu (aucun `PaymentProviderAttempt` correspondant) → rejeté proprement (400), jamais un 500 brut

## Critères de done

- [ ] Tous les tests verts (`pnpm turbo lint typecheck test`)
- [ ] Migration Prisma appliquée proprement
- [ ] Vérification E2E réelle : émettre une facture (lien généré, Phase 2a), simuler l'appel du webhook stub correspondant → facture passe à `paid`, ligne `PaymentWebhook` visible ; rejouer le même webhook → aucun double crédit ; simuler un échec de confirmation (trust-api indisponible) → `money-api` répond en erreur, aucune ligne `PaymentWebhook` insérée
- [ ] Aucune régression sur `trust-api` (C1, Phase 2a) ni `money-api` (Phase 1)
- [ ] `dev-code-reviewer` puis `dev-security-reviewer` passés sur le diff

## Risques identifiés & mitigations

- Risque 1 : double crédit si le dédoublonnage échoue sous webhooks concurrents (même `providerRef` livré deux fois quasi simultanément) → mitigation : `@@unique([provider, providerRef])` en base, filet de sécurité identique au pattern déjà éprouvé (C1, idempotency_key) — une course concurrente échoue au niveau DB, pas seulement au niveau applicatif
- Risque 2 : la logique d'incrément atomique dupliquée entre `recordCashPayment()` et `recordProviderPayment()` dérive avec le temps (le bug C1 corrigé une fois pourrait être réintroduit dans le second chemin) → mitigation : extraction en méthode privée partagée `applyPaymentToInvoice()`, un seul endroit à maintenir
- Risque 3 : `money-api` down au moment où un webhook `paid` arrive → mitigation : c'est le comportement voulu que le fournisseur redélivre — le contrôleur webhook lui-même doit être joignable indépendamment de trust-api (money-api ne dépend pas de trust-api pour RECEVOIR le webhook, seulement pour le CONFIRMER)
- Risque 4 : `trust-api` down au moment de la confirmation → mitigation : c'est exactement le scénario du Risque architectural du brainstorm — erreur propagée, pas de ligne `PaymentWebhook` insérée, redélivraison attendue

## Vérification bout-en-bout prévue

Émettre une facture avec lien Djomy généré (Phase 2a). Appeler manuellement `POST /webhooks/djomy` avec un payload `{provider_ref: "<ref de la facture>"}` → facture passe à `paid`. Rejouer le même appel → toujours `paid`, pas de second `Payment` créé. Arrêter `trust-api`, appeler le webhook d'une autre facture → `money-api` répond en erreur, `PAYMENT_WEBHOOKS` ne contient aucune ligne pour cette facture ; redémarrer `trust-api`, rejouer le même webhook → cette fois la confirmation réussit.
