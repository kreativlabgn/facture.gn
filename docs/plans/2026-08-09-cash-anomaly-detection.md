# Plan : Détection de patterns d'anomalie sur les paiements cash (G1, ADR-032)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), périmètre `payments/`
- Persona affecté : aucun utilisateur direct — signal destiné à une revue humaine future (hors scope de cette story), l'organisation émettrice n'est jamais bloquée
- Données sensibles manipulées : montants et `customerId` (identifiant libre, non-PII directe) — story classée conformité (LBC/FT, ADR-032, section G du backlog)
- Impact réglementaire : Loi L/2021/024/AN (LBC/FT, détection comportementale sans seuil minimal)

## Problème (en 3 lignes max)
`InvoiceEventType.suspicious_cash_pattern_detected` existe déjà dans le schema mais n'est jamais écrit : aucun signal de détection comportementale n'est aujourd'hui généré sur les paiements cash, alors qu'ADR-032 l'exige (montants ronds, boucles client/montant) pour la conformité LBC/FT.

## Solution retenue (en 5 lignes max)
`recordCashPayment()` détecte deux patterns, non-bloquants (ADR-032 : "revue humaine systématique", jamais un rejet automatique) : (1) montant rond ≥ 1M GNF (réutilise `CASH_PROOF_THRESHOLD_GNF_CENTIMES`, précédent déjà accepté) et multiple exact de 100 000 GNF ; (2) ≥3 paiements cash de montant identique pour le même couple organisation/client (`customerId` non-null) sur une fenêtre glissante de 24h. La logique pure de détection est isolée dans `cash-anomaly-detection.ts` (même principe que `tax-regime.ts`) ; si un pattern matche, un `InvoiceEvent(type: suspicious_cash_pattern_detected)` est écrit dans la même transaction que le paiement.

## Alternatives écartées
Le 3ᵉ pattern d'ADR-032 ("écart MM vs facturé") est explicitement écarté de cette story : il nécessiterait une corrélation avec le Money Context (webhooks provider), violant la séparation stricte des bounded contexts pour une seule feature. ADR-091 confirme déjà que G3 (SHOULD, hors scope ici) étendra le même moteur de détection plus tard — ce 3ᵉ pattern y trouvera naturellement sa place.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/payments/cash-anomaly-detection.ts` (nouveau) — `detectCashAnomalyPatterns({ amount, sameAmountRecentCount })` : fonction pure retournant `("round_amount" | "client_amount_loop")[]`
- [ ] Tâche 2 : `apps/trust-api/src/payments/payments.service.ts:recordCashPayment()` — charger `invoice.organizationId`/`invoice.customerId` (déjà chargés par `getPayableInvoiceOrThrow`), compter les paiements cash identiques récents (24h) si `customerId` non-null, appeler `detectCashAnomalyPatterns()`, écrire `InvoiceEvent` si patterns non vide, dans la même transaction que la création du `Payment`

## Tests à écrire AVANT le code
- [ ] Test 1 (`cash-anomaly-detection.spec.ts`) : montant ≥ 1M GNF, multiple exact de 100K → `["round_amount"]`
- [ ] Test 2 (`cash-anomaly-detection.spec.ts`) : montant rond mais < 1M GNF → aucun pattern (normalité du commerce, pas de signal)
- [ ] Test 3 (`cash-anomaly-detection.spec.ts`) : montant non-rond ≥ 1M GNF → aucun pattern
- [ ] Test 4 (`cash-anomaly-detection.spec.ts`) : `sameAmountRecentCount >= 3` → `["client_amount_loop"]` ; deux patterns simultanés si montant rond ET boucle
- [ ] Test 5 (`payments.service.spec.ts`) : paiement cash rond ≥ 1M GNF → `InvoiceEvent` créé avec `type: suspicious_cash_pattern_detected`, `metadata` contenant `round_amount`
- [ ] Test 6 (`payments.service.spec.ts`) : 3ᵉ paiement identique pour le même client → `InvoiceEvent` créé avec `client_amount_loop`
- [ ] Test 7 (`payments.service.spec.ts`) : `customerId` null → la vérification de boucle est ignorée même si le montant se répète (limitation documentée, pas un bug)
- [ ] Test 8 (`payments.service.spec.ts`) : paiement cash normal (non rond, pas de boucle) → aucun `InvoiceEvent` écrit — non-régression explicite, le paiement réussit normalement dans tous les cas (jamais de blocage)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée (le `metadata` de l'événement reste en DB, jamais dans un log applicatif)
- Aucun hardcoded secret
- code-reviewer OK
- security-reviewer OK (story de conformité LBC/FT, section G du backlog)

## Risques identifiés & mitigations
- Risque 1 : seuils arbitraires (1M GNF, multiple de 100K, 3 occurrences/24h) sans base chiffrée dans l'ADR → mitigation : mêmes constantes explicitement documentées comme choix MVP (précédent direct : `CASH_PROOF_THRESHOLD_GNF_CENTIMES`), pas un blocage produit puisque la détection ne fait que déclencher une revue humaine, jamais un rejet — un faux positif a un coût faible.
- Risque 2 : `customerId` nullable et non validé peut faire manquer de vraies boucles de structuration → accepté comme limitation documentée (aucun modèle `Customer` n'existe dans ce repo), pas un blocage de cette story.
