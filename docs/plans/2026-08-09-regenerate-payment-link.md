# Plan : Régénération du lien de paiement à la demande (C18, ADR-066)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), périmètre `invoices/`
- Persona affecté : organisation émettrice dont le lien de paiement d'une facture est perdu, expiré, ou jamais parvenu au client
- Données sensibles manipulées : aucune nouvelle (montants déjà couverts par la rigueur bigint existante)
- Impact réglementaire : OHADA (aucun — la facture elle-même n'expire jamais, seul le lien a un TTL, ADR-066)

## Problème (en 3 lignes max)
`InvoiceEventType.payment_link_regenerated` existe déjà dans le schema mais n'est jamais écrit : aucun mécanisme ne permet aujourd'hui à une organisation de régénérer le lien de paiement d'une facture déjà émise, alors qu'ADR-066 l'exige explicitement ("Régénérable à la demande").

## Solution retenue (en 5 lignes max)
Nouvelle méthode `regeneratePaymentLink(invoiceId, actorId)` : vérifie que la facture est dans un statut payable (`issued`/`partially_paid`), appelle `PaymentLinkClient.tryGenerate()` avec le montant actuel (`totalTtc`), mais — contrairement à `issue()` qui traite l'échec en meilleur effort — lève une `ConflictException` explicite si la génération échoue (c'est ici l'action demandée elle-même, pas un effet secondaire). En cas de succès, met à jour `paymentLinkUrl`/`paymentLinkId`/`paymentLinkExpiresAt` et écrit un `InvoiceEvent(type: payment_link_regenerated, actorId)`. Nouvelle route `POST /invoices/:id/regenerate-payment-link`, même trio de rôles que `/issue` (owner/admin/cashier).

## Alternatives écartées
Le tag "dormant" pour les factures >90j sans action (2ᵉ mécanisme d'ADR-066) est explicitement écarté de cette story : il nécessiterait une tâche planifiée périodique (aucune infrastructure de scheduler/cron n'existe dans ce repo aujourd'hui), un mécanisme structurellement différent d'une régénération à la demande déclenchée par l'utilisateur. Réservé à une story future distincte.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/invoices.service.ts` — nouvelle méthode `regeneratePaymentLink(invoiceId, actorId)` : garde de statut payable, appel `paymentLinkClient.tryGenerate()`, `ConflictException` explicite si échec, sinon `update()` des 3 champs de lien + écriture `InvoiceEvent`
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.controller.ts` — route `POST /invoices/:id/regenerate-payment-link`, `@Roles("owner","admin","cashier")`, `@CurrentUser()` pour l'`actorId`

## Tests à écrire AVANT le code
- [ ] Test 1 (`invoices.service.spec.ts`) : facture `issued` + génération réussie → `paymentLinkUrl`/`paymentLinkId`/`paymentLinkExpiresAt` mis à jour avec les nouvelles valeurs
- [ ] Test 2 (`invoices.service.spec.ts`) : régénération réussie → `InvoiceEvent(type: payment_link_regenerated, actorId, invoiceId)` écrit
- [ ] Test 3 (`invoices.service.spec.ts`) : `PaymentLinkClient.tryGenerate()` retourne `null` (panne money-api) → `ConflictException` explicite, jamais un succès silencieux, `invoice.update()` jamais appelé
- [ ] Test 4 (`invoices.service.spec.ts`) : facture `draft` → rejetée (`ConflictException`, rien n'a encore été émis)
- [ ] Test 5 (`invoices.service.spec.ts`) : facture `voided`/`paid` → rejetée (plus rien à régler)
- [ ] Test 6 (`invoices.service.spec.ts`) : facture `partially_paid` → régénération acceptée (toujours payable)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK
- security-reviewer : non obligatoire (aucune nouvelle donnée sensible, pattern déjà audité pour C2/G1)

## Risques identifiés & mitigations
- Risque 1 : confondre le comportement best-effort d'`issue()` avec celui attendu ici → mitigation : commentaire explicite dans le code marquant la divergence assumée (ici l'échec DOIT être visible, contrairement à `issue()`).
- Risque 2 : régénérer un lien alors qu'un paiement vient d'arriver entre-temps (course avec un webhook) → accepté comme limitation mineure : le pire cas est un lien régénéré pour une facture qui vient d'être réglée, sans conséquence financière (aucun montant n'est modifié par cette action, seul un lien d'accès est renouvelé).
