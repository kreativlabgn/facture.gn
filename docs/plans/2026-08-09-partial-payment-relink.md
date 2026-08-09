# Plan : Encaisser un paiement partiel (C11, ADR-062)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `payments/` et `invoices/` existants, aucun nouveau module ni modèle
- Persona affecté : organisation qui encaisse un montant inférieur au total dû (Djénabou, Fanta — paiement en plusieurs fois), et son client qui doit pouvoir régler le solde restant en ligne
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : aucun direct

## Investigation préalable
Backlog (texte complet) : "C11 — Encaisser un paiement partiel `[MUST]`. En tant qu'organisation, je veux encaisser un montant inférieur au total dû, afin de refléter la réalité terrain. - Statut passe à partially_paid - **Nouveau lien pour le solde restant**. Réf : ADR-062."

**État déjà construit (session précédente, avant compaction)** : `applyPaymentToInvoice()` (`payments.service.ts:280`) fait déjà transitionner `status` vers `partially_paid` correctement (incréments atomiques race-free, C1) — la première moitié de C11 est déjà couverte, sans le savoir, par l'infrastructure de paiement existante.

**Découverte bloquante : bug latent dans le code déjà mergé (C18)** — `InvoicesService.regeneratePaymentLink()` (`invoices.service.ts:330`, story C18 de cette session) accepte explicitement une facture au statut `partially_paid` (garde ligne 333 : `status !== "issued" && status !== "partially_paid"`), mais génère le lien avec `amountGnf: invoice.totalTtc` (ligne 345) — le montant TOTAL de la facture, **jamais** `invoice.amountDue` (le solde réellement restant). Un client ayant déjà réglé une partie en cash recevrait donc un lien lui demandant de payer le montant TOTAL, pas le solde — double-facturation potentielle. Vérifié par lecture directe : `issue()` (ligne 160) utilise aussi `totalTtc`, mais sans bug là car `amountDue === totalTtc` toujours sur une facture fraîchement émise — la divergence n'apparaît que sur le chemin `partially_paid`, jamais exercé jusqu'ici puisque aucune story précédente n'avait de scénario de paiement partiel + régénération combinés. Ce bug est corrigé dans cette story (Tâche 1), condition préalable à ce que "Nouveau lien pour le solde restant" signifie réellement "solde restant".

## Problème (en 3 lignes max)
Un paiement partiel laisse la facture `partially_paid` avec un solde dû, mais (1) aucun mécanisme n'informe automatiquement le client du nouveau montant à régler, et (2) le mécanisme de régénération existant (C18), s'il était utilisé manuellement ici, générerait un lien pour le mauvais montant (bug).

## Solution retenue (en 5 lignes max)
Tâche 1 (fix) : `regeneratePaymentLink()` utilise désormais `invoice.amountDue` au lieu de `invoice.totalTtc`. Tâche 2 (nouvelle fonctionnalité) : `recordCashPayment()` et `recordBankTransferPayment()` (`payments.service.ts`) déclenchent, en meilleur effort et HORS de la transaction de paiement (même précédent que `detectAndRecordCashAnomaly()`, G1 — un échec de régénération ne doit jamais faire échouer un encaissement déjà légitimement committé), une régénération automatique du lien si l'invoice résultante est `partially_paid`. `recordProviderPayment()` (paiement en ligne) est volontairement exclu : un paiement partiel via lien est un cas marginal, régénérer un lien juste après le webhook de confirmation d'un lien déjà utilisé serait redondant. Trace d'audit : `InvoiceEvent(type: payment_link_regenerated, actorId: null)` — même type d'événement que C18, `actorId: null` signalant une régénération système, pas humaine (même pattern que G1's `suspicious_cash_pattern_detected`).

## Alternatives écartées
Déclencher la régénération aussi sur `recordProviderPayment()` — écartée : un paiement partiel via lien de paiement est un cas marginal (le flux en ligne cible normalement le montant exact dû), régénérer immédiatement après un webhook de confirmation ajouterait un appel Money Context redondant pour un bénéfice limité. Faire échouer le paiement si la régénération échoue — écartée : violerait le principe déjà établi (G1, `PaymentLinkClient.tryGenerate()`) qu'un encaissement légitime ne doit jamais être bloqué par un effet secondaire annexe.

## Découpage en tâches bite-sized
- [ ] Tâche 1 (fix) : `apps/trust-api/src/invoices/invoices.service.ts` — `regeneratePaymentLink()` : `amountGnf: invoice.totalTtc` → `amountGnf: invoice.amountDue`
- [ ] Tâche 2 : `apps/trust-api/src/money-client/money-client.module.ts` déjà exporte `PaymentLinkClient` — `apps/trust-api/src/payments/payments.module.ts` importe `MoneyClientModule`, `PaymentsService` injecte `PaymentLinkClient`
- [ ] Tâche 3 : `apps/trust-api/src/payments/payments.service.ts` — nouvelle méthode privée `regenerateLinkForRemainingBalance(invoiceId)` (best-effort, try/catch + `logger.warn`, mirroring `detectAndRecordCashAnomaly()`) : si `status !== "partially_paid"` → no-op ; sinon `paymentLinkClient.tryGenerate({..., amountGnf: invoice.amountDue})`, puis `$transaction` mettant à jour `paymentLinkUrl`/`paymentLinkId`/`paymentLinkExpiresAt` + `InvoiceEvent(payment_link_regenerated, actorId: null)` ; appelée depuis `recordCashPayment()` et `recordBankTransferPayment()`, après `createPaymentAndApply()`

## Tests à écrire AVANT le code
- [ ] Test 1 (`invoices.service.spec.ts`) : `regeneratePaymentLink()` sur une facture `partially_paid` génère un lien pour `amountDue`, PAS `totalTtc` (fix du bug)
- [ ] Test 2 (`payments.service.spec.ts`) : un paiement cash partiel (laissant `partially_paid`) déclenche la régénération avec `amountGnf: amountDue` restant
- [ ] Test 3 : un paiement cash qui solde entièrement la facture (`paid`) NE déclenche PAS de régénération
- [ ] Test 4 : un échec de `tryGenerate()` (retourne `null`) n'empêche jamais le paiement de réussir — best-effort confirmé
- [ ] Test 5 : même comportement pour `recordBankTransferPayment()`
- [ ] Test 6 : `recordProviderPayment()` ne déclenche jamais cette régénération (exclusion volontaire)
- [ ] Test 7 : `InvoiceEvent(type: payment_link_regenerated, actorId: null)` créé lors d'une régénération automatique réussie

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune migration Prisma nécessaire
- code-reviewer OK

## Risques identifiés & mitigations
- Risque 1 : le fix de Tâche 1 pourrait sembler un scope creep hors de C11 → mitigation : documenté explicitement comme condition préalable — sans ce fix, "nouveau lien pour le solde restant" ne serait pas vrai, la fonctionnalité de Tâche 3 hériterait silencieusement du bug si elle réutilisait la même logique.
- Risque 2 : régénérer un lien à CHAQUE paiement partiel cash pourrait multiplier les appels Money Context si un client paie en plusieurs petites tranches → mitigation : acceptée comme comportement voulu par le backlog ("nouveau lien" explicite), coût borné par `REQUEST_TIMEOUT_MS` (3s) et best-effort (jamais bloquant) ; optimisation (throttling) hors scope MVP.
