# Runbook — Rapprochement bancaire (ADR-052, ADR-117)

Importer les virements **entrants** d'un relevé bancaire de la PME, les rapprocher
des factures en attente, et confirmer d'un geste. **Détection passive** : aucune
API banque n'est consommée — le staff fournit lui-même les données du relevé.

## Ce qui est construit

| Opération | Route (JWT, `owner` / `admin` / `accountant_internal`) |
|---|---|
| Import d'un relevé | `POST /organizations/:id/bank-reconciliation/import` |
| Liste + suggestions | `GET /organizations/:id/bank-reconciliation/transactions?state=&importBatchId=&take=&skip=` |
| Confirmer un rapprochement | `POST /organizations/:id/bank-reconciliation/transactions/:transactionId/confirm` `{ invoiceId }` |
| Ignorer une transaction | `POST /organizations/:id/bank-reconciliation/transactions/:transactionId/ignore` |

## 1. Format JSON attendu par l'import

La **PWA parse le fichier bancaire** (CSV / OFX / MT940) et pousse ce contrat.
Le backend ne parse aucun fichier.

```json
{
  "importBatchLabel": "Relevé BICIGUI août 2026",   // optionnel
  "transactions": [
    {
      "valueDate": "2026-08-20",                     // date ISO, l'heure est ignorée
      "amountCentimes": "1500000",                   // centimes GNF, STRICTEMENT positif
      "rawLabel": "VIR RECU / FG-2026-000042 / SARL DELTA",
      "counterpartyLabel": "SARL DELTA",             // optionnel
      "bankRef": "BICIGUI-2026-0000123"              // optionnel
    }
  ]
}
```

- Tableau de **1 à 500** lignes. Un relevé plus long → le scinder côté PWA.
- **Atomique** : une seule ligne mal formée (date invalide, montant ≤ 0,
  `rawLabel` vide) → `400`, rien n'est importé. Corriger et re-pousser.
- **Idempotent** : l'empreinte
  `SHA-256(organizationId ‖ date de valeur ‖ montant ‖ libellé normalisé)` est
  unique. Re-pousser le même relevé renvoie `duplicate` pour chaque ligne déjà
  vue, sans créer de doublon.

Réponse :
```json
{ "importBatchId": "…", "imported": 12, "duplicate": 3,
  "results": [ { "index": 0, "status": "imported", "transactionId": "…" }, … ] }
```

## 2. Moteur de suggestion

Calculé à la lecture (`GET transactions`), uniquement pour les transactions
`unmatched`. Pour chaque facture payable (`issued` / `partially_paid`) de
l'organisation :

| Confiance | Condition |
|---|---|
| `strong` | montant **exact** (`= amountDue`) **ET** `invoice.number` ou `certificationId` présent dans le libellé |
| `probable` | un seul des deux signaux forts |
| `weak` | seulement : facture émise dans les **30 jours** précédant la date de valeur |
| *(pas de suggestion)* | aucun signal |

Tri : confiance décroissante, puis écart de solde croissant. Plafonné à 10
suggestions par transaction.

## 3. Confirmer un rapprochement

`POST …/transactions/:transactionId/confirm` `{ "invoiceId": "…" }` :

1. La transaction **et** la facture doivent appartenir à l'organisation → sinon
   `404`.
2. La transaction est **revendiquée** (`state → matched`) *avant* toute écriture
   de paiement. Si elle est déjà `matched` / `ignored` → `409`.
3. Le paiement est créé via le chemin standard `recordBankTransferPayment`
   (clé d'idempotence `bank-reconciliation:<transactionId>`, montant =
   `amountCentimes`). Il **refuse** un montant supérieur au solde dû et une
   facture non payable → `409`, et la revendication est **annulée** (la
   transaction redevient `unmatched`).

Jamais d'auto-application : chaque couple `(transaction, facture)` est validé par
un humain.

## 4. Corriger un faux rapprochement

Il n'y a **pas** de « dé-confirmation ». Une transaction confirmée à tort a créé
un `Payment` immuable (OHADA Art. 23). Procédure :

1. Émettre un **avoir** sur la facture concernée (`POST /invoices/:id/credit-notes`,
   C13/ADR-063).
2. Enregistrer le **remboursement** correspondant si les fonds sont restitués.
3. La transaction bancaire reste `matched` (trace historique) — ne pas chercher à
   la rouvrir.

## 5. LBC/FT (Loi L/2021/024/AN)

`bank_transaction` est une trace de mouvement d'argent : conservée alignée sur le
`Payment` (10 ans OHADA). `rawLabel` / `counterpartyLabel` peuvent contenir le
nom / NIF / IBAN du donneur d'ordre → **jamais loggés**, jamais exposés hors de
l'organisation. Aucune détection comportementale n'est branchée sur ce chemin
(le moteur d'anomalie cash G1 reste strictement cash-only) — fast-follow si le
régulateur l'exige.

## 6. RLS

`bank_transaction` porte `organization_id` → politique RLS standard
`org_isolation` (dormante par défaut, cf. `rls-rollout.md`). Aucune lecture
cross-organisation, contrairement à `merkle_anchor_batch` / `data_rights_request`.
