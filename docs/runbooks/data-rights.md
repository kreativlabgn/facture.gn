# Runbook — Droits des personnes (Loi L/2016/037/AN), Lot J2

Traitement opérationnel des demandes d'un particulier portant sur ses données :
**accès**, **anonymisation**. Rectification et opposition ne sont pas encore
outillées (voir `docs/compliance/data-retention-policy.md` §6).

## Ce qui est construit

| Opération | Chemin PME (owner/admin) | Chemin ops plateforme |
|---|---|---|
| Accès (export) | `POST /customers/data-rights/export` `{ phone }` | `POST /internal/data-rights/export` `{ phone }` |
| Anonymisation | `POST /customers/data-rights/:id/anonymize` | `POST /internal/data-rights/anonymize` `{ phone }` |

- Chemin PME : JWT, `@Roles("owner","admin")`, **scopé à l'organisation de
  l'appelant**.
- Chemin ops : header `x-internal-api-key: $DATA_RIGHTS_INTERNAL_KEY` (secret dédié,
  `secrets.ts`, `requiredInProduction`), **transverse** (toutes organisations).
- Chaque appel écrit une ligne **immuable** dans `data_rights_request`
  (`subject_phone_hash` = **HMAC-SHA256(`DATA_RIGHTS_SUBJECT_HASH_PEPPER`, numéro
  normalisé)**, hex — jamais le numéro en clair, non réversible sans le pepper).

## 1. Demande d'accès

1. Vérifier l'identité du demandeur (procédure hors système — pièce d'identité,
   contrôle du numéro). Le service **ne vérifie pas** l'identité : il faut
   s'assurer en amont que le demandeur est bien le titulaire du numéro.
2. Si la personne est cliente **d'une seule PME connue** → demander à cette PME
   d'appeler `POST /customers/data-rights/export` (le numéro doit correspondre à
   ≥ 1 client de son organisation, sinon `404`). Renvoie **uniquement** les
   `Customer` de cette organisation — jamais le bloc compte `User`.
3. Si la personne est (ou peut être) cliente **de plusieurs PME**, si elle a un
   **compte facture.gn**, ou identité inconnue → chemin ops :
   ```
   curl -sS -X POST https://<host>/internal/data-rights/export \
     -H "x-internal-api-key: $DATA_RIGHTS_INTERNAL_KEY" \
     -H "content-type: application/json" \
     -d '{"phone":"+224620001122"}'
   ```
4. Le JSON retourné contient : pour chaque `Customer` correspondant, ses champs +
   la **liste de ses factures en métadonnées** (`number`, `certificationId`,
   `documentType`, `status`, `issuedAt`, `totalTtc`, `disputeStatus` — jamais les
   lignes de facture, qui appartiennent à la PME). **Sur le chemin ops
   uniquement** : le bloc `account` (`User`) si le numéro correspond à un
   `UserPhone` **vérifié** — nom, langue, liste des numéros ; jamais
   `passwordHash`/`pinHash`.
5. Transmettre au demandeur. **Ne jamais logger le corps de la réponse.**

## 2. Demande d'anonymisation

1. Vérifier l'identité (cf. §1.1).
2. Chemin ops (recommandé pour couvrir toutes les PME) :
   ```
   curl -sS -X POST https://<host>/internal/data-rights/anonymize \
     -H "x-internal-api-key: $DATA_RIGHTS_INTERNAL_KEY" \
     -H "content-type: application/json" \
     -d '{"phone":"+224620001122"}'
   ```
   ou chemin PME : `POST /customers/data-rights/:id/anonymize` (l'owner/admin agit sur un de
   ses clients).
3. Résultat par `Customer` :
   - **`completed`** — aucune facture sous conservation : `name` → `"Client
     anonymisé"`, `phone` / `nif` / `credit_limit` / `possible_duplicate_of`
     effacés.
   - **`partial`** — ≥ 1 facture `issued`/`partially_paid`/`paid`/`voided` :
     contact effacé, **`name` + `nif` conservés** (mention obligatoire d'une
     facture légale OHADA). `data_rights_request.note` porte l'échéance
     `max(issued_at) + 10 ans` après laquelle `name`/`nif` pourront aussi être
     effacés.
4. **Réponse motivée au demandeur** en cas de `partial` : « conformément à
   l'article 23 de l'Acte uniforme OHADA et à la loi L/2021/024, votre nom et
   votre NIF figurant sur des factures légales sont conservés jusqu'au
   `<échéance>` ; toutes vos autres données (téléphone, historique commercial)
   ont été effacées. »
5. Une ligne `customer` anonymisée est **gelée** : le dédoublonnage l'ignore,
   `merge()` / `flagPublicEntity()` / `proposeCreditLimit()` la refusent
   (`ConflictException`), et l'**approbation** d'une demande de hausse de limite
   de crédit en attente (`resolveCreditLimitRequest` / `approved`) est refusée
   (le rejet reste possible). L'anonymisation est **idempotente** (rejouer =
   no-op) et sérialisée par verrou consultatif contre une (re)création
   concurrente sur le même téléphone.

## 3. Cas particuliers

- **Demande portant sur un compte `User` (utilisateur PME)** : **hors périmètre
  du Lot J2**. L'anonymisation d'un compte touche l'authentification, les
  `OrganizationMember` et les mandats — la traiter manuellement / renvoyer au
  chantier dédié. Ne **jamais** `DISABLE TRIGGER` sur `invoice_event`.
- **Demande portant sur `professional_practice` / `public_buyer_account`** : hors
  périmètre, traitement manuel.
- **La personne n'existe dans aucune table** : l'export renvoie un dossier vide
  et écrit quand même une ligne `data_rights_request` `outcome: completed` (la
  demande a été traitée).

## 4. Lire le registre

Le `subject_phone_hash` = `HMAC-SHA256(pepper, numéro canonique)`.

**⚠️ Ne jamais coller le pepper (ni le numéro) dans une requête SQL** : il
fuiterait vers `pg_stat_statements`, `log_statement=all`, `~/.psql_history`.
Calculer le hash **hors-bande** puis ne coller que le résultat :

```bash
# numéro CANONIQUE +224XXXXXXXX (voir subject-data.ts::normalizeMsisdn)
node -e 'const{createHmac}=require("crypto");console.log(createHmac("sha256",process.env.DATA_RIGHTS_SUBJECT_HASH_PEPPER).update(process.argv[1]).digest("hex"))' '+224620001122'
```

```sql
SELECT kind, outcome, via_ops, organization_id, affected_customer_ids,
       note, created_at
FROM data_rights_request
WHERE subject_phone_hash = '<hash calculé ci-dessus>'
ORDER BY created_at DESC;
```

La table est **append-only** (trigger `data_rights_request_append_only`) :
`UPDATE` / `DELETE` sont rejetés `restrict_violation`. C'est voulu — c'est la
preuve de responsabilité opposable au régulateur PDP.

## 5. Rollback / incident

- Aucune migration destructrice. Si l'anonymisation d'un `Customer` s'avère
  erronée (mauvaise personne), **il n'y a pas de « désanonymisation »** : les
  colonnes PII sont effacées. Récupération = ressaisie manuelle par la PME depuis
  ses propres archives (la ligne `customer` existe toujours, seuls ses champs
  sont nuls/tombstone ; `anonymized_at` peut être remis à `NULL` par un
  opérateur base pour « dégeler » la ligne).
- Le secret `DATA_RIGHTS_INTERNAL_KEY` compromis → le roter (`secrets.ts`,
  `requiredInProduction`) ; auditer `data_rights_request WHERE via_ops = true`
  sur la période suspecte.
