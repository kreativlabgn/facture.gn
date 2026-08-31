# ADR-116 (provisoire) — Droits des personnes : accès, anonymisation, registre

> **Provisoire** : rédigé dans `code/` car `V/Registre-ADR-facture-gn.md` est
> momentanément indisponible (migration de charte en cours dans un autre
> contexte). À porter tel quel dans `V/`, Partie 28+, quand `V/` est propre.
> Numéro **116** (113 = rétention, 114 = rotation de clé, 115 = ancrage Merkle,
> tous en attente du même portage).

## Contexte

facture.gn traite des données personnelles de particuliers — surtout des
**clients d'une PME utilisatrice qui n'ont pas de compte** (`customer.name`,
`.phone`, `.nif`) — sans aucun mécanisme pour honorer la Loi **L/2016/037/AN**
(droits d'accès, de rectification, d'effacement, d'opposition). La dimension
benchmark « droits des personnes » est à zéro. Deux verrous rendent le sujet non
trivial :

1. Les triggers **append-only** de J1 (`invoice_event`) et E1 (`invoice.hash` /
   `anchor_batch_id` immuables, `merkle_anchor_batch` non supprimable) : une
   partie des données référençant une personne **ne peut plus être modifiée ni
   supprimée en base**.
2. **OHADA Art. 23** + **L/2021/024** (LBC/FT) imposent une conservation de 10
   ans des factures et de la piste d'audit — le droit à l'effacement cède devant
   cette obligation légale pour les données strictement nécessaires.

## Décision

**Anonymisation en place sur les tables mutables + exclusion légale documentée
des tables immuables + un registre append-only des demandes. Deux chemins :
owner/admin PME et ops plateforme.**

### 1. Périmètre du Lot J2

- **Droit d'accès / portabilité** : un service assemble le dossier PII d'une
  personne (résolue par téléphone) en JSON structuré.
- **Droit à l'effacement** : anonymisation d'un `Customer` — **complète** si
  aucune facture n'est sous conservation, **partielle** sinon (`name`/`nif`
  conservés, contact effacé — cf. `data-retention-policy.md` §4).
- **Rectification / opposition** : documentées comme état des lieux + gap (aucun
  endpoint de modification `Customer` n'existe aujourd'hui). Hors scope de ce lot.
- **Compte `User`** : hors scope (touche auth, `OrganizationMember`, mandats).

### 2. Composition avec l'append-only (J1/E1)

- **Jamais de `DISABLE TRIGGER`.** Aucune obligation légale n'exige la
  destruction d'une donnée avant l'échéance de sa conservation ; la procédure de
  « bris de glace » ouvrirait un vecteur d'altération de la preuve à peine
  fermé par J1/E1.
- `invoice`, `invoice_event`, `merkle_anchor_batch` sont **exclus du périmètre
  d'effacement** au titre de la conservation légale. Ils ne référencent la
  personne que par un identifiant technique (`customer_id`, `actor_id` = UUID
  pseudonyme) ; `merkle_anchor_batch` ne contient que des digests.
- Ce qui rend la personne non identifiable, c'est le tombstone / l'effacement des
  colonnes PII sur `customer` (table mutable). Le `Customer` n'étant **jamais
  recopié en PII sur la facture** (seul `invoice.customer_id` existe), anonymiser
  la ligne `customer` propage partout sans toucher aux factures immuables.
- Après échéance 10 ans : purge réelle = dette de conformité signalée dans la
  politique, non construite (échéance réelle 2036+).

### 3. Registre `DataRightsRequest` (append-only)

Toute opération (accès **et** anonymisation) écrit une ligne
`data_rights_request` : `kind`, `outcome`
(`completed | partial | refused_legal_retention | failed`), `subject_phone_hash`
(**SHA-256 du msisdn normalisé — jamais le numéro en clair**),
`requested_by_user_id` (null = ops), `via_ops`, `organization_id` (null =
transverse), `affected_customer_ids[]`, `note`, `created_at`. Trigger
`data_rights_request_append_only` (`BEFORE UPDATE OR DELETE FOR EACH ROW`,
`SECURITY INVOKER`, `SET search_path = ''`, `ERRCODE = 'restrict_violation'`) —
**copie exacte du pattern J1** (`20260830120000_invoice_event_append_only`).
C'est la preuve de responsabilité (accountability) opposable au régulateur PDP.

### 4. Deux chemins d'accès

| Chemin | Endpoint | Auth | Portée |
|---|---|---|---|
| PME | `POST /customers/data-rights/export`, `POST /customers/data-rights/:id/anonymize` | JWT, `@Roles("owner","admin")` | `organization_id` de l'appelant |
| Ops plateforme | `POST /internal/data-rights/export`, `POST /internal/data-rights/anonymize` | guard `DATA_RIGHTS_INTERNAL_KEY` (secret dédié, `secrets.ts`) | transverse (toutes organisations) |

Le chemin ops est nécessaire : un particulier peut être client de plusieurs PME,
et sa demande ne peut pas être traitée organisation par organisation. Chaque
appel ops trace une ligne `data_rights_request` immuable (`via_ops = true`).

### 5. Concurrence

`anonymizeCustomerById` prend un `pg_advisory_xact_lock(hashtext('customer:' ||
organization_id || ':' || phone))` — **même clé** que
`CustomersService.create()` (dédoublonnage, E3) — avant toute lecture. Sérialise
l'anonymisation contre une création concurrente sur le même téléphone. Le
dédoublonnage ignore les lignes `anonymized_at != NULL`.

## Écarté

- **`DISABLE TRIGGER` supervisé (bris de glace)** — cf. §2. Reste une option
  documentée pour l'après-échéance, non construite.
- **Crypto-erasure** (chiffrer les PII, jeter la clé par sujet) — chantier
  transverse disproportionné pour le volume et l'échéance.
- **Compensating event dans `invoice_event`** — `InvoiceEventType` est indexé sur
  une facture ; l'anonymisation d'un `Customer` n'en est pas une. Le registre
  dédié est le bon niveau.
- **Nouveau rôle RBAC `privacy_officer`** — YAGNI. owner/admin PME + clé ops
  couvrent les deux chemins réels sans un 8ᵉ `OrganizationRole` à faire vivre.
- **Refuser toute anonymisation dès qu'une facture existe** — trop conservateur
  (la facture n'a pas besoin du `phone` ni de la limite de crédit) et sans valeur
  démontrable. L'anonymisation partielle est plus juste.
- **Hash-chaining de `data_rights_request`** — même limite que `invoice_event`
  (J1) : le trigger empêche l'altération/suppression, pas l'injection d'une ligne
  forgée par `facture_app` (INSERT libre). Chantier commun avec le hash-chaining
  `invoice_event` déjà noté en dette J1.

## Conséquences

- Nouvelle dépendance : **aucune** (`@noble/hashes` déjà présent pour le SHA-256
  du hash de téléphone).
- Nouveau sous-module `apps/trust-api/src/data-rights/`. Nouvelle colonne
  `customer.anonymized_at`. Nouvelle table `data_rights_request` + 2 enums + 1
  trigger. Nouveau secret `DATA_RIGHTS_INTERNAL_KEY`.
- `CustomersService.create()` / `importCustomers()` : le dédoublonnage exclut
  désormais `anonymized_at != NULL`. `merge()` / `flagPublicEntity()` /
  `proposeCreditLimit()` refusent un `Customer` anonymisé.
- `data_rights_request` est **cross-organisation** (`organization_id` nullable) →
  hors politique RLS, comme `merkle_anchor_batch` / `payment_webhook`
  (`docs/runbooks/rls-rollout.md`). L'anonymisation écrit sur `customer` via le
  `PrismaClient` non scopé — l'étape 5 du runbook RLS devra exclure `customer` de
  son `REVOKE UPDATE`, ou prévoir un rôle dédié.
- Le portail client (`ClientPortalOtpService` / `ClientPortalService`, lookup
  `where: { phone }`) : aucun changement — un `phone = NULL` ne matche jamais,
  une personne anonymisée disparaît naturellement du portail.
- Fast-follow avant agrément PDP : endpoint de rectification `Customer` ;
  opt-out complet de notification ; anonymisation `User` ; purge post-échéance
  10 ans.
