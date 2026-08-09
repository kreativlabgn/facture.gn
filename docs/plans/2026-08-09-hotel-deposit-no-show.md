# Plan : C5 — Encaisser des arrhes avec forfait automatique no-show

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/payments/`, `apps/trust-api/src/invoices/`
- Persona affecté : Djénabou (hôtelière) et son personnel (owner/admin/cashier)
- Données sensibles manipulées : montants financiers, aucune PII nouvelle
- Impact réglementaire : OHADA/SYSCOHADA — ADR-034, ADR-064

## Problème (en 3 lignes max)
Un proforma ne peut aujourd'hui recevoir aucun paiement (statut `draft` jamais payable), donc Djénabou ne peut pas sécuriser une réservation par des arrhes — exactement le trou laissé ouvert intentionnellement lors de C15 ("proforma accepte arrhes uniquement"). `InvoiceEvent` (source de vérité audit, ADR-015) n'est écrit nulle part dans le codebase, alors que `cancellation_indemnity`/`no_show_forfeited` sont les mécanismes par lesquels ADR-034 dit que le forfait doit être tracé.

## Solution retenue (en 5 lignes max)
Nouvelle méthode `PaymentsService.recordDepositPayment()` : encaisse un dépôt cash (`depositType="arrhes"`) sur un proforma `draft`, sans toucher `amountPaid`/`amountDue` (l'arrhes est un dépôt de sécurité, pas un paiement partiel de la facture). Nouvelle méthode `InvoicesService.forfeitDeposit(proformaId, reason)` : vérifie qu'une arrhes existe, écrit un `InvoiceEvent` (type = `reason`, montant = l'arrhes) et clôture le proforma en `voided` (pas via `void()` existant — logique dédiée, l'arrhes reste tracée par le `Payment` + `InvoiceEvent`, jamais effacée). Deux nouvelles routes.

## Alternatives écartées
- **Réutiliser `recordCashPayment()` existant avec un flag `depositType`** — écarté : ADR-064 traite arrhes comme une catégorie de paiement distincte (seule chose qu'un proforma peut recevoir), pas une variante d'un paiement normal ; mélanger les deux logiques (incrément `amountPaid`/`amountDue` vs. dépôt indépendant) créerait une ambiguïté sur ce que représente le montant dû d'un proforma.
- **Automatiser la détection du no-show** (scheduler + date de réservation) — écarté : aucune infrastructure de tâche planifiée n'existe dans ce codebase, aucun champ de date de réservation n'existe sur `Invoice`/`InvoiceLine`. Le déclenchement reste manuel (staff fournit `reason`), cohérent avec le fait que toute action conséquente de ce système (`issue`, `void`, `convertToInvoice`) est déjà déclenchée manuellement, jamais par un job automatique.
- **Implémenter `refund_multiplier 2x`** (remboursement double si le marchand annule) — écarté : hors du titre et du parcours de cette story précise ; documenté comme gap connu pour une future story si le produit le demande.
- **Réutiliser `void()` pour clôturer le proforma forfaité** — écarté : `void()` rejette explicitly toute facture avec `amountPaid > 0` (règle correcte pour son propre usage générique) ; le proforma forfaité a `amountPaid=0` sur l'`Invoice` (l'arrhes vit uniquement dans `Payment`, jamais incrémentée sur l'invoice), donc `void()` ne serait pas techniquement bloqué — mais mélanger les deux chemins masquerait la différence sémantique (annulation générique vs. forfait d'arrhes avec trace d'audit dédiée). Une méthode dédiée est plus claire et plus sûre à faire évoluer séparément.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `apps/trust-api/src/payments/dto/record-deposit.dto.ts` (nouveau) — schema Zod, réutilise `CASH_PROOF_THRESHOLD_GNF_CENTIMES` importé de `create-payment.dto.ts` (pas de duplication du seuil)
- [ ] Tâche 2 : `apps/trust-api/src/payments/payments.service.ts` — nouvelle méthode `recordDepositPayment(proformaId, dto, idempotencyKey)` : garde documentType="proforma" + status="draft", garde "un seul dépôt par proforma" (refuse un second dépôt), crée `Payment(method: "cash", depositType: "arrhes", status: "completed")`, jamais de mutation sur `Invoice.amountPaid`/`amountDue`
- [ ] Tâche 3 : `apps/trust-api/src/payments/payments.controller.ts` — route `POST /invoices/:id/payments/deposit`, `@Roles("owner", "admin", "cashier")`, même pattern d'en-tête Idempotency-Key que `recordCashPayment()`
- [ ] Tâche 4 : `apps/trust-api/src/invoices/invoices.service.ts` — nouvelle méthode `forfeitDeposit(proformaId, reason: "cancellation_indemnity" | "no_show_forfeited")` : garde documentType="proforma" + status="draft", garde qu'une arrhes existe (`payment.findFirst({depositType: "arrhes"})`), transaction Prisma (crée `InvoiceEvent` + met à jour `status: "voided"`)
- [ ] Tâche 5 : `apps/trust-api/src/invoices/invoices.controller.ts` — route `POST /invoices/:id/forfeit-deposit`, body `{ reason }`, `@Roles("owner", "admin", "cashier")`

## Tests à écrire AVANT le code
- [ ] Test 1 : `payments.service.spec.ts` — `recordDepositPayment()` refuse un document qui n'est pas `documentType="proforma"`
- [ ] Test 2 : `payments.service.spec.ts` — `recordDepositPayment()` refuse un proforma déjà converti/voided (statut ≠ draft)
- [ ] Test 3 : `payments.service.spec.ts` — `recordDepositPayment()` réussit sur un proforma draft, crée un `Payment` avec `depositType="arrhes"`, ne touche jamais `Invoice.amountPaid`/`amountDue`
- [ ] Test 4 : `payments.service.spec.ts` — `recordDepositPayment()` refuse un second dépôt sur un proforma qui en a déjà un
- [ ] Test 5 : `invoices.service.spec.ts` — `forfeitDeposit()` refuse un proforma sans arrhes enregistrée
- [ ] Test 6 : `invoices.service.spec.ts` — `forfeitDeposit()` écrit un `InvoiceEvent` avec le bon `type`/`amount` et passe le proforma à `voided`, dans une transaction atomique
- [ ] Test 7 : `invoices.service.spec.ts` — `forfeitDeposit()` refuse un proforma déjà `voided`/`converted` (empêche un double forfait)

## Critères de done
- Tous les tests verts (suite complète)
- Build/lint/typecheck verts
- Vérification E2E réelle : proforma → encaissement arrhes → forfait no-show → `InvoiceEvent` présent en base avec le bon type/montant → proforma `voided` → tentative de second dépôt/forfait refusée
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` recommandé si nouveaux invariants (ex. cohérence `Payment.depositType` ↔ `documentType`)

## Risques identifiés & mitigations
- **Risque** : confondre le flux arrhes avec le flux de paiement normal, risquant de fausser `amountDue`. **Mitigation** : `recordDepositPayment()` ne touche jamais `Invoice.amountPaid`/`amountDue` — testé explicitement.
- **Risque** : double dépôt ou double forfait sur le même proforma. **Mitigation** : gardes explicites testées (Test 4, Test 7).
- **Risque** : `InvoiceEvent` mal peuplé (premier écrivain réel dans ce codebase, aucun pattern existant à copier). **Mitigation** : lecture attentive du modèle (`invoiceId`, `type`, `amount`, `actorId?`, `metadata?`) avant écriture, tests explicites sur le contenu exact de l'événement créé.
