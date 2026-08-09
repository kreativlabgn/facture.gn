# Plan : Gestion du trop-perçu cash (C14)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), périmètre `payments/`
- Persona affecté : organisation qui encaisse du cash et reçoit un montant supérieur au solde dû (rendu monnaie non disponible, montant rond remis par le client)
- Données sensibles manipulées : aucune nouvelle (montants déjà couverts par la rigueur bigint et la preuve photo/GPS/signature existantes, C1)
- Impact réglementaire : aucun direct (le trop-perçu est une pratique commerciale courante, pas un mouvement d'argent nécessitant un traitement fiscal particulier à ce stade)

## Problème (en 3 lignes max)
`Invoice.overpaymentAmount` existe déjà dans le schema mais n'est jamais lu ni écrit — `getPayableInvoiceOrThrow()` rejette aujourd'hui tout paiement cash dépassant le solde dû, avec le message littéral "trop-perçu non géré ici" déjà présent dans le code.

## Solution retenue (en 5 lignes max)
`recordCashPayment()` autorise désormais un montant supérieur au solde dû (nouveau paramètre `allowOverpayment` sur `getPayableInvoiceOrThrow()`, `true` pour cash uniquement). `applyPaymentToInvoice()` garde son incrément purement relatif existant (`amountPaid += amount`, `amountDue -= amount`, atomique côté DB) puis lit la valeur de retour : si `amountDue` est devenu négatif, une correction dans la même transaction ramène `amountDue` à 0 et incrémente `overpaymentAmount` du montant observé. Aucun remboursement automatique — `overpaymentAmount` trace seulement l'excédent, une future story (C13, hors scope) gérera son remboursement effectif.

## Alternatives écartées
Lire `invoice.amountDue` avant la transaction pour calculer le montant "appliqué" vs. "excédent" à l'avance — écartée : réintroduirait exactement la fenêtre de course que le commentaire existant d'`applyPaymentToInvoice()` documente comme délibérément évitée. La correction post-update (basée sur la valeur de retour de l'update relatif déjà atomique) est race-free sans calcul préalable.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/payments/payments.service.ts:getPayableInvoiceOrThrow()` — nouveau paramètre `allowOverpayment: boolean = false`, ignore la garde `amount > invoice.amountDue` quand `true`
- [ ] Tâche 2 : `apps/trust-api/src/payments/payments.service.ts:recordCashPayment()` — passe `allowOverpayment: true`
- [ ] Tâche 3 : `apps/trust-api/src/payments/payments.service.ts:applyPaymentToInvoice()` — après l'update relatif existant, si `updatedInvoice.amountDue < 0n`, corriger (`amountDue: 0n`, `overpaymentAmount: {increment: -amountDue}`) et statut `"paid"` ; sinon logique de statut inchangée

## Tests à écrire AVANT le code
- [ ] Test 1 (`payments.service.spec.ts`) : paiement cash dont le montant dépasse le solde dû → accepté (pas de `ConflictException`), `amountDue` = 0, `overpaymentAmount` = excédent exact, statut `paid`
- [ ] Test 2 (`payments.service.spec.ts`) : paiement cash exactement égal au solde dû → comportement inchangé (`overpaymentAmount` reste 0) — non-régression explicite
- [ ] Test 3 (`payments.service.spec.ts`) : paiement cash inférieur au solde dû → comportement inchangé (`partially_paid`, `overpaymentAmount` reste 0) — non-régression explicite
- [ ] Test 4 (`payments.service.spec.ts`) : paiement provider dont le montant dépasse le solde dû → toujours rejeté (`ConflictException`) — preuve que la portée reste cash-only

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK — attention particulière requise sur l'absence de nouvelle fenêtre de course (point le plus délicat de cette story)
- security-reviewer : non nécessaire (aucune donnée sensible nouvelle, extension d'un chemin déjà audité pour C1)

## Risques identifiés & mitigations
- Risque 1 : réintroduire une course sous paiements concurrents → mitigation détaillée dans "Solution retenue" — la correction se base uniquement sur la valeur de retour de l'update relatif déjà atomique, jamais sur une lecture préalable hors transaction.
- Risque 2 : un paiement provider en trop-perçu resterait rejeté sans jamais être géré → accepté comme limitation de scope (backlog explicitement "trop-perçu CASH"), le flux provider génère un lien pour un montant exact et un dépassement y est un cas structurellement différent, hors scope de cette story.
