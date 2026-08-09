# Plan : Remboursement après avoir (C13, ADR-063)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — nouveau périmètre `refunds/`, dépend directement de `credit-notes/` (C7, mergée)
- Persona affecté : organisation ayant émis un avoir qui doit enregistrer le mouvement d'argent réel correspondant
- Données sensibles manipulées : aucune nouvelle (montants déjà couverts par la rigueur bigint existante)
- Impact réglementaire : OHADA/SYSCOHADA — ADR-063 distingue explicitement l'avoir (document comptable) du remboursement (mouvement d'argent réel), deux faits distincts à tracer séparément

## Investigation préalable
Backlog (texte complet, contrairement à C7) : "En tant qu'organisation ayant émis un avoir, je veux enregistrer le remboursement réel... - refund ne peut être créé que sur un credit_note existant - Modes : cash, payment_link_payout (Djomy Payout, fallback Moneroo), virement, crédit en compte." ADR-063 confirme et précise.

`ERD-facture-gn.md` donne la définition canonique :
```
REFUND : id, credit_note_id (FK), invoice_id (FK), amount (bigint), method (cash/payment_link_payout/bank_transfer/credit_on_account), provider_ref (nullable), status (pending/completed/failed), created_at, completed_at (nullable)
```

**Découverte bloquante pour le scope** : aucune intégration "Djomy Payout" n'existe nulle part dans ce repo (confirmé par grep exhaustif sur `apps/money-api` et `apps/trust-api`). ADR-089 (FINANCIAL_PARTNER, `payout_fee_djomy_bps`) confirme explicitement que Djomy Payout est un mécanisme **V2**, pas encore construit. Construire l'appel API réel + confirmation webhook pour `payment_link_payout` serait une brique d'infrastructure Money Context entièrement nouvelle — hors scope de cette story SHOULD, même raisonnement que l'exclusion de l'intégration WhatsApp/SMS (C9) plus tôt dans cette session.

## Problème (en 3 lignes max)
`InvoiceEventType.refund_issued` existe déjà dans le schema (scaffoldé) mais aucun modèle `Refund` n'existe — un avoir (C7) reste aujourd'hui un document comptable sans aucun moyen d'enregistrer le mouvement d'argent réel qui le solde.

## Solution retenue (en 5 lignes max)
Nouveau modèle `Refund` (fidèle à l'ERD) et route `POST /credit-notes/:id/refunds` (owner/admin — action plus sensible que l'avoir lui-même, cash réel sortant). Garde anti-sur-remboursement : somme des `Refund.amount` déjà émis (statut ≠ `failed`) pour cet avoir ne doit jamais dépasser `CreditNote.amount`, même précédent que la garde anti-sur-crédit de C7. `cash`/`bank_transfer`/`credit_on_account` sont des attestations immédiates du staff (`status: completed`, même principe que `recordCashPayment()`/`recordBankTransferPayment()`, C1/C3) ; `payment_link_payout` est créé `status: pending` — aucune exécution ni confirmation automatique construite ici (hors scope, V2). Écrit un `InvoiceEvent(type: refund_issued)` dans la même transaction que le `Refund` — même précédent que le fix de C18 (atomicité action financière/trace d'audit).

## Alternatives écartées
Construire l'appel Djomy Payout réel (API + webhook de confirmation) pour `payment_link_payout` — écartée : aucune infrastructure Money Context pour les payouts n'existe dans ce repo, ADR-089 la classe explicitement V2. Le champ `method` accepte la valeur (fidèle à l'ERD), mais son exécution réelle est hors scope MVP.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — enums `RefundMethod`/`RefundStatus`, modèle `Refund` (fidèle à l'ERD), relations sur `CreditNote`/`Invoice`, migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/common/rbac/roles.guard.ts` — étendre `@OrganizationIdSource()` avec la valeur `"credit-note"` (résout `params.id` comme un `CreditNote` → son `invoice.organizationId`), même pattern que l'extension `"organization"` de E8
- [ ] Tâche 3 : `apps/trust-api/src/refunds/dto/create-refund.dto.ts` (nouveau) — `amount` (bigint positif), `method` (enum à 4 valeurs)
- [ ] Tâche 4 : `apps/trust-api/src/refunds/refunds.service.ts` (nouveau) — `create(creditNoteId, dto, actorId)` : charge l'avoir, garde anti-sur-remboursement (`aggregate` sur les refunds non-`failed`), détermine le statut initial selon `method`, transaction `Refund.create` + `InvoiceEvent(refund_issued)`
- [ ] Tâche 5 : `apps/trust-api/src/refunds/refunds.controller.ts` + `refunds.module.ts` (nouveaux) — `POST /credit-notes/:id/refunds`, `@Roles("owner","admin")` + `@OrganizationIdSource("credit-note")`, câblage dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] Test 1 (`roles.guard.spec.ts`) : `@OrganizationIdSource("credit-note")` résout `params.id` comme un avoir → organisation de sa facture ; 404 si l'avoir n'existe pas
- [ ] Test 2 (`refunds.service.spec.ts`) : remboursement `cash` créé avec succès, `status: completed`, `completedAt` renseigné
- [ ] Test 3 : remboursement `payment_link_payout` créé avec `status: pending`, `completedAt: null` — aucune exécution automatique
- [ ] Test 4 : refuse un remboursement dont le montant dépasse le solde encore remboursable de l'avoir
- [ ] Test 5 : accepte plusieurs remboursements partiels cumulés jusqu'au montant total de l'avoir, refuse le dépassement au-delà
- [ ] Test 6 : un remboursement `failed` n'est PAS compté dans le solde déjà remboursé (peut être retenté)
- [ ] Test 7 : écrit un `InvoiceEvent(type: refund_issued, actorId)` dans la même transaction que le `Refund`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante, `roles.guard.spec.ts` non-régressé)
- Migration Prisma appliquée et vérifiée
- code-reviewer OK — attention à la non-régression du guard partagé (3e extension de `@OrganizationIdSource`)
- domain-model-reviewer recommandé (nouveau modèle financier, invariants de solde à valider)

## Risques identifiés & mitigations
- Risque 1 : casser une route `@Roles()` existante en étendant `RolesGuard` une 3e fois → mitigation : défaut `"invoice"` inchangé, suite complète relancée, E2E réel sur une route non-décorée (même protocole que E8).
- Risque 2 : confusion future sur le statut `pending` de `payment_link_payout` (aucun mécanisme ne le fait jamais progresser vers `completed`) → mitigation : commentaire explicite dans le code, limitation documentée comme hors scope V2.
