# Plan : Grille de commission à 5 paliers (ADR-074)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — extension de `invoices/` et `payments/` existants, aucun nouveau modèle Prisma
- Persona affecté : indirect — toute organisation encaissant via lien de paiement (Mobile Money/carte), et son client payeur qui doit voir le bon montant total
- Données sensibles manipulées : aucune nouvelle
- Impact réglementaire : modèle économique — ADR-059 ("montant certifié jamais pollué"), ADR-067/074 (structure de commission)

## Investigation préalable
`Grille-Offres-facture-gn.md` §4 donne la grille exacte, en vigueur depuis le 26/07 (ADR-074) :

| Tier | Commission affichée | Cap/transaction |
|---|---|---|
| Freemium | 2,5 % | 50 000 GNF |
| Starter | 2,0 % | 50 000 GNF |
| Pro | 1,5 % | 75 000 GNF |
| Enterprise | 1,2 % | 100 000 GNF |
| Custom volume | 1,0 % | 150 000 GNF |

Cash = 0% systématiquement (déjà correct partout, jamais modifié par ce plan). "Commission cible (négo)" est un taux plancher pour négociation individuelle, jamais public, aucun mécanisme de configuration par organisation ne demande d'être construit ici — **hors scope**, réservé à une story future si confirmée (aucun champ scaffoldé pour ça).

**Découverte n°1** : `platformFeeAmount: 0n` est câblé en dur avec un commentaire explicite dans `payments.service.ts:72` ("grille 5 paliers ADR-074 simplifiée à ce stade, cf. Phase 1") — la story elle-même s'auto-documente déjà comme le prolongement attendu.

**Découverte n°2, structurante** : ADR-058 demande une "table de config versionnée" pour ces taux — mais `CONFIG_PARAMETER` n'a **jamais été scaffoldée** dans ce repo (grep exhaustif, absente du schema). Précédent direct déjà accepté dans ce même repo : `tax-regime.ts` (C4) code déjà les 4 taux de TVA en constante TypeScript, malgré qu'ADR-058 les classe aussi sous "jamais en dur." **Même choix reconduit ici** — grille codée en constante (`commission-grid.ts`, mirroir exact de `tax-regime.ts`), pas de nouvelle infrastructure de config. Écart à ADR-058 déjà existant et assumé dans ce repo, pas introduit par cette story.

**Découverte n°3, bloquante pour le scope naïf** : ADR-059 dit *"Commission Money portée par le payeur... le commerçant reçoit toujours le montant certifié intégral."* Aujourd'hui, **le lien de paiement est généré pour le montant BRUT de la facture** (`amountGnf: invoice.totalTtc` à l'émission, `invoice.amountDue` pour la régénération, C18/C11) — jamais majoré. Sans majoration du montant envoyé à `PaymentLinkClient.tryGenerate()`, il n'existe structurellement AUCUN moyen pour la commission d'exister sans être prélevée sur le marchand (ce qu'ADR-059 interdit explicitement). Implémenter la grille implique donc nécessairement de modifier le montant envoyé à **3 points d'appel déjà construits et testés** : `invoices.service.ts:issue()`, `invoices.service.ts:regeneratePaymentLink()` (C18), `payments.service.ts:regenerateLinkForRemainingBalance()` (C11) — pas une simple fonction de calcul isolée.

**Découverte n°4, conséquence de la n°3** : `recordProviderPayment()` valide aujourd'hui `dto.amountGnf` (ce que le payeur a réglé) contre `invoice.amountDue` via `getPayableInvoiceOrThrow()`, et applique CE MÊME montant à `invoice.amountDue`/`amountPaid`. Une fois le lien majoré, `dto.amountGnf` dépassera structurellement `amountDue` — appliquer `dto.amountGnf` tel quel à l'invoice invoquerait à tort le mécanisme "trop-perçu" (C14, `overpaymentAmount`), polluant ce champ avec de la commission, pas un vrai trop-perçu. **Solution retenue** : le montant appliqué à l'invoice reste `invoice.amountDue` exact (jamais `dto.amountGnf`) — la commission est une couche additive de *reporting* (`payment.amountCollected`/`platformFeeAmount`), jamais mêlée au calcul certifié (`payment.amount`, `invoice.amountDue/amountPaid`). Ceci préserve intégralement ADR-059.

**Découverte n°5 — périmètre d'application** : ADR-074/Grille-Offres ne couvrent explicitement que *"tout encaissement non-cash (Mobile Money, carte)... transite par un lien de paiement hébergé"* — jamais `bank_transfer` (C3, ADR-052, "rapprochement asynchrone", déjà `platformFeeAmount: 0n` et jamais remis en question par aucun ADR commission). **Scope de cette story : uniquement `recordProviderPayment()` (method: payment_link)** — cash et bank_transfer restent à 0%, inchangés.

## Solution retenue (en 5 lignes max)
Nouveau module pur `apps/trust-api/src/common/commission-grid.ts` (mirroir exact de `tax-regime.ts`) : `computePlatformFee(amountGnf, tier)` — taux × montant, plafonné au cap du palier. Les 3 points de génération de lien (`issue()`, `regeneratePaymentLink()`, `regenerateLinkForRemainingBalance()`) majorent désormais `amountGnf` envoyé à `PaymentLinkClient.tryGenerate()` de la commission calculée sur le solde à encaisser. `recordProviderPayment()` calcule la commission côté serveur sur `invoice.amountDue` (jamais sur `dto.amountGnf`, non fait confiance), applique EXACTEMENT `invoice.amountDue` à l'invoice (certifié, jamais pollué), enregistre `amountCollected: dto.amountGnf` (ce que money-api rapporte, gardé tel quel) et `platformFeeAmount` calculé.

## Alternatives écartées
Construire `CONFIG_PARAMETER` — écartée, précédent direct `tax-regime.ts` déjà accepté dans ce repo pour la même classe de donnée. Inverser algébriquement `dto.amountGnf` pour retrouver le montant net à la confirmation — écartée : casse dès que le plafond par transaction s'applique (la relation n'est plus une simple proportion), en plus d'ajouter une dépendance fragile à la précision du calcul côté money-api ; recalculer côté serveur depuis `invoice.amountDue` est plus simple et robuste. Réutiliser `allowOverpayment: true` sans commentaire pour `recordProviderPayment()` — le flag est réutilisé (évite un vrai second paramètre) mais avec un commentaire explicite que ce n'est PAS un trop-perçu réel (le montant appliqué à l'invoice reste exactement `amountDue`, jamais négatif).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/common/commission-grid.ts` (nouveau) — `computePlatformFee(amountGnf: bigint, tier: CommercialTier): bigint`
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.service.ts:issue()` — majore `amountGnf` de la commission (organisation déjà chargée, aucune requête supplémentaire)
- [ ] Tâche 3 : `apps/trust-api/src/invoices/invoices.service.ts:regeneratePaymentLink()` — charge désormais `organization` (nouvelle requête), majore `amountGnf`
- [ ] Tâche 4 : `apps/trust-api/src/payments/payments.service.ts:regenerateLinkForRemainingBalance()` — charge `organization`, majore `amountGnf`
- [ ] Tâche 5 : `apps/trust-api/src/payments/payments.service.ts:recordProviderPayment()` — charge `organization`, calcule `platformFeeAmount` sur `invoice.amountDue`, applique exactement `invoice.amountDue` à l'invoice, `amountCollected: dto.amountGnf`
- [ ] Tâche 6 : mise à jour des fixtures de test existantes (`createFakePrisma` dans `invoices.service.spec.ts`/`payments.service.spec.ts`) pour inclure `commercialTier` par défaut — sinon TOUS les tests existants qui exercent `issue()`/`regeneratePaymentLink()`/`recordProviderPayment()` casseraient silencieusement (accès à un champ `undefined`)

## Tests à écrire AVANT le code
- [ ] Test 1 (`commission-grid.spec.ts`) : chaque palier applique le bon taux (freemium 2,5%, starter 2,0%, pro 1,5%, enterprise 1,2%, custom 1,0%)
- [ ] Test 2 : le plafond par palier s'applique au-delà du seuil (ex. freemium plafonné à 50 000 GNF même sur une facture à 10M GNF)
- [ ] Test 3 (`invoices.service.spec.ts`) : `issue()` génère le lien pour `totalTtc + commission`, jamais `totalTtc` seul (régression du comportement pré-commission)
- [ ] Test 4 : `regeneratePaymentLink()` génère le lien pour `amountDue + commission`
- [ ] Test 5 (`payments.service.spec.ts`) : `recordProviderPayment()` applique exactement `invoice.amountDue` à `amountPaid`/`amountDue` (jamais `dto.amountGnf`) — `amountDue` final = 0, `overpaymentAmount` reste 0 (pas de fausse détection de trop-perçu)
- [ ] Test 6 : `payment.platformFeeAmount` correctement calculé selon le tier de l'organisation, `payment.amountCollected` = `dto.amountGnf` tel quel
- [ ] Test 7 : `regenerateLinkForRemainingBalance()` (C11) majore aussi le lien de solde restant
- [ ] Test 8 : `recordCashPayment()`/`recordBankTransferPayment()` restent inchangés (`platformFeeAmount: 0n`) — non-régression explicite

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante — vigilance particulière sur la non-régression des tests déjà existants touchant `issue()`/`regeneratePaymentLink()`/`recordProviderPayment()`)
- Aucune migration Prisma nécessaire
- code-reviewer OK
- domain-model-reviewer recommandé (nouvelle règle de calcul financier, invariant "montant certifié jamais pollué" à valider explicitement)

## Risques identifiés & mitigations
- Risque 1 (majeur) : casser silencieusement des tests existants qui assertent un `amountGnf` exact sans commission → mitigation : Tâche 6 dédiée, suite complète relancée avant tout commit, chaque échec inspecté individuellement plutôt que patché en masse.
- Risque 2 : confondre commission et trop-perçu (C14) dans `applyPaymentToInvoice()` → mitigation : le montant appliqué à l'invoice reste strictement `invoice.amountDue`, jamais `dto.amountGnf` — vérifié par test dédié (Test 5).
- Risque 3 : le montant du lien de paiement (majoré) diverge de la grille exacte du document marketing dans le détail des centimes (l'exemple de la grille calcule commission ET frais gateway tous deux sur le montant BRUT de la facture, alors qu'une fois le lien majoré, `DjomyStubProvider` calculera son 1% sur le montant DÉJÀ majoré côté money-api) → accepté et documenté : léger écart de quelques GNF sur les cas limites, la cohérence architecturale (chaque service calcule sa propre part sur ce qu'il reçoit) prime sur une correspondance au centime près avec un tableau marketing.
