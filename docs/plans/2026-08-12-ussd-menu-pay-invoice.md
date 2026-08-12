# Plan : Option 1 USSD — Payer une facture (D3, partie 1)

**Statut : plan seul, en attente de validation — aucun code écrit.**

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api/src/ussd/`) — réutilise `InvoicesService.regeneratePaymentLink()` (C18, déjà mergée).
- Persona affecté : marchand ou payeur authentifié via *620#.

## Investigation préalable

§2.1 Spec USSD : « Le montant affiché est amount_due (pas total_ttc)... Les frais de transaction (platform_fee) sont affichés séparément, portés par le payeur. Après confirmation et saisie du PIN, le paiement est exécuté via le provider résolu par l'orchestrateur. »

**Écart assumé et documenté** : ce repo n'a JAMAIS construit de capacité de "charge directe" côté orchestrateur (`PaymentProvider` n'expose que `createPaymentLink`/`verifyTransaction`/`handleWebhook` — jamais un "collect" synchrone). Tous les paiements non-cash de ce produit, sans exception, transitent par un lien hébergé (ADR-060) — jamais un flux de charge directe. « Le paiement est exécuté via le provider » est donc interprété comme : un lien de paiement est (ré)généré et transmis, exactement le même mécanisme que `regeneratePaymentLink()` (C18, déjà utilisé par la PWA) — « mêmes garanties que la PWA » (texte backlog D3) le confirme littéralement. Construire une vraie charge directe serait un chantier Money Context à part entière, hors de cette story.

`InvoicesService.regeneratePaymentLink(invoiceId, actorId)` fait déjà tout : calcule `amountDue + platformFee` (ADR-074), génère le lien via l'orchestrateur, trace l'événement (`payment_link_regenerated`). Aucune nouvelle logique de paiement à écrire — uniquement l'habillage USSD (recherche de facture par numéro, aperçu du montant avant confirmation, câblage de l'appel).

`Invoice.number` n'est unique QUE par organisation (pas globalement) — la recherche exige `organizationId` + `number` ensemble, jamais `number` seul.

## Décision d'architecture

**`UssdPaymentService`** (`ussd/ussd-payment.service.ts`) :
- `findPayableInvoice(organizationId, number)` → `Invoice.findFirst({organizationId, number, status: {in: ["issued", "partially_paid"]}})` — `null` si absente ou déjà `paid`/`voided`/`draft` (rien à payer).
- `previewFee(organizationId, amountDue)` → `computePlatformFee(amountDue, organization.commercialTier)` (réutilisé tel quel, ADR-074) — aperçu affiché AVANT confirmation, jamais un montant deviné.
- `confirmPayment(invoiceId, actorId)` → délègue à `InvoicesService.regeneratePaymentLink()`.

**Nouveaux états `UssdSessionService`** : `pay_awaiting_invoice_number` (déclenché par `completeAuthentication` si `pendingOption === "1"`) → aperçu (montant dû + frais + total) → `pay_awaiting_confirmation` → `"1"` confirme (régénère le lien), tout autre input annule. Organisation résolue via `UssdInvoiceService.resolveOrganizationForEmission()` (déjà construit, réutilisé tel quel — même trio de rôles habilités).

## Alternatives écartées

**Construire une vraie capacité de charge directe côté orchestrateur** — écartée, chantier Money Context séparé, aucun signal backlog pour ça dans D3 (« mêmes garanties que la PWA » pointe explicitement vers le mécanisme déjà existant).

## Découpage en tâches bite-sized
- [ ] Tâche 1 (RED) : `ussd-payment.service.spec.ts` — facture trouvée/absente/déjà payée ; aperçu du frais ; délégation de confirmation
- [ ] Tâche 2 (GREEN) : `UssdPaymentService`
- [ ] Tâche 3 (RED) : `ussd-session.service.spec.ts` — flux complet option 1 : numéro → aperçu → confirmation → régénération ; numéro inconnu ; annulation
- [ ] Tâche 4 (GREEN) : câblage dans `UssdSessionService`

## Critères de done
- Suite trust-api verte, typecheck/lint verts
- Aucune facture `paid`/`voided`/`draft` n'est proposée au paiement

## Risques identifiés & mitigations
- Risque 1 : confusion utilisateur entre "lien envoyé" et "paiement effectivement reçu" → mitigation : message de confirmation explicite ("lien envoyé", jamais "payé"), cohérent avec le comportement réel (un lien n'est pas un paiement confirmé, seul le webhook l'atteste).
