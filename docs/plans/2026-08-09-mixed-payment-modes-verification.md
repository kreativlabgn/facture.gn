# Plan : Mixer les modes de paiement sur une même facture (C12)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — aucune modification de code prévue a priori, investigation d'abord
- Persona affecté : organisation (staff) qui encaisse un même client en plusieurs fois par des moyens différents (ex. moitié cash, moitié Mobile Money)
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : Export FEC (F9, déjà mergé) — "N écritures par facture" (ADR-062)

## Investigation préalable
Backlog : "C12 — Mixer les modes de paiement sur une même facture `[SHOULD]`" — Réf : ADR-062. Aucun bullet, texte le plus court de toute la section C.

ADR-062 (texte exact) : *"Décision : Machine à états : issued → partially_paid → paid. N paiements successifs. Nouveau lien de paiement pour le amount_due restant. **Cash et lien mixables.**"* — c'est le MÊME ADR que C11 (déjà mergée, `feb95c6`), qui a implémenté exactement cette machine à états et la régénération de lien pour le solde restant.

**Découverte structurante** (lecture de `payments.service.ts`) : rien dans le code n'empêche structurellement d'appeler `recordCashPayment()`, `recordBankTransferPayment()` et `recordProviderPayment()` successivement sur la même facture :
- Les trois méthodes valident uniquement `PAYABLE_STATUSES = {"issued", "partially_paid"}` (`getPayableInvoiceOrThrow()`) — jamais une contrainte sur le mode du paiement précédent.
- `applyPaymentToInvoice()` (ligne 367) porte déjà un commentaire EXPLICITE : *"sous deux paiements concurrents sur la même facture (idempotency_key différentes, cash et/ou payment_link mixés — ADR-062), Postgres sérialise les deux écritures au niveau ligne"* — le mixage était déjà anticipé et conçu au moment de C1/C11, pas oublié.
- `regenerateLinkForRemainingBalance()` (C11) est appelée depuis `recordCashPayment()` ET `recordBankTransferPayment()` — un nouveau lien pour le solde restant est déjà généré après CHAQUE mode non-provider, prêt à recevoir le paiement suivant par n'importe quel autre mode.

**Conclusion** : C12 est déjà fonctionnellement livrée par construction de la machine à états ADR-062 (C11). Aucune ligne de code manquante identifiée. La seule valeur restante est une **vérification E2E réelle** prouvant que le mixage fonctionne bout-en-bout (jamais supposé, toujours vérifié — discipline déjà appliquée à C12 dans ce plan) et la clôture explicite de la story.

## Problème (en 3 lignes max)
Le backlog liste C12 comme une story à part entière, mais aucune preuve E2E n'existe que le mixage de modes fonctionne réellement — seule une lecture de code le suggère.

## Solution retenue (en 5 lignes max)
Aucun code nouveau. Vérification E2E réelle (Postgres local, trust-api démarré) : facture émise → paiement cash partiel → paiement bank_transfer partiel → paiement provider (simulé via `POST .../provider-confirmation`, InternalAuthGuard) soldant le reste → facture `paid`, 3 lignes `Payment` distinctes, `amountDue`/`amountPaid` cohérents à chaque étape.

## Alternatives écartées
Écrire un test E2E automatisé dédié dans le repo — écartée pour cette story précise : le comportement mixte est déjà couvert indirectement par les tests unitaires existants de chacune des 3 méthodes (mêmes helpers partagés `getPayableInvoiceOrThrow`/`createPaymentAndApply`/`applyPaymentToInvoice`, testés isolément) ; ajouter un test d'intégration multi-méthodes serait une modification structurelle non demandée par le backlog (aucun bullet ne l'exige) — la vérification manuelle ponctuelle suffit à clore la story.

## Critères de done
- Vérification E2E réelle réussie, résultats consignés ci-dessous
- Aucune régression (suite existante déjà verte, aucun fichier de production modifié)

## Risques identifiés & mitigations
- Risque 1 : le mixage fonctionne en apparence mais un état incohérent (ex. `amountDue` négatif transitoire) survient silencieusement → mitigation : vérifier `amountDue`/`amountPaid`/`overpaymentAmount` par requête directe après CHAQUE paiement, pas seulement à la fin.

## Résultat de la vérification E2E
Exécuté réellement contre Postgres local (trust-api seul démarré, money-api non requis — le paiement provider est simulé directement via `POST /invoices/:id/payments/provider-confirmation`, `InternalAuthGuard`, exactement le point d'entrée que money-api appelle en production après confirmation webhook ADR-075).

Facture émise à 3 000 000 GNF (centimes) :
1. Cash 1 000 000 → `status=partially_paid`, `amountDue=2 000 000`, `amountPaid=1 000 000`.
2. Virement bancaire 1 000 000 (mode DIFFÉRENT sur la même facture) → `status=partially_paid`, `amountDue=1 000 000`, `amountPaid=2 000 000`.
3. Confirmation provider (Djomy simulé) 1 035 000 GNF collectés (1 000 000 net + commission 21 000 + frais gateway 14 700, ADR-074) → `status=paid`, `amountDue=0`, `amountPaid=3 000 000`, `overpaymentAmount=0`.

Confirmé directement en DB (`psql`) : 3 lignes `Payment` distinctes sur la même `invoice_id` (`cash`/`bank_transfer`/`payment_link`), chacune avec son propre `amount`/`amount_collected`/`platform_fee_amount`, `status=completed`. `amountPaid` final = exactement `totalTtc` (3 000 000), `overpaymentAmount=0` malgré le montant collecté du 3ᵉ paiement supérieur à son `amount` net — confirme qu'ADR-059 ("montant certifié jamais pollué") tient même en mixant les modes.

**C12 est déjà entièrement livrée par la machine à états ADR-062/C11 — aucun code de production modifié pour cette story. Story clôturée par vérification.**
