# Plan : C15 — Créer une proforma et la convertir en facture

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/invoices/`
- Persona affecté : toute organisation émettrice (ex. Djénabou, hôtellerie — prépare C5)
- Données sensibles manipulées : montants financiers, aucune PII nouvelle
- Impact réglementaire : OHADA/SYSCOHADA — ADR-064

## Problème (en 3 lignes max)
`issue()` ne vérifie jamais `documentType` : un proforma peut aujourd'hui être émis directement comme une vraie facture certifiée, contournant ADR-064 ("/issue rejeté si document_type ≠ invoice"). Aucune conversion proforma→facture n'existe, alors que `convertedToInvoiceId` et le statut `converted` sont déjà scaffoldés dans le schema, jamais câblés.

## Solution retenue (en 5 lignes max)
`issue()` rejette désormais (`ConflictException`) tout `documentType ≠ "invoice"`. Nouvelle méthode `convertToInvoice(proformaId)` : charge le proforma, refuse s'il n'est pas `documentType="proforma"` en statut `draft`, recharge l'organisation fraîchement et recalcule le régime fiscal (ADR-064 "recalcule le régime" — jamais une copie des lignes existantes), crée une NOUVELLE facture `draft` avec les lignes recopiées au taux recalculé, et marque le proforma `converted` avec `convertedToInvoiceId` pointant vers la nouvelle facture — le tout dans une seule transaction Prisma.

## Alternatives écartées
- **Convertir "en place"** (muter le proforma existant en facture) — écarté : ADR-064 est explicite ("Conversion crée une NOUVELLE facture"), et la numérotation FG- séquentielle doit rester propre à un document réellement émis, jamais rétroactivement attribuée à un brouillon proforma qui n'a jamais existé comme facture.
- **Copier le `taxRateBps` déjà stocké sur les lignes du proforma** — écarté : viole "recalcule le régime" (ADR-064) explicitement ; même si `regimeFiscal` n'est modifiable nulle part aujourd'hui, l'implémenter correctement maintenant évite une dette technique qui deviendrait un bug silencieux le jour où un mécanisme de changement de régime existera.
- **Gérer aussi les devis (`quote`) dans ce plan** — écarté : C16 est une story séparée `[SHOULD]`, hors scope.
- **Construire la logique d'arrhes (`deposit_type`)** — écarté : c'est le périmètre de C5. "Proforma accepte arrhes uniquement" est déjà structurellement garanti par la combinaison statut `draft` + garde `/issue`, sans code supplémentaire — un proforma ne peut recevoir aucun paiement aujourd'hui, ce qui est un sous-ensemble sûr de "arrhes uniquement" tant qu'arrhes n'existe pas encore comme concept distinct.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `apps/trust-api/src/invoices/invoices.service.ts` — `issue()` rejette `documentType ≠ "invoice"` (`ConflictException`, avant toute autre logique d'émission)
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.service.ts` — nouvelle méthode `convertToInvoice(proformaId)` : gardes (type, statut), rechargement organisation, recalcul régime, création facture + mise à jour proforma en transaction
- [ ] Tâche 3 : `apps/trust-api/src/invoices/invoices.controller.ts` — route `POST /invoices/:id/convert-to-invoice`, `@Roles("owner", "admin", "cashier")` (même trio que `/issue`)

## Tests à écrire AVANT le code
- [ ] Test 1 : `invoices.service.spec.ts` — `issue()` rejette un `documentType="proforma"` avec un message explicite, jamais un 500 brut
- [ ] Test 2 : `invoices.service.spec.ts` — `convertToInvoice()` refuse un document qui n'est pas `documentType="proforma"` (ex. tenter de convertir une facture déjà `invoice`)
- [ ] Test 3 : `invoices.service.spec.ts` — `convertToInvoice()` refuse un proforma déjà `converted` (empêche une double conversion)
- [ ] Test 4 : `invoices.service.spec.ts` — `convertToInvoice()` crée une nouvelle facture `draft` avec `documentType="invoice"`, marque le proforma original `converted` avec `convertedToInvoiceId` pointant vers la nouvelle facture
- [ ] Test 5 : `invoices.service.spec.ts` — `convertToInvoice()` recalcule le régime fiscal depuis l'organisation ACTUELLE, pas depuis les lignes déjà stockées sur le proforma (scénario : organisation dont le `regimeFiscal` mocké diffère entre la création du proforma et la conversion — confirme que le code relit `organization.regimeFiscal` à la conversion, pas une valeur figée)
- [ ] Test 6 : `invoices.controller.spec.ts` (nouveau fichier ou existant) — la route `convert-to-invoice` délègue correctement au service avec l'id du paramètre d'URL

## Critères de done
- Tous les tests verts (suite complète)
- Build/lint/typecheck verts
- Invariant `totalHt+totalTva=totalTtc` respecté sur la nouvelle facture (protégé par la contrainte CHECK déjà en place depuis C4)
- Vérification E2E réelle : créer un proforma → tenter `/issue` directement (doit échouer, 409) → convertir en facture → nouvelle facture `draft` avec régime recalculé → émettre la nouvelle facture normalement (doit réussir)
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` recommandé (nouvel invariant : un proforma ne peut jamais être `issued` directement ni recevoir de paiement)

## Risques identifiés & mitigations
- **Risque** : transaction non-atomique laissant un proforma `draft` avec une facture fantôme en cas d'échec partiel. **Mitigation** : `$transaction` Prisma englobant la création de la nouvelle facture ET la mise à jour du proforma, même pattern déjà établi (`organizations.service.ts:create()`).
- **Risque** : double conversion d'un même proforma. **Mitigation** : garde explicite sur `status === "draft"` avant conversion — un proforma déjà `converted` est rejeté.
- **Risque** : régime fiscal figé depuis la création du proforma plutôt que recalculé à la conversion (violation ADR-064 silencieuse). **Mitigation** : rechargement explicite de l'organisation dans `convertToInvoice()`, jamais une réutilisation des `taxRateBps` déjà stockés sur les lignes du proforma — testé explicitement (Test 5).
