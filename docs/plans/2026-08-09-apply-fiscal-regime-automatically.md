# Plan : C4 — Appliquer le bon régime fiscal automatiquement

## Contexte facture.gn
- Module : Trust Context — `apps/trust-api/src/invoices/`
- Persona affecté : toute organisation émettrice (impact silencieux — conformité DGI)
- Données sensibles manipulées : montants financiers (calcul fiscal), aucune PII
- Impact réglementaire : OHADA/SYSCOHADA — ADR-033 ("jamais un taux TVA plat"), ADR-057

## Problème (en 3 lignes max)
`taxRateBps` est aujourd'hui un champ client arbitraire, sans lien avec `organization.regimeFiscal`. `Invoice.totalHt`/`totalTva` ne sont jamais calculés (toujours 0) — aucun calcul de TVA n'existe dans le système, malgré un régime fiscal obligatoire à l'inscription (DAT §12, "jamais un défaut TVA silencieux").

## Solution retenue (en 5 lignes max)
`createDraft()` charge l'organisation (nouveau, elle ne l'était pas avant) et dérive `taxRateBps` exclusivement depuis `organization.regimeFiscal` via une fonction pure `resolveTaxRateBps` (`normal_tva`→1800, `tpu`/`normal_sans_tva`/`non_assujetti_association`→0, DAT §12 ligne 217). `totalHt = totalTtc × 10000 / (10000 + taxRateBps)` (division entière bigint, arrondi vers le bas), `totalTva = totalTtc - totalHt` (garantit l'invariant `totalHt + totalTva === totalTtc` exactement, aucune dérive d'arrondi). `taxRateBps` du DTO client est retiré — le taux n'est plus jamais une valeur de confiance externe.

## Alternatives écartées
- **Calculer à `issue()` plutôt qu'à `createDraft()`** — écarté : `totalTtc` et les lignes sont déjà figés dès le brouillon dans le code existant (`issue()` ne touche jamais aux montants, seulement à la certification) ; calculer ailleurs introduirait une incohérence avec ce pattern déjà établi.
- **Convention HT-first** (`unitPrice` = prix hors taxe, TVA ajoutée par-dessus) — écarté : le code existant calcule déjà `totalTtc` comme somme brute de `quantity×unitPrice` sans aucun ajustement, donc `unitPrice` est déjà implicitement TTC. Changer la convention casserait la sémantique de toutes les factures déjà émises en session.
- **Garder `taxRateBps` dans le DTO mais l'ignorer silencieusement** — écarté : rendre l'état invalide irreprésentable (le client ne peut plus se tromper sur qui calcule le taux) vaut mieux qu'ignorer un input qui donnerait l'illusion d'un contrôle qu'il n'a pas.
- **Champs HT/TVA par ligne (`InvoiceLine`)** — écarté : le taux ne dépend que de l'organisation, jamais de la ligne ; toutes les lignes d'une même facture partagent le même taux, donc `taxRateBps` par ligne devient une valeur dérivée identique sur toutes les lignes, sans besoin de nouveaux champs ni de migration.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] Tâche 1 : `apps/trust-api/src/invoices/tax-regime.ts` (nouveau fichier) — fonction pure `resolveTaxRateBps(regimeFiscal: RegimeFiscal): number`, carte régime→bps
- [ ] Tâche 2 : `apps/trust-api/src/invoices/dto/create-invoice.dto.ts` — retirer le champ `taxRateBps` de `invoiceLineSchema`
- [ ] Tâche 3 : `apps/trust-api/src/invoices/invoices.service.ts` — `createDraft()` charge l'organisation (`findUniqueOrThrow`), dérive le taux via `resolveTaxRateBps`, calcule `totalHt`/`totalTva`, les persiste avec `totalTtc`, applique le taux dérivé à `taxRateBps` de chaque ligne

## Tests à écrire AVANT le code
- [ ] Test 1 : `tax-regime.spec.ts` — `resolveTaxRateBps` retourne 1800 pour `normal_tva`, 0 pour `tpu`/`normal_sans_tva`/`non_assujetti_association`
- [ ] Test 2 : `invoices.service.spec.ts` — `createDraft()` sur une organisation `normal_tva` calcule `totalHt`/`totalTva` cohérents avec 18% (ex. totalTtc=1 180 000 → totalHt=1 000 000, totalTva=180 000)
- [ ] Test 3 : `invoices.service.spec.ts` — `createDraft()` sur une organisation `tpu` a `totalTva=0`, `totalHt=totalTtc`
- [ ] Test 4 : `invoices.service.spec.ts` — invariant `totalHt + totalTva === totalTtc` vérifié explicitement sur un montant qui ne se divise pas exactement par 1,18 (cas d'arrondi réel)
- [ ] Test 5 : `create-invoice.dto.spec.ts` — un `taxRateBps` fourni par le client sur une ligne est maintenant rejeté par le schema (champ retiré, `strict()` ou simplement absent du schema Zod)

## Critères de done
- Tous les tests verts (suite complète, pas seulement les nouveaux)
- Build/lint/typecheck verts
- Invariant `totalHt + totalTva === totalTtc` vérifié dans au moins un cas d'arrondi non trivial
- Vérification E2E réelle : organisation `normal_tva` → facture avec `totalHt`/`totalTva` cohérents à 18% ; organisation `tpu` → `totalTva=0` ; non-régression sur le flux d'émission déjà testé (B1/B4)
- `dev-code-reviewer` OK
- `dev-domain-model-reviewer` recommandé (invariant métier monétaire nouveau)

## Risques identifiés & mitigations
- **Risque** : dérive d'arrondi bigint faisant que `totalHt + totalTva ≠ totalTtc`. **Mitigation** : `totalTva` toujours dérivé par soustraction (`totalTtc - totalHt`), jamais recalculé indépendamment — garantit l'égalité par construction, testée explicitement sur un cas non-divisible.
- **Risque** : `createDraft()` gagne un aller-retour DB (chargement de l'organisation) qu'il n'avait pas avant. **Mitigation** : coût minime, `createDraft()` n'est pas sur le chemin SLA critique (`< 2s` s'applique à l'émission via `issue()`, pas au brouillon).
- **Risque** : retirer `taxRateBps` du DTO casse un appelant existant. **Mitigation** : vérifié par grep — aucun test ni usage réel ne s'appuie dessus aujourd'hui.
