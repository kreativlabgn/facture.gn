# ADR-117 (provisoire) — Rapprochement bancaire : import de relevé, suggestion, confirmation manuelle

> **Provisoire** : rédigé dans `code/` car `V/Registre-ADR-facture-gn.md` est
> momentanément indisponible (migration de charte en cours dans un autre
> contexte). À porter tel quel dans `V/`, Partie 28+, quand `V/` est propre.
> Numéro **117** (113 = rétention, 114 = rotation de clé, 115 = ancrage Merkle,
> 116 = droits des personnes, tous en attente du même portage).

## Contexte

Un virement bancaire reçu par une PME n'a aujourd'hui **aucun outil** dans
facture.gn : le staff le repère sur son relevé bancaire et le saisit à la main,
facture par facture, via `PaymentsService.recordBankTransferPayment` (C3,
ADR-052 « bank_transfer rapprochement asynchrone »). Conséquences réelles :

- virements oubliés → impayés fantômes (la facture reste `issued` alors qu'elle
  est payée) ;
- virements mal imputés → factures « payées à tort » (réversible seulement par
  avoir + remboursement, C13/ADR-063).

Le positionnement reste **non négociable** : détection **passive**, jamais
d'intégration bancaire active (aucune API banque consommée). Cadre : ADR-052,
ADR-061 (marquage manuel restreint cash/virement), Loi **L/2021/024/AN**
(LBC/FT — traçabilité des mouvements d'argent), **OHADA Art. 23** (le `Payment`
créé reste immuable après collecte).

## Décision

Nouveau sous-module `apps/trust-api/src/bank-reconciliation/` (nom explicite pour
éviter la collision avec `apps/money-api/src/reconciliation/`, qui réconcilie des
`PaymentProviderAttempt` — concept **différent**, domaine disjoint).

1. **Modèle `BankTransaction`** — une ligne de relevé importée + son état
   (`unmatched → matched | ignored`). Colonnes d'identité (`organizationId`,
   `importBatchId`, `valueDate`, `amountCentimes`, `rawLabel`, `fingerprint`,
   `importedByUserId`, `createdAt`) **immuables en base** (trigger
   `bank_transaction_identity_immutable`, pattern J1/E1). `DELETE` interdit
   (même trigger). `CHECK` d'état : `unmatched ⟺ resolved_at NULL` et
   `matched_*` renseignés seulement si `state = matched`. Table **scopée
   organisation** → politique RLS standard `org_isolation` (dormante), pas
   cross-org comme `merkle_anchor_batch` / `data_rights_request`.

2. **Import = tableau JSON fourni par l'appelant.** La PWA parse le fichier
   bancaire (CSV/OFX/MT940) ; le backend prend un contrat JSON stable et ne
   parse **aucun** fichier (même précédent que l'import clients E9). Chaque
   ligne est dédoublonnée par
   **`fingerprint = SHA-256(organizationId ‖ valueDate ISO ‖ amountCentimes ‖ rawLabel normalisé)`**,
   contrainte `@unique`. Ré-importer le même relevé ne crée pas de doublons
   (retour `imported` / `duplicate` par ligne). Un relevé est **atomique** : une
   ligne mal formée rejette tout l'import (400), la PWA corrige et re-pousse
   (le re-push est idempotent grâce à l'empreinte).

3. **Suggérer puis confirmer.** Un moteur **pur** (`bank-matching.ts`) classe,
   pour chaque transaction `unmatched`, les factures payables de l'organisation
   par `(montant exact, référence de facture dans le libellé, fenêtre de date)`
   avec un niveau de confiance `strong | probable | weak` :
   - `strong` = montant **exact** ET référence (`invoice.number` ou
     `certificationId`) trouvée dans le libellé normalisé ;
   - `probable` = un seul des deux signaux forts ;
   - `weak` = seulement la fenêtre de date (`0 ≤ valueDate − issuedAt ≤ 30 j`) ;
   - aucun signal → **aucune suggestion**.
   Les suggestions sont calculées à la **lecture** (`GET transactions`), via
   **un seul** `invoice.findMany` quel que soit le nombre de transactions
   (jamais un N+1), plafonnées à `MAX_SUGGESTIONS_PER_TX`.

4. **Confirmation = revendication d'abord, puis délégation à C3.**
   `confirmMatch` :
   1. vérifie que la transaction et la facture appartiennent à
      l'organisation appelante (`recordBankTransferPayment` ne vérifie **pas**
      l'organisation — ne jamais lui déléguer ce contrôle) ;
   2. **revendique** la transaction :
      `updateMany({ where: { id, organizationId, state: "unmatched" }, data: { state: "matched", … } })`.
      `count === 0` → `409`. Ferme la course « deux `confirm` concurrents sur la
      même transaction vers des factures différentes » — sinon la clé
      d'idempotence dérivée renverrait le mauvais `Payment` à la 2ᵉ
      confirmation ;
   3. délègue à
      `recordBankTransferPayment(invoiceId, { amount: tx.amountCentimes }, "bank-reconciliation:<txId>")`
      (idempotence, paiement partiel, refus d'un montant > `amountDue`, refus
      d'une facture non payable, `applyPaymentToInvoice`, régénération du lien —
      **inchangé**). En cas d'échec : la revendication est **annulée**
      (`state → unmatched`, champs `resolved` / `matched_*` nuls) et l'exception
      remonte ;
   4. pose `matchedPaymentId` après succès.

5. **Ignorer.** `ignoreTransaction` : `unmatched → ignored` (pas un virement
   client, ou déjà traité ailleurs). Pas de « ré-activation » dans ce lot.

Contrôleur imbriqué sous `organizations/:id/bank-reconciliation`,
`@OrganizationIdSource("organization")`, `@Roles("owner", "admin", "accountant_internal")`
(le rapprochement bancaire est un travail comptable par nature, ADR-099).

## Clé d'idempotence

`bank-reconciliation:<transactionId>` — jamais une collision avec la saisie
manuelle `POST bank-transfer` (qui passe un UUID v4 client). Un `transactionId`
est unique et stable ; même si une transaction était recréée par un bug, la clé
resterait dérivée du nouvel id → pas de double encaissement (l'empreinte
`@unique` empêche de toute façon la recréation).

## Alternatives écartées

- **Parsing du fichier bancaire côté backend** — chaque banque guinéenne a son
  format / ses variantes de CSV ; chantier de parsing à part entière, la PWA a
  déjà le fichier.
- **Auto-application des correspondances « certaines »** — introduit un chemin
  d'écriture financière non supervisé ; un faux positif = facture payée à tort.
  Le gain de clics ne vaut pas le risque.
- **Réutiliser / étendre `money-api/ReconciliationService`** — réconcilie des
  `PaymentProviderAttempt` (webhooks Djomy/Moneroo perdus) ; domaine disjoint.
- **Entité `BankStatementImport` (agrégat de lot)** — différée : un
  `importBatchId` texte suffit à regrouper un import pour l'affichage et
  l'audit.
- **`BankTransaction` entièrement append-only** — l'état DOIT muter. Compromis :
  colonnes d'identité immuables + `DELETE` interdit, colonnes d'état libres
  (même patron que `merkle_anchor_batch`).

## Conséquences

- `PaymentsModule` exporte désormais `PaymentsService`.
- `recordBankTransferPayment` / `createPaymentAndApply` **non modifiés**.
- Aucune dépendance nouvelle (`@noble/hashes` déjà présent).
- `rawLabel` / `counterpartyLabel` peuvent contenir du PII payeur (nom, NIF,
  IBAN) → scopés organisation (RLS), **jamais loggés**, conservation alignée sur
  le `Payment` (OHADA 10 ans).

## Fast-follows

- **Détection passive du paiement Trésor (B2G Rail B)** — canal distinct
  (portail Trésor, `validatedByAdministration` en attente), hors périmètre.
- **Parsing du fichier bancaire** (si un format standard émerge).
- **Agrégat `BankStatementImport`** (compte, période, solde d'ouverture/clôture).
- **Dé-confirmation** d'un rapprochement (aujourd'hui : avoir + remboursement).
- **Ré-activation** d'une transaction `ignored`.
