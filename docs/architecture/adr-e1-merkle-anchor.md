# ADR-115 (provisoire) — Registre Merkle des factures + seam d'ancrage externe

> **Provisoire** : rédigé dans `code/` car `V/Registre-ADR-facture-gn.md` est
> momentanément indisponible. À porter dans `V/` (Partie 29) avec ADR-113
> (rétention) et ADR-114 (rotation de clé) quand `V/` est propre.

## Contexte

Aujourd'hui, « vérifier une facture » (`GET /verify/:certificationId`) = interroger
l'API de facture.gn, qui recalcule `hash` + `signature` de façon déterministe et
répond « valide ». Le chaînage `previousHash` par organisation protège l'ordre
relatif *de ce que facture.gn stocke*. Un attaquant qui contrôle la base peut
ré-signer une facture altérée avec la clé (compromise) de l'organisation **et
réécrire toute la chaîne**. Il manque un **engagement compact, périodique,
destiné à être ancré hors du contrôle de facture.gn** — le benchmark le note
(« transformer *facture.gn l'affirme* en preuve mathématique »).

## Décision

**Un registre horaire de racines de Merkle, chaîné, avec un seam d'ancrage
externe. L'ancre externe réelle est différée.**

- **Arbre de Merkle RFC 6962** (Certificate Transparency) : feuille
  `SHA-256(0x00 ‖ invoice.hash)`, nœud interne `SHA-256(0x01 ‖ gauche ‖ droite)`
  (séparation de domaine anti-second-preimage), découpage à la plus grande
  puissance de 2 `< n` (impair jamais dupliqué). Ordre des feuilles :
  `invoice.hash` ASC (déterministe, reproductible par un tiers).
- **`MerkleAnchorBatch`** : registre horaire. `asOf` unique (borne haute
  **exclusive** réelle de la tranche), `coverageFrom` (`min(issuedAt)` des
  factures incluses = période réellement engagée), `merkleRoot`, `previousRoot`
  (chaînage, `"GENESIS"` au départ), `leafCount`, `anchorAttempts`. Colonnes
  d'identité **immuables en base** (trigger, pattern J1) ; `DELETE` **et
  `TRUNCATE`** interdits (triggers ROW + STATEMENT). `previousRoot` **`@unique`** :
  la chaîne ne peut pas forker — deux runs de scellement concurrents qui liraient
  le même prédécesseur → le second `INSERT` échoue (`P2002`), ses factures
  repartent au run suivant. C'est la contrainte, pas la lecture dans la
  transaction, qui garantit la non-fourche. `CHECK` de cohérence :
  `anchored ⟺ anchoredAt renseigné`, `proof`/`ref` ensemble, `proof ⟹ anchored`
  — les états incohérents sont irreprésentables, pas seulement évités par le call
  site. FK `Invoice.anchorBatch` en `onDelete: Restrict`.
- **Job `merkle-anchor-seal`** (BullMQ, horaire, **opt-in `MERKLE_ANCHOR_ENABLED`**,
  non-bloquant au boot — pattern rétention J3) : `sealDue()` scelle **une**
  tranche par run, couvrant toutes les factures `hash != null`, `anchorBatchId:
  null`, `issuedAt < début_heure_courante` (les retardataires sont inclus
  naturellement). `asOf` = début de l'heure courante ; `coverageFrom` remonte au
  plus vieux `issuedAt` réellement scellé. Feuilles triées par `(hash ASC, id
  ASC)` — ordre **total** déterministe. Plafond `MAX_LEAVES_PER_BATCH = 20 000`
  (borne la mémoire du job ET la reconstruction de preuve sur `/verify`, qui
  reprend ce `take` en défense en profondeur). `previousRoot` lu dans la
  transaction + `@unique` (non-fourche garantie par la contrainte).
  `Invoice.anchorBatchId` assigné une seule fois (garde + trigger
  `invoice_anchor_batch_id_write_once`).
- **Seam `AnchorSink`** : `interface { anchor(rootHex, batchId): Promise<AnchorReceipt | null> }`.
  `NoopAnchorSink` par défaut (retourne `null` → la tranche reste `pending`).
  Un sink réel (Bitcoin RPC maintenu, ou IPFS+Cloudflare per DAT) = provider
  alternatif désigné par env, dans un module optionnel — **construit à la phase
  d'exploitation**.
- **Job `merkle-anchor-flush`** (30 min) : passe les tranches `pending` au sink ;
  `receipt` → `anchored` + `anchorProof`/`anchorRef`/`anchoredAt`. `failed`
  jamais posé automatiquement (le sink peut être transitoirement KO).
- **`GET /verify/:id`** gagne un champ `anchor` : la **preuve d'inclusion**
  (chemin feuille→racine, calculée à la volée) + `previousRoot` + `integrityConsistent`
  + l'état de l'ancre externe (`externalAnchor.{status,proof,ref,anchoredAt}`).
  `null` si la facture n'est pas encore ancrée. `integrityConsistent = false` = le
  jeu de feuilles vivantes de la tranche a divergé du `merkleRoot` immuable
  (facture-sœur altérée/supprimée) — signal d'inaltérabilité, distinct d'une
  facture non ancrée ; `inclusionProof` reste `[]` dans ce cas.

## Confidentialité (aucune donnée métier exposée)

Une feuille = `SHA-256(0x00 ‖ invoice.hash)` où `invoice.hash` est **déjà** un
digest. La racine, `previousRoot`, la preuve d'inclusion et `leafHash` sont des
hashes — **aucun montant, NIF, numéro ou identité** ne transite par le registre
ni par le champ `anchor` de `/verify`. `leafCount` et `asOf`/`coverageFrom`
révèlent seulement un volume horaire agrégé, cross-organisation (déjà public via
le compteur d'émission). Un `AnchorSink` réel ne publie que `SHA-256(root)` — un
tiers ne peut rien reconstruire sans les factures elles-mêmes.

## `previousRoot` — chaînage inerte tant qu'aucun sink n'est branché

`previousRoot` lie chaque tranche à la précédente, mais tant que le seam retourne
`null`, **aucune racine n'est publiée hors de la base** : un attaquant qui
contrôle la base peut réécrire tout le registre (colonnes immuables par trigger
seulement — `SECURITY INVOKER`, contournable par le superutilisateur PG). Le
chaînage ne devient opposable qu'à partir de la **première racine ancrée**
(toutes les tranches antérieures deviennent alors vérifiables par transitivité,
et OpenTimestamps peut horodater des digests rétroactivement). C'est un choix
assumé : poser le mécanisme maintenant, activer la garantie à l'exploitation.

## `externalAnchor.status` n'est pas une preuve

`status = "anchored"` est écrit **par facture.gn**. Un vérificateur ne doit
jamais s'y fier seul : la confiance vient de la vérification de
`externalAnchor.proof` contre le support externe (`externalAnchor.ref`), pas du
statut. Tant que ce n'est pas fait, `/verify` reste « facture.gn l'affirme ».

## Écarté

- **`opentimestamps` npm (0.4.9)** : non maintenu depuis 2022, dépend de
  `request`/`request-promise` (dépréciés, CVE **runtime**) → `audit-ci` bloque.
  Il n'existe pas de client OpenTimestamps JS maintenu.
- **Ancrer chaque facture** (OTS par facture) : ~1 M soumissions/mois. La racine
  horaire couvre ~1400 factures en 32 octets.
- **Ethereum / smart contract** : gas + wallet + surveillance, disproportionné.
- **Feuilles dupliquées sur la tranche (`leafHashes String[]`)** : ~65 Mo/mois,
  redondant. `Invoice.anchorBatchId` + `ORDER BY (hash, id)` est normalisé et
  tout aussi vérifiable.
- **`sealHour(H)` itératif + balayage retardataires séparé** : `sealDue()` (une
  tranche par run) est plus simple et gère les retardataires sans cas spécial.

## Conséquences

- Nouvelle dépendance : **aucune** (`@noble/hashes` déjà présent). Le sink réel
  en réintroduira une (Bitcoin RPC / IPFS client) — `audit-ci` réévalué alors.
- La garantie « sans confiance en facture.gn » **n'est pas encore acquise** — le
  registre + le seam le sont ; l'ancre externe l'active (et OpenTimestamps peut
  horodater des digests **rétroactivement**, donc les racines historiques
  deviendront vérifiables sans perte).
- eIDAS / TSA qualifié RFC 3161 = **hors scope** (CdC : « eIDAS avant 2027 »).
- Compatible avec « IPFS + Cloudflare, pinning 10 ans » (DAT) et MinIO WORM
  (ADR-013) comme cibles de publication.
- Fast-follow :
  - construire un `AnchorSink` réel (décider Bitcoin RPC vs IPFS à l'exploitation) ;
  - **`/verify` (public, sans auth) fait désormais un `findMany` (~1400 lignes) +
    un arbre Merkle en mémoire par appel** — la preuve d'inclusion est immuable
    une fois la tranche scellée : la mettre en cache (par `certificationId` ou
    par `anchorBatchId`) si l'endpoint est scrappé. Throttle dédié à évaluer
    (aujourd'hui : filet global 100/min/IP).
