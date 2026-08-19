# Plan : K4/K5 — Choisir un rail de financement B2G + anti-double financement

## Contexte projet
- Module : Capital Context — nouveau module `apps/trust-api/src/financing` + modification `apps/trust-api/src/invoices` (relation FK)
- Persona affecté : owner/admin de la PME (décide du rail — jamais le DAF, qui a déjà joué son rôle via `validateLiquidation()`, J1)
- Données sensibles manipulées : montants de facture, identité du partenaire financier — sensibilité comparable à la marge (E7)
- Impact réglementaire : ADR-100 signale un risque réglementaire pour l'extension `fournisseur_crediteur` — **hors scope ici**, seuls `banque`/`mfi` (ADR-089, MVP du financement B2G) sont concernés

## Clarifications
- Q: `is_financeable()` (ADR-031, "toute modification est un ADR") — composite exact non détaillé au-delà de `validated_by_administration` (ADR-080). Quelle définition retenir ? → R: `invoice.validatedByAdministration === true && invoice.financedByPartnerId === null && invoice.status !== "voided"`. Défendable et minimal : reprend le seul composant explicitement documenté (ADR-080) + l'anti-double-financement (K5, ADR-089) + une garde de bon sens (jamais une facture annulée). Documenté ici comme décision d'implémentation, pas comme un nouvel ADR formel — à faire acter si une divergence apparaît plus tard.
- Q: Qui crée les `FinancialPartner` (Ecobank, UBA, COFINA, Akiba Finance — ADR-088) ? → R: **Aucun endpoint de création** — ce sont 4 partenaires nommés, connus à l'avance, jamais un self-service PME. Seedés directement dans la migration (même philosophie que les rôles système : pas de sur-ingénierie pour un besoin non demandé, cohérent avec l'absence de tout module "sysadmin"/ops dans ce repo).
- Q: "Rail B — attente directe" nécessite-t-il un endpoint dédié ? → R: **Non** — ADR-088 le décrit comme "la PME n'utilise aucun financement" : c'est l'absence d'action, pas un état à écrire. Un seul endpoint d'écriture (choisir Rail A), plus un endpoint de lecture montrant l'éligibilité et les deux rails pour que la PWA affiche la comparaison.
- Q: `payout_fee_djomy_bps` (ADR-089, applicable à refund/revenue-share/avance B2G) — retro-appliqué aux stories déjà livrées (C13, H4) ? → R: **Non** — aucune exécution réelle de `payment_link_payout` n'existe nulle part dans ce repo (refunds, H4, et maintenant ceci restent tous à l'état "pending", jamais un vrai virement Djomy). Un frais sur un virement qui n'a jamais lieu n'a aucun effet réel — hors scope, à traiter si une story future construit l'exécution réelle du rail Djomy Payout.
- Q: `FinancialPartner.apiKey` (ADR-089) construit et utilisé ? → R: Champ présent au schéma pour fidélité à l'ADR, jamais lu ni écrit par aucun code de cette story — même pattern que `ApiKey.lastUsedAt` (F15) ou `Product.taxExemptionCategory` (E10).
- Q: `financing_disbursed` (InvoiceEventType, V2 dans le commentaire du schema) — émis par cette story ? → R: **Oui** — contrairement à `revenue_share_credited` (H4, incompatible avec le modèle d'agrégat mensuel), `financing_disbursed` est un événement PAR FACTURE, exactement ce que cette story produit. Ajouté à l'enum + à `EVENT_CATEGORY_BY_TYPE` (catégorie `paiement`, cohérent avec `payment_link_generated`/`overpayment_recorded`).

## Problème (en 3 lignes max)
Une facture B2G validée par le DAF (J1) n'a aujourd'hui aucun moyen d'être financée par avance — `Invoice.financedByPartnerId`/`financedAt` existent en base depuis le début mais rien ne les renseigne, et `FINANCIAL_PARTNER` n'existe pas.

## Solution retenue (en 5 lignes max)
Nouveau modèle `FinancialPartner` (seedé : Ecobank/UBA/COFINA/Akiba Finance). `GET /invoices/:id/financing-options` (owner/admin) expose l'éligibilité (`is_financeable()`) et les deux rails. `POST /invoices/:id/financing` (owner/admin) enregistre le choix du Rail A — vérifie l'éligibilité, l'anti-double-financement (K5), pose `financedByPartnerId`/`financedAt`, émet `financing_disbursed`. Rail B ne déclenche aucune écriture (absence d'action, ADR-088).

## Alternatives écartées
- **Endpoint de création de `FinancialPartner`** — écartée : 4 partenaires connus, seedés en migration, aucun besoin self-service.
- **Endpoint dédié pour "choisir Rail B"** — écartée : ADR-088 le décrit explicitement comme une absence d'action.
- **Exécution réelle du virement (Djomy Payout ou bank_transfer)** — écartée : aucune intégration Djomy Payout n'existe nulle part dans ce repo (même limite déjà documentée par `refunds.service.ts` et H4).
- **`payout_fee_djomy_bps` rétro-appliqué à C13/H4** — écartée : un frais sur un virement qui n'a jamais lieu réellement n'a aucun effet, scope creep non demandé.

## Découpage en tâches bite-sized (2–5 min chacune)
- [ ] [P] Tâche 1 : `packages/db/prisma/schema.prisma` — `enum FinancialPartnerType { banque mfi }`, `enum FinancialPartnerStatus { active suspended }`, modèle `FinancialPartner` (id, name, type, apiKey nullable, status)
- [ ] Tâche 2 : `packages/db/prisma/schema.prisma` — `Invoice.financedByPartnerId` scalaire → relation `FinancialPartner?`
- [ ] Tâche 3 : `packages/db/prisma/schema.prisma` — `InvoiceEventType` : ajouter `financing_disbursed`
- [ ] Tâche 4 : `apps/trust-api/src/organizations/organizations.service.ts` — `EVENT_CATEGORY_BY_TYPE` : ajouter `financing_disbursed: "paiement"` (TypeScript force l'exhaustivité, sinon build cassé — garde-fou déjà en place)
- [ ] Tâche 5 : migration Prisma + seed des 4 `FinancialPartner` connus (`INSERT` direct dans le fichier de migration, pas un script séparé)
- [ ] [P] Tâche 6 : `apps/trust-api/src/financing/dto/choose-financing.dto.ts` — `{ financialPartnerId: uuid, disbursementMethod: z.enum(["payment_link_payout","bank_transfer"]) }`
- [ ] Tâche 7 : `financing.service.ts` — `getFinancingOptions(invoiceId)` : is_financeable() + liste des `FinancialPartner` actifs
- [ ] Tâche 8 : `financing.service.ts` — `chooseFinancing(invoiceId, dto)` : vérifie is_financeable(), vérifie le partenaire actif, transaction (update Invoice + create InvoiceEvent)
- [ ] Tâche 9 : `financing.controller.ts` — 2 routes sous `/invoices/:id/financing...`, `@Roles("owner","admin")`, idSource par défaut ("invoice", déjà le comportement standard — aucune modification RolesGuard)
- [ ] Tâche 10 : `financing.module.ts`, enregistrement `app.module.ts`

## Tests à écrire AVANT le code
- [ ] `financing.service.spec.ts` : `getFinancingOptions` — facture non `validatedByAdministration` → `financeable: false`
- [ ] `financing.service.spec.ts` : `getFinancingOptions` — facture déjà financée (`financedByPartnerId` non null) → `financeable: false`
- [ ] `financing.service.spec.ts` : `getFinancingOptions` — facture `voided` → `financeable: false` même si validée
- [ ] `financing.service.spec.ts` : `chooseFinancing` sur une facture éligible → pose `financedByPartnerId`/`financedAt`, crée un `InvoiceEvent` `financing_disbursed`
- [ ] `financing.service.spec.ts` : `chooseFinancing` sur une facture déjà financée → `ConflictException` (K5), jamais un second financement
- [ ] `financing.service.spec.ts` : `chooseFinancing` sur une facture non validée par l'administration → `ConflictException`
- [ ] `financing.service.spec.ts` : `chooseFinancing` avec un `financialPartnerId` inconnu ou `suspended` → rejeté
- [ ] `choose-financing.dto.spec.ts` : rejette un `disbursementMethod` hors énumération

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- Tous les tests verts
- `dev-code-reviewer` OK
- `dev-security-reviewer` recommandé (choix engageant un montant de facture réel, anti-double-financement critique)
- `dev-domain-model-reviewer` recommandé (invariant anti-double-financement, is_financeable() composite)

## Risques identifiés & mitigations
- Risque 1 : race condition sur deux demandes de financement concurrentes pour la même facture → mitigation : transaction avec vérification `financedByPartnerId: null` dans la clause `where` de l'`update` (même discipline de concurrence que `resolveCreditLimitRequest`, E5) — la seconde requête concurrente trouve `count === 0` et échoue proprement plutôt qu'un TOCTOU classique.
- Risque 2 : `is_financeable()` divergente si une future story change les règles sans passer par un ADR → mitigation : fonction unique, nommée explicitement, jamais dupliquée dans le controller.
