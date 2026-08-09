# Plan : Remise globale à la création d'une facture (E2)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`)
- Persona affecté : toute organisation émettrice (Aissatou, Djénabou...) qui veut offrir une remise ponctuelle
- Données sensibles manipulées : aucune (montants uniquement, déjà couverts par la rigueur bigint existante — TTC-first, ADR-033/057)
- Impact réglementaire : OHADA (le total HT/TVA affiché doit rester cohérent après remise — même formule de dérivation que C4, pas de nouveau risque)

## Problème (en 3 lignes max)
`Invoice.discountPct` existe déjà dans le schema (scaffoldé, `@default(0)`) mais n'est lu ni écrit nulle part dans le code applicatif : aucune organisation ne peut aujourd'hui appliquer une remise globale à une facture, malgré le champ prêt en DB.

## Solution retenue (en 5 lignes max)
Accepter `discountPct` (0–100, optionnel, défaut 0) sur `POST /invoices`. `createDraft()` réduit `totalTtc` du pourcentage AVANT `computeTaxBreakdown()` (division bigint, arrondi vers le bas, cohérent avec la convention existante) ; `amountDue` reflète déjà ce total net, aucun changement de logique là. `convertToInvoice()` (C15) copie `proforma.discountPct` vers la nouvelle facture pour traçabilité — le montant est déjà net car `proforma.totalTtc` est réutilisé tel quel.

## Alternatives écartées
Une route `PATCH /invoices/:id` dédiée pour modifier la remise d'un brouillon existant a été écartée : aucune route de modification n'est exposée aujourd'hui (`updateDraft()` existe dans le service mais n'est appelée par aucun controller) — l'ajouter serait hors scope de cette story minimaliste (YAGNI, cohérent avec l'absence de bullets dans le backlog pour E2).

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/dto/create-invoice.dto.ts` — ajouter `discountPct: z.number().int().min(0).max(100).default(0)` à `createInvoiceSchema`
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.service.ts:createDraft()` — calculer `totalTtcNet = totalTtcBrut - (totalTtcBrut * BigInt(dto.discountPct)) / 100n`, appeler `computeTaxBreakdown(totalTtcNet, taxRateBps)`, persister `discountPct: dto.discountPct` et `amountDue: totalTtcNet`
- [ ] Tâche 3 : `apps/trust-api/src/invoices/invoices.service.ts:convertToInvoice()` — ajouter `discountPct: proforma.discountPct` aux données de la nouvelle facture créée

## Tests à écrire AVANT le code
- [ ] Test 1 (`create-invoice.dto.spec.ts`) : `discountPct` absent → valeur par défaut 0 (rétrocompatibilité, aucune facture existante cassée)
- [ ] Test 2 (`create-invoice.dto.spec.ts`) : `discountPct` à 101 ou -1 → rejeté par le schema
- [ ] Test 3 (`invoices.service.spec.ts`) : `createDraft()` avec `discountPct: 10` sur un total brut de 100 000 GNF → `totalTtc` persisté = 90 000, `amountDue` = 90 000, `discountPct` = 10
- [ ] Test 4 (`invoices.service.spec.ts`) : `createDraft()` sans `discountPct` (ou 0) → comportement strictement inchangé vs. avant cette story (non-régression explicite)
- [ ] Test 5 (`invoices.service.spec.ts`) : `convertToInvoice()` sur un proforma avec `discountPct: 15` → la nouvelle facture a `discountPct: 15`

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK
- security-reviewer : non obligatoire (aucune donnée sensible), mais domain-model-reviewer recommandé (Invoice.discountPct est un champ existant qui devient actif — vérifier que l'invariant totalHt+totalTva=totalTtc, protégé par CHECK SQL, tient toujours avec un total net de remise)

## Risques identifiés & mitigations
- Risque 1 : arrondi bigint créant un écart d'1 GNF entre `totalHt+totalTva` et `totalTtc` sous remise → mitigation : `computeTaxBreakdown()` dérive toujours `totalTva` par soustraction (`totalTtc - totalHt`), jamais un calcul indépendant — l'invariant tient structurellement quel que soit le totalTtc en entrée, remise ou non.
- Risque 2 : un discountPct à 100 produirait une facture à 0 GNF sans qu'aucune règle métier ne l'empêche → accepté comme un cas valide (une facture à titre gracieux existe déjà en pratique), pas de garde supplémentaire nécessaire pour cette story.
