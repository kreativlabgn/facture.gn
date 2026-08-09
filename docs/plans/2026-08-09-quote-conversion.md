# Plan : Conversion d'un devis en facture (C16, ADR-064)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), périmètre `invoices/`
- Persona affecté : organisation qui émet un devis (prix indicatif, jamais engageant) et souhaite le transformer en facture réelle une fois accepté par le client
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : OHADA (numérotation séquentielle, déjà garantie par `InvoiceNumberingService` à l'émission — inchangé)

## Problème (en 3 lignes max)
`InvoiceDocumentType.quote` existe depuis toujours dans le schema mais `convertToInvoice()` (construit pour C15) rejette explicitement tout document qui n'est pas un `proforma` — aucun devis ne peut aujourd'hui être converti en facture, alors qu'ADR-064 l'exige au même titre que le proforma.

## Solution retenue (en 5 lignes max)
Élargir la garde de `convertToInvoice()` pour accepter `documentType ∈ {proforma, quote}` — le reste de la méthode (recalcul du régime fiscal depuis l'organisation actuelle, transaction atomique claim-then-create, copie de `discountPct`) est réutilisé tel quel : ADR-064 ne prévoit aucune différence de traitement à la conversion elle-même. `forfeitDeposit()` et `recordDepositPayment()` restent strictement `proforma`-only, non touchés — un devis reste structurellement incapable de recevoir la moindre arrhes ou paiement, exactement comme l'exige ADR-064 ("Devis n'accepte aucun paiement").

## Alternatives écartées
Créer une méthode `convertQuoteToInvoice()` séparée, dupliquant `convertToInvoice()` — écartée : ADR-064 ne distingue aucune règle de conversion propre au devis, dupliquer la logique (recalcul régime, transaction, copie discountPct) créerait deux points de maintenance pour un seul comportement.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/invoices.service.ts:convertToInvoice()` — élargir la garde `documentType !== "proforma"` en `documentType !== "proforma" && documentType !== "quote"`, message d'erreur mentionnant les deux types acceptés

## Tests à écrire AVANT le code
- [ ] Test 1 (`invoices.service.spec.ts`) : un devis (`documentType: "quote"`) en statut `draft` est converti en facture — mêmes assertions que le test proforma existant (nouvelle facture `draft`, devis marqué `converted` + `convertedToInvoiceId`)
- [ ] Test 2 (`invoices.service.spec.ts`) : le test existant "refuse de convertir un document qui n'est pas un proforma" (`documentType: "invoice"`) continue de passer sans modification — non-régression explicite
- [ ] Test 3 (`payments.service.spec.ts` ou `invoices.service.spec.ts`) : un devis reste rejeté par `recordDepositPayment()`/`forfeitDeposit()` — preuve que "Devis n'accepte aucun paiement" tient toujours après l'élargissement de `convertToInvoice()`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK
- security-reviewer : non nécessaire (aucune donnée sensible, extension d'un chemin déjà audité pour C15)

## Risques identifiés & mitigations
- Risque 1 : élargir la garde de `convertToInvoice()` élargirait par erreur AUSSI la garde de `forfeitDeposit()`/`recordDepositPayment()` si le refactor était mal ciblé → mitigation : ces deux méthodes ont leur propre garde indépendante, jamais partagée avec `convertToInvoice()` — aucune modification n'y est nécessaire, vérifié par test de non-régression dédié.
