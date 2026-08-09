# Plan : Montant de référence en devise étrangère (I3, ADR-055)

## Contexte facture.gn
- Module : Trust Context (`apps/trust-api`), périmètre `invoices/`
- Persona affecté : organisation qui facture en GNF mais veut afficher un équivalent informatif en devise étrangère (diaspora, partenaire international)
- Données sensibles manipulées : aucune
- Impact réglementaire : aucun — ADR-055 est explicite : "Aucune valeur contractuelle", jamais dans le payload signé (FGN-Canon-v1)

## Problème (en 3 lignes max)
`Invoice.referenceCurrency/referenceAmount/fxRate/fxRateDate` existent déjà dans le schema (scaffoldés) mais ne sont ni lus ni écrits nulle part — aucune organisation ne peut aujourd'hui afficher un montant de référence en devise étrangère sur une facture.

## Solution retenue (en 5 lignes max)
Les 4 champs sont ajoutés à `createInvoiceSchema`, groupés par un `.refine()` "tous ou aucun" (même précédent que NIF/etaxNumber) puisqu'ils forment un seul instantané de change cohérent. `fxRate` (Decimal Prisma) est accepté comme string validée par regex, jamais un `number` JS, pour éviter toute perte de précision flottante. `createDraft()` les persiste tels quels si fournis — aucun calcul, aucune vérification de cohérence avec `totalTtc` (purement déclaratif, conforme à "aucune valeur contractuelle"). Non copiés lors d'une conversion proforma/devis→facture (C15/C16) : contrairement à `discountPct`, un taux de change peut avoir changé entre création et conversion.

## Alternatives écartées
Calculer `fxRate` côté serveur à partir d'une API de taux de change externe — écartée : ADR-055 dit explicitement "aucune valeur contractuelle", la donnée est fournie et assumée par l'organisation elle-même, pas une garantie du système. Ajouter une intégration externe pour un champ purement informatif serait disproportionné (YAGNI) et introduirait une dépendance réseau non demandée par le backlog.

## Découpage en tâches bite-sized
- [ ] Tâche 1 : `apps/trust-api/src/invoices/dto/create-invoice.dto.ts` — ajouter `referenceCurrency` (regex `/^[A-Z]{3}$/`), `referenceAmount` (`z.coerce.bigint().positive()`), `fxRate` (string, regex décimal), `fxRateDate` (`z.coerce.date()`), tous optionnels, avec `.refine()` "les 4 ensemble ou aucun"
- [ ] Tâche 2 : `apps/trust-api/src/invoices/invoices.service.ts:createDraft()` — persister les 4 champs depuis le DTO s'ils sont fournis

## Tests à écrire AVANT le code
- [ ] Test 1 (`create-invoice.dto.spec.ts`) : les 4 champs absents → accepté (valeurs `undefined`, non-régression)
- [ ] Test 2 (`create-invoice.dto.spec.ts`) : les 4 champs fournis correctement → accepté
- [ ] Test 3 (`create-invoice.dto.spec.ts`) : un seul champ fourni parmi les 4 → rejeté par le `.refine()`
- [ ] Test 4 (`create-invoice.dto.spec.ts`) : `referenceCurrency` invalide (pas 3 lettres majuscules, ex. "usd" ou "US") → rejeté
- [ ] Test 5 (`invoices.service.spec.ts`) : `createDraft()` avec les 4 champs fournis → persistés tels quels sur l'`Invoice` créée
- [ ] Test 6 (`invoices.service.spec.ts`) : `createDraft()` sans ces champs → comportement inchangé (non-régression explicite)

## Critères de done
- Tous les tests verts (nouveaux + suite complète existante)
- Aucune donnée sensible loggée
- Aucun hardcoded secret
- code-reviewer OK
- security-reviewer : non nécessaire (aucune donnée sensible, champs purement informatifs)

## Risques identifiés & mitigations
- Risque 1 : perte de précision sur `fxRate` si accepté comme `number` JS → mitigation : accepté et transmis comme `string` de bout en bout (DTO Zod → Prisma Decimal), jamais converti en `number`.
- Risque 2 : confusion future si quelqu'un copie ces champs lors d'une conversion proforma/devis→facture, pensant reproduire le pattern `discountPct` → mitigation : commentaire explicite dans `convertToInvoice()` expliquant pourquoi ces champs ne sont PAS copiés (taux de change potentiellement obsolète).
