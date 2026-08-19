# Plan : E7 — Consulter la marge par produit et par vente

## Contexte projet
- Module : Trust Context — modification de `apps/trust-api/src/invoices` (créat­ion de ligne, chemin critique déjà stable/certifié) + nouveau module `apps/trust-api/src/margin`
- Persona affecté : owner/admin (direct), `business_manager` (mandat cabinet/CGA, `Mandate.grantedRole`, jamais un `OrganizationRole` direct)
- Données sensibles manipulées : `cost_price`/marge — donnée commerciale la plus sensible du domaine (ADR-084 la réserve déjà strictement)
- Impact réglementaire : aucun

## Clarifications
- Q: `business_manager` est-il un `OrganizationRole` ? → R: **Non** — commentaire explicite du schéma ("jamais un OrganizationRole"), c'est un `MandateGrantedRole` (mandat cabinet/CGA, comme `accountant_external`). L'accès suit le pattern déjà éprouvé par `FecService`/`OrganizationAccessService.assertAccess()` (double chemin : `OrganizationMember` OU `PracticeMember` avec mandat actif), jamais `@Roles()`.
- Q: `assertAccess()` actuel ne filtre pas par `grantedRole` (FEC accepte tout `PracticeMember` avec mandat actif, peu importe le rôle) — faut-il le dupliquer ou l'étendre ? → R: **Étendre** avec un paramètre optionnel `requiredMandateGrantedRole?: MandateGrantedRole`, ajouté au `where` de la requête `mandate.findFirst`. Rétrocompatible : FEC continue de fonctionner sans le passer (accepte tout rôle de mandat, comportement inchangé).
- Q: Le snapshot `cost_price_at_time` doit-il se faire à `createDraft()` (création) ou `issue()` (émission) ? → R: **`createDraft()`** — `issue()` ne touche jamais `lines` (vérifié : les lignes sont créées une seule fois, immuables ensuite). "Au moment de la facturation" (ADR-084) = au moment où la ligne existe, pas à l'émission.
- Q: Le DTO `createInvoiceSchema` doit-il rendre `productId` obligatoire par ligne ? → R: **Non, optionnel** — rétrocompatibilité totale avec tous les appelants existants (vente libre sans référence produit, cas majoritaire actuel). Une ligne sans `productId` n'a simplement pas de marge calculable (`costPriceAtTime: null`), jamais une erreur.
- Q: Quelles factures comptent pour le calcul de marge (draft/voided inclus) ? → R: **Non** — même filtre que `FecService` (`status: { in: ["issued", "partially_paid", "paid"] }`), cohérent avec "marge RÉALISÉE" du Backlog : un brouillon jamais émis n'est pas une vente réelle.
- Q: Une vue par produit ET une vue par vente (ligne) — un seul endpoint ou deux ? → R: **Deux** — `GET /organizations/:id/margin/lines` (détail par ligne, "par vente") et `GET /organizations/:id/margin/by-product` (agrégation, "par produit"). Les deux répondent explicitement aux deux clauses du Backlog, sans complexifier un seul contrat de réponse hétérogène.
- Q: `productId` référencé dans une ligne doit-il devenir une vraie FK Prisma (actuellement scalaire sans relation, voir commentaire schema.prisma) ? → R: **Oui** — E10 a fait exister `Product`, la condition qui empêchait la FK ("tant que PRODUCT... n'existe pas") n'est plus vraie. Migration : `InvoiceLine.productId` passe de scalaire à relation `Product?`.

## Problème (en 3 lignes max)
`InvoiceLine.costPriceAtTime` existe en base depuis le début (ADR-084) mais n'est renseigné par aucun code — aucune ligne de facture ne référence jamais de `Product`. La marge n'a donc littéralement aucune donnée à afficher.

## Solution retenue (en 5 lignes max)
`createInvoiceSchema` accepte un `productId` optionnel par ligne ; `createDraft()` résout les produits référencés (IDOR vérifié : appartenance à l'organisation), snapshotte `costPrice` dans `costPriceAtTime` à la création. `InvoiceLine.productId` devient une vraie FK. Deux endpoints de lecture (`.../margin/lines`, `.../margin/by-product`) exposent la marge, protégés par `OrganizationAccessService.assertAccess()` étendu (owner/admin OU mandat `business_manager` actif) — jamais `@Roles()`, jamais accessible à cashier/field_agent.

## Alternatives écartées
- **`productId` obligatoire par ligne** — écartée : casserait tous les appelants existants (vente libre), contredit "la création du produit n'est jamais bloquée" (E6) appliqué par extension à la vente elle-même.
- **Recalcul rétroactif de la marge si `cost_price` change** — écartée explicitement par le Backlog ("jamais recalculée rétroactivement") — `costPriceAtTime` est un snapshot immuable, jamais une jointure live sur `Product.costPrice`.
- **Dupliquer `OrganizationAccessService` pour un besoin filtré par rôle de mandat** — écartée : extension par paramètre optionnel, rétrocompatible, évite une deuxième implémentation du double chemin d'autorisation.
- **Un seul endpoint avec un paramètre `groupBy`** — écartée : deux contrats de réponse propres et simples plutôt qu'une réponse polymorphe.

## Découpage en tâches bite-sized (2–5 min chacune)
### Prérequis — snapshot à la création de facture
- [ ] Tâche 1 : `packages/db/prisma/schema.prisma` — `InvoiceLine.productId` scalaire → relation `Product?` (garder `String?` nullable, ajouter `@relation`)
- [ ] Tâche 2 : migration Prisma (ajout FK `invoice_line.product_id → product.id`, `ON DELETE SET NULL` — une ligne de facture émise ne doit jamais être bloquée par la suppression future d'un produit, hors scope ici mais garde-fou dès la FK)
- [ ] Tâche 3 : `apps/trust-api/src/invoices/dto/create-invoice.dto.ts` — ajouter `productId: z.string().uuid().optional()` à `invoiceLineSchema`
- [ ] Tâche 4 : `apps/trust-api/src/invoices/invoices.service.ts` — `createDraft()` : résout les `Product` référencés (batch `findMany`, IDOR vérifié), snapshotte `costPriceAtTime`, passe `productId` dans le `create` imbriqué des lignes

### Extension RBAC partagée
- [ ] Tâche 5 : `apps/trust-api/src/common/rbac/organization-access.service.ts` — `assertAccess(organizationId, userId, eligibleRoles, requiredMandateGrantedRole?)`, filtre optionnel ajouté au `where` du `mandate.findFirst`

### Lecture de la marge
- [ ] [P] Tâche 6 : `apps/trust-api/src/margin/margin.service.ts` — `listLines(organizationId)` et `listByProduct(organizationId)`, filtre statuts `issued/partially_paid/paid`, jamais `costPriceAtTime: null` traité comme 0 (marge non calculable ≠ marge nulle)
- [ ] Tâche 7 : `apps/trust-api/src/margin/margin.controller.ts` — 2 routes sous `/organizations/:id/margin/...`, aucun `@Roles()`, autorisation entièrement via `OrganizationAccessService.assertAccess(..., "business_manager")`
- [ ] Tâche 8 : `apps/trust-api/src/margin/margin.module.ts`, enregistrement `app.module.ts`

## Tests à écrire AVANT le code
- [ ] `create-invoice.dto.spec.ts` : accepte une ligne sans `productId` (rétrocompatibilité) ; accepte un `productId` uuid valide
- [ ] `invoices.service.spec.ts` : `createDraft()` avec une ligne `productId` référencé → `costPriceAtTime` = `Product.costPrice` snapshotté
- [ ] `invoices.service.spec.ts` : `createDraft()` avec une ligne sans `productId` → `costPriceAtTime: null`, jamais une erreur
- [ ] `invoices.service.spec.ts` : `createDraft()` avec un `productId` d'une AUTRE organisation → rejeté (IDOR)
- [ ] `invoices.service.spec.ts` : `createDraft()` avec un `Product.costPrice` null (jamais renseigné, E6) → `costPriceAtTime: null`, jamais 0 fabriqué
- [ ] `organization-access.service.spec.ts` : `requiredMandateGrantedRole: "business_manager"` rejette un mandat `accountant_external` actif
- [ ] `organization-access.service.spec.ts` : non-régression — FEC (sans le paramètre) continue d'accepter tout `PracticeMember` avec mandat actif
- [ ] `margin.service.spec.ts` : `listLines` exclut les factures `draft`/`voided`
- [ ] `margin.service.spec.ts` : `listByProduct` agrège correctement plusieurs lignes du même produit sur plusieurs factures
- [ ] `margin.service.spec.ts` : une ligne sans `costPriceAtTime` n'entre jamais dans une agrégation comme marge=0 (exclue ou marquée non calculable, jamais silencieusement faussée)

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts, y compris la suite `invoices.service.spec.ts` existante (non-régression sur `createDraft()`)
- `dev-code-reviewer` OK
- `dev-security-reviewer` OK (donnée commerciale la plus sensible du domaine)
- `dev-domain-model-reviewer` recommandé (invariant "marge non calculable ≠ marge nulle")

## Risques identifiés & mitigations
- Risque 1 : régression sur `createDraft()` (chemin critique, 65+ tests existants selon commentaire du fichier) → mitigation : `dev-architect` trace le fichier en détail avant modification ; lancer la suite `invoices.service.spec.ts` complète avant ET après, aucune tolérance de régression.
- Risque 2 : `productId` d'une autre organisation glissé dans une ligne → mitigation : IDOR vérifié explicitement (même discipline que `customerId`/`branchId` déjà dans `createDraft()`), batch-résolu et comparé à `dto.organizationId`.
- Risque 3 : extension de `OrganizationAccessService` casse le comportement FEC existant → mitigation : paramètre optionnel, test de non-régression dédié.
- Risque 4 : marge affichée = 0 pour une ligne sans coût renseigné, laissant croire à une vente à perte totale plutôt qu'à une donnée absente → mitigation : `costPriceAtTime: null` propagé explicitement, jamais coalescé à `0n`.
