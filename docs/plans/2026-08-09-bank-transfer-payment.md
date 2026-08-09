# Plan : Encaissement par virement bancaire (C3, ADR-052)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), périmètre `payments/`
- Persona affecté : organisation dont les clients préfèrent régler par virement bancaire plutôt qu'en cash ou par lien de paiement
- Données sensibles manipulées : aucune nouvelle (montants déjà couverts par la rigueur bigint existante)
- Impact réglementaire : aucun — ADR-052 exclut explicitement le chèque du flux certifié, le virement y reste

## Problème (en 3 lignes max)
`Payment.method` inclut `bank_transfer` depuis toujours mais aucun endpoint ne l'accepte — le commentaire de `create-payment.dto.ts` anticipe déjà cette story ("bank_transfer (C3)... seul cash est accepté par ce DTO").

## Solution retenue (en 5 lignes max)
Nouvelle route `POST /invoices/:id/payments/bank-transfer`, DTO minimal (`amount` uniquement — le relevé bancaire de l'organisation est déjà la preuve, contrairement au cash qui exige photo/GPS/signature). `recordBankTransferPayment()` réutilise `createPaymentAndApply()` existant avec `method: "bank_transfer"`, `allowOverpayment: false` (contrairement au cash/C14 — un virement arrive à un montant convenu, pas de rendu-monnaie physique). Mêmes rôles et même garde `Idempotency-Key` que la route cash.

## Alternatives écartées
Étendre `createPaymentSchema` existant pour accepter `method: "bank_transfer"` en plus de `"cash"` — écartée : les règles de preuve diffèrent fondamentalement (cash exige photo/GPS/signature conditionnellement au montant, virement n'en exige aucune), un DTO partagé complexifierait le `.refine()` pour un gain de duplication minimal. Cohérent avec le pattern déjà établi (une route dédiée par nature de paiement : cash, deposit, provider-confirmation).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/payments/dto/create-bank-transfer-payment.dto.ts` (nouveau) — `amount: z.coerce.bigint().positive()`
- [ ] Tâche 2 : `apps/trust-api/src/payments/payments.service.ts` — nouvelle méthode `recordBankTransferPayment(invoiceId, dto, idempotencyKey)` : idempotency-check, `getPayableInvoiceOrThrow(invoiceId, dto.amount)` (allowOverpayment par défaut `false`), `createPaymentAndApply()` avec `method: "bank_transfer"`, `platformFeeAmount: 0n`, `gatewayFeeAmount: 0n`
- [ ] Tâche 3 : `apps/trust-api/src/payments/payments.controller.ts` — route `POST :id/payments/bank-transfer`, `@Roles("owner","admin","cashier","field_agent","delivery_driver")`, même garde `Idempotency-Key` que la route cash

## Tests à écrire AVANT le code
- [ ] Test 1 (`payments.service.spec.ts`) : virement enregistré avec succès, `method: "bank_transfer"`, commission nulle
- [ ] Test 2 (`payments.service.spec.ts`) : virement dont le montant dépasse le solde dû → `ConflictException` (contrairement au cash — preuve du scope C14 non étendu ici)
- [ ] Test 3 (`payments.service.spec.ts`) : replay avec le même `idempotencyKey` → renvoie le paiement déjà créé, ne recrée rien (même garantie que le cash)
- [ ] Test 4 (`payments.service.spec.ts`) : aucun `InvoiceEvent` de détection d'anomalie écrit — G1 reste cash-only

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK
- security-reviewer : non nécessaire (aucune donnée sensible nouvelle, réutilise un chemin déjà audité)

## Risques identifiés & mitigations
- Risque 1 : confondre par erreur ce paiement avec du cash dans la détection d'anomalie (G1) → mitigation : `detectAndRecordCashAnomaly()` n'est appelé QUE depuis `recordCashPayment()`, jamais depuis la nouvelle méthode — vérifié par test dédié.
