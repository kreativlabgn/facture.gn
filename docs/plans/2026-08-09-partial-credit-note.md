# Plan : Avoir partiel sur des lignes précises (C7, ADR-040)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`) — nouveau périmètre `credit-notes/`
- Persona affecté : organisation qui doit corriger une facture déjà émise (retour marchandise, erreur de ligne) sans jamais pouvoir la modifier directement (immuabilité post-émission, principe déjà répété dans ce repo)
- Données sensibles manipulées : aucune nouvelle (montants déjà couverts par la rigueur bigint existante)
- Impact réglementaire : OHADA/SYSCOHADA — l'avoir est le mécanisme de correction comptable légal d'une facture émise, jamais une modification directe

## Investigation préalable (source de vérité)
Le backlog ne donne que le titre + Réf ADR-040 ("Avoir au niveau ligne (credit_note_line). Décision : Référence invoice_line_id, réajustement stock par branche."), sans bullets. **`ERD-facture-gn.md` (non consulté dans les stories précédentes de cette session) donne la définition canonique champ par champ** :

```
CREDIT_NOTE : id, invoice_id (FK), amount (bigint centimes), refund_multiplier (1|2, "arrhes + annulation pro"), reason, created_at
CREDIT_NOTE_LINE : id, credit_note_id (FK), invoice_line_id (FK), quantity_returned (integer)
```

Points clés tirés de cette source :
- `CREDIT_NOTE_LINE.quantity_returned` est une **quantité**, pas un montant — la ventilation monétaire par ligne n'existe pas dans l'ERD, seul `CREDIT_NOTE.amount` (un total) existe. Le "niveau ligne" d'ADR-040 sert à tracer QUELLES lignes et COMBIEN d'unités, pas à recalculer un HT/TVA par ligne.
- Aucun champ de stock/succursale n'apparaît dans `CREDIT_NOTE`/`CREDIT_NOTE_LINE` — confirmé par grep qu'aucun modèle `Product`/`Branch`/`Stock` n'existe dans `schema.prisma` aujourd'hui. "Réajustement stock par branche" (texte de décision d'ADR-040) est donc une conséquence documentée pour une V1/V2 future (Grille-Offres/Capital Layer), pas un livrable de cette story MVP — **hors scope explicite**.
- `refund_multiplier` référence directement ADR-034 (C5, déjà construit) : "refund_multiplier 2x" pour arrhes+annulation professionnelle. Le mécanisme C5 existant (`forfeitDeposit()`) reste néanmoins inchangé — il écrit déjà son propre `InvoiceEvent` sur le proforma, un chemin entièrement séparé. `refund_multiplier` est accepté ici comme un champ du modèle (par défaut 1), sans intégration profonde avec C5 — une intégration future si un besoin se précise, pas un blocage.
- `REFUND` (C13, story backlog séparée : "refund ne peut être créé que sur un credit_note existant") dépend de `CREDIT_NOTE` mais reste explicitement hors scope de cette story — cette story livre uniquement l'émission de l'avoir, pas le remboursement effectif.

## Problème (en 3 lignes max)
Aucun mécanisme ne permet aujourd'hui de corriger une facture déjà émise — le principe "toute correction passe par un avoir" est répété trois fois dans le code (`updateDraft()`, `void()`) sans qu'aucun `CreditNote` n'existe.

## Solution retenue (en 5 lignes max)
Deux nouveaux modèles (`CreditNote`, `CreditNoteLine`, schema fidèle à l'ERD). `POST /invoices/:id/credit-notes` (owner/admin/cashier, même trio que issue/convert/forfeit/regenerate) : garde une facture réelle et déjà émise (`documentType="invoice"`, `status ∈ {issued, partially_paid, paid}`), valide que chaque ligne créditée appartient bien à la facture et que la quantité demandée ne dépasse jamais le solde encore créditable (quantité originale moins déjà créditée par d'éventuels avoirs précédents — protection contre le sur-crédit), calcule `amount` **côté serveur** (jamais fait confiance au client, cohérent avec C4) à partir de `quantityReturned × invoiceLine.unitPrice`. L'avoir ne modifie ni `Invoice.totalTtc` (immuable, fidèle à l'historique de facturation) ni `Invoice.amountDue`/`amountPaid` — mécanisme délibérément séparé, même précédent que les arrhes (C5 : "jamais appliqué à Invoice.amountPaid/amountDue").

## Alternatives écartées
Faire de l'avoir un mouvement direct sur `Invoice.amountDue` (le réduire du montant crédité) — écartée : ni l'ERD ni aucun ADR ne spécifie cet effet, et le précédent direct de ce repo (arrhes, C5 : "l'arrhes est un dépôt de sécurité indépendant du solde de la facture, jamais appliqué à `amountPaid`/`amountDue`") établit qu'un document financier annexe reste délibérément dans un bucket séparé plutôt que de muter silencieusement le solde d'une facture immuable. Le remboursement effectif (C13, `REFUND`) est le mécanisme naturel pour tout mouvement d'argent réel — hors scope ici.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — modèles `CreditNote`/`CreditNoteLine` fidèles à l'ERD, relations sur `Invoice`/`InvoiceLine`, migration manuelle
- [ ] Tâche 2 : `apps/trust-api/src/credit-notes/dto/create-credit-note.dto.ts` (nouveau) — `reason` (string non-vide), `refundMultiplier` (1 ou 2, défaut 1), `lines` (array non-vide de `{invoiceLineId, quantityReturned}`)
- [ ] Tâche 3 : `apps/trust-api/src/credit-notes/credit-notes.service.ts` (nouveau) — `create(invoiceId, dto)` : garde de statut/type, garde par ligne (appartenance + quantité disponible), calcul serveur du montant, transaction Prisma (CreditNote + CreditNoteLine[])
- [ ] Tâche 4 : `apps/trust-api/src/credit-notes/credit-notes.controller.ts` (nouveau) — `POST /invoices/:id/credit-notes`, `@Roles("owner","admin","cashier")`
- [ ] Tâche 5 : `apps/trust-api/src/credit-notes/credit-notes.module.ts` (nouveau) + câblage dans `app.module.ts`

## Tests à écrire AVANT le code
- [ ] Test 1 (`credit-notes.service.spec.ts`) : avoir créé avec succès, `amount` calculé serveur = `quantityReturned × unitPrice`, jamais la valeur fournie par le client si elle diffère
- [ ] Test 2 : refuse sur une facture `draft` (rien n'a encore été émis)
- [ ] Test 3 : refuse sur un `documentType` ≠ `invoice` (proforma/devis — un avoir corrige une VRAIE facture)
- [ ] Test 4 : refuse une ligne qui n'appartient pas à la facture ciblée
- [ ] Test 5 : refuse une `quantityReturned` supérieure à la quantité originale de la ligne
- [ ] Test 6 : refuse une `quantityReturned` qui dépasserait le solde encore créditable après un avoir précédent sur la même ligne (protection anti sur-crédit)
- [ ] Test 7 : n'affecte JAMAIS `Invoice.totalTtc`/`amountDue`/`amountPaid` — non-régression explicite du principe "bucket séparé" (précédent C5)
- [ ] Test 8 : `refundMultiplier` par défaut 1, accepté explicitement à 2

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- Migration Prisma appliquée et vérifiée (`prisma migrate deploy`)
- code-reviewer OK
- domain-model-reviewer recommandé (nouveau modèle de domaine, invariants de quantité à valider rigoureusement)

## Risques identifiés & mitigations
- Risque 1 : sur-crédit d'une ligne via plusieurs avoirs successifs → mitigation : somme des `quantityReturned` déjà émis pour cette ligne vérifiée avant d'accepter un nouvel avoir (Test 6).
- Risque 2 : confusion future sur l'effet (ou l'absence d'effet) de l'avoir sur le solde de la facture → mitigation : commentaire explicite dans le code, miroir du principe déjà documenté pour les arrhes (C5).
