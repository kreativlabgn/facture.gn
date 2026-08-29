# Plan : Lot B — Clôture d'exercice OHADA (arrêté des comptes scellé)

## Contexte projet
- Module : **Trust Context** (`apps/trust-api`) + `packages/db` (**nouvelle entité + migration**). Nouveau module `src/fiscal-periods/`. Garde additive dans `InvoicesService.issue()`.
- Persona : `owner` / `admin` / `accountant_internal` (le comptable salarié fait l'arrêté, ADR-099). Lecture : + `auditor` / `tax_controller_readonly`.
- Données sensibles : montants agrégés GNF (déjà exposés aux mêmes rôles). Aucune nouvelle.
- Impact réglementaire : **OHADA/SYSCOHADA** — l'arrêté des comptes annuel est obligatoire ; l'impossibilité de modifier une période close est attendue pour l'agrément PDP (Q3 2027). Complète l'inaltérabilité (Article 23 séquence + chaînage Ed25519 protègent l'ordre relatif, jamais les bornes temporelles).

## Décision produit (à tracer en ADR-110)
Aucune story Backlog ni ADR ne spécifie de mécanisme de scellement de période — seulement « OHADA/SYSCOHADA, séquence sans trou Article 23, export FEC » (DAT). Sur **décision explicite du propriétaire produit**, on ajoute la clôture d'exercice, tracée en **ADR-110** (`V/Registre-ADR-facture-gn.md`).

## Clarifications
- Q : quel périmètre de factures est scellé ? → R : les factures **émises** (`status ∈ issued/partially_paid/paid/voided`) dont `issuedAt` tombe dans l'année civile close. Les `draft`/`proforma`/`quote` ne comptent pas (jamais certifiés).
- Q : peut-on clôturer l'année courante ? → R : oui (`year <= currentYear`) — une organisation qui cesse son activité peut arrêter l'exercice en cours. Jamais une année future.
- Q : réversible ? → R : **non** — pas de `reopen()`. Une erreur d'arrêté se corrige comptablement dans l'exercice suivant (principe OHADA), jamais en rouvrant.
- Q : que bloque exactement la garde dans `issue()` ? → R : `issuedAt = new Date()` (toujours l'année courante). Donc la garde ne mord que si l'année **courante** est close → toute nouvelle émission cette année est refusée. Aucun backdate n'existe dans le code (`issuedAt` non fourni par le client), donc la garde couvre le seul vecteur réel.
- Q : le `sealHash` est-il exposé publiquement (verify) ? → R : **hors Lot B** — intégration `GET /verify` = évolution séparée. Lot B expose `GET /organizations/:id/fiscal-periods` (rôles internes).

## Modèle
```prisma
model FiscalPeriodClosing {
  id                String   @id @default(uuid())
  organizationId    String   @map("organization_id")
  year              Int
  lastInvoiceNumber String?  @map("last_invoice_number")   // null si aucune facture émise cette année
  lastInvoiceHash   String?  @map("last_invoice_hash")
  totalHt           BigInt   @map("total_ht")
  totalTva          BigInt   @map("total_tva")
  totalTtc          BigInt   @map("total_ttc")
  invoiceCount      Int      @map("invoice_count")
  sealHash          String   @map("seal_hash")             // SHA-256 canonique du sceau
  closedAt          DateTime @default(now()) @map("closed_at")
  closedByUserId    String   @map("closed_by_user_id")

  organization Organization @relation(fields: [organizationId], references: [id])
  closedBy     User         @relation(fields: [closedByUserId], references: [id])

  @@unique([organizationId, year])   // idempotence : une seule clôture par exercice
  @@map("fiscal_period_closing")
}
```
`sealHash = sha256(canonicalize({ organizationId, year, lastInvoiceNumber, lastInvoiceHash, totalHt, totalTva, totalTtc, invoiceCount }))` — même primitive que `certification.service.ts` (`@noble/hashes/sha2` + `canonicalize`).

## Découpage

### Groupe 1 — Schéma
- [ ] T1 : `schema.prisma` — modèle `FiscalPeriodClosing` + relations inverses sur `Organization` (`fiscalPeriodClosings`) et `User` (`fiscalPeriodClosingsMade`).
- [ ] T2 : migration `20260829140000_add_fiscal_period_closing`.
- [ ] T3 : `db:generate` + `build`.

### Groupe 2 — Service
- [ ] T4 : `src/fiscal-periods/fiscal-period-seal.ts` — `computeSealHash(input): string` pur + spec (déterministe, ordre des champs canonique).
- [ ] T5 : `src/fiscal-periods/fiscal-periods.service.ts` — `close(organizationId, year, userId)` :
  - refuse `year > currentYear` (ConflictException) ;
  - `$transaction` : agrège les factures émises de l'année (bornes UTC `year-01-01`..`year-12-31T23:59:59.999`), résout la dernière par `number` desc, calcule le sceau, `create()` — catch P2002 sur `@@unique` → ConflictException "exercice déjà clos".
- [ ] T6 : `fiscal-periods.service.ts` — `listByOrganization(organizationId)`.
- [ ] T7 : `fiscal-periods.module.ts`.

### Groupe 3 — Garde `issue()`
- [ ] T8 : `invoices.service.ts` `issue()` — dans la transaction, après la garde `paymentsFrozenUntil` : `const closing = await tx.fiscalPeriodClosing.findUnique({ where: { organizationId_year: { organizationId, year: issuedAt.getUTCFullYear() } } })` → si présent, `ConflictException("Exercice <year> clos le <closedAt> — aucune facture ne peut plus y être émise (arrêté des comptes, OHADA)")`.

### Groupe 4 — HTTP
- [ ] T9 : `fiscal-periods.controller.ts` — `POST /organizations/:id/fiscal-periods/:year/close` `@Roles("owner","admin","accountant_internal")` `@OrganizationIdSource("organization")` ; `GET /organizations/:id/fiscal-periods` `@Roles(... + "auditor","tax_controller_readonly")`. `year` validé par un pipe Zod (`z.coerce.number().int().min(2020).max(2100)`).
- [ ] T10 : `app.module.ts` importe `FiscalPeriodsModule`.

### Groupe 5 — ADR
- [ ] T11 : `V/Registre-ADR-facture-gn.md` — ADR-110. Commit séparé dans `V/`.

## Tests AVANT le code
- [ ] `fiscal-period-seal.spec.ts` : déterminisme (2 appels = même hash) ; un champ qui change → hash différent ; `lastInvoiceNumber` null géré.
- [ ] `fiscal-periods.service.spec.ts` : `close()` agrège les bonnes factures (année, statut émis) et ignore les `draft`/années voisines ; `lastInvoiceNumber`/`lastInvoiceHash` = la dernière par `number` ; année sans facture → totaux 0, `invoiceCount` 0, `lastInvoiceNumber` null ; `year` futur → ConflictException ; double clôture (P2002) → ConflictException ; `listByOrganization` scopé.
- [ ] `invoices.service.spec.ts` : `issue()` sur une facture dont l'année courante est close → ConflictException ; année courante NON close → émission normale (non-régression) ; une clôture d'une AUTRE année n'empêche pas l'émission.
- [ ] `fiscal-periods.controller.spec.ts` : délégation `close`/`list` ; pipe rejette `year` non numérique.

## Critères de done
- `db:generate && build` faits · `pnpm turbo lint typecheck test` vert (hors integration.spec) · `app.module.spec.ts` vert
- `issue()` reste sous `SELECT … FOR UPDATE` (garde ajoutée DANS la transaction existante, jamais un 2ᵉ round-trip hors verrou)
- Migration au format des existantes · ADR-110 rédigé et commité dans `V/`
- `dev-code-reviewer` OK · `dev-domain-model-reviewer` OK (nouvelle entité de scellement — vérifier que l'irréversibilité et l'unicité `(org, year)` sont encodées, pas seulement conventionnelles) · `dev-security-reviewer` OK (nouveau point d'écriture qui gèle définitivement une capacité — vérifier RBAC + qu'un `close()` ne peut pas être déclenché cross-organisation)

## Risques & mitigations
- **R1 — course : deux `close()` concurrents sur le même exercice** : mitigation : `@@unique([organizationId, year])` + catch P2002 → le perdant reçoit un 409 propre, jamais deux sceaux.
- **R2 — course : `close()` pendant qu'une `issue()` est en cours** (facture comptée ou non selon le timing) : mitigation acceptée et documentée — le sceau est un instantané "meilleur effort" à la seconde près ; une facture émise juste après le `close()` sera bloquée par la garde `issue()` (T8), jamais silencieusement exclue du prochain exercice. Pas de verrou table-wide (coût disproportionné, précédent `count()+create()` de H1/branches accepté pour un enjeu comparable).
- **R3 — la garde `issue()` casse la non-régression des ~30 tests `issue()`** : mitigation : `tx.fiscalPeriodClosing.findUnique` mocké à `null` par défaut dans les fakes existants → aucun changement de comportement ; seuls les nouveaux tests fournissent une clôture.
- **R4 — bornes d'année : fuseau** : `issuedAt.getUTCFullYear()` et bornes `Date.UTC(year,0,1)` / `Date.UTC(year,11,31,23,59,59,999)` — cohérent avec `formatFecDate` (déjà `getUTC*`) et `formatDate` du renderer (Lot A). Jamais l'heure locale du serveur.
- **R5 — inventer une exigence** : ADR-110 trace explicitement la décision produit ; le mécanisme suit un principe OHADA réel (arrêté des comptes) et le pattern de sceau existant (certification).
