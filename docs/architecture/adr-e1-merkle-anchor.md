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
- **`MerkleAnchorBatch`** : registre horaire. `hourStart` unique, `merkleRoot`,
  `previousRoot` (chaînage, `"GENESIS"` au départ), `leafCount`. Colonnes
  d'identité **immuables en base** (trigger, pattern J1) ; `DELETE` interdit.
- **Job `merkle-anchor-seal`** (BullMQ, horaire, **opt-in `MERKLE_ANCHOR_ENABLED`**,
  non-bloquant au boot — pattern rétention J3) : `sealDue()` scelle **une**
  tranche par run, couvrant toutes les factures `hash != null`, `anchorBatchId:
  null`, `issuedAt < début_heure_courante` (les retardataires sont inclus
  naturellement). `hourStart` = début de l'heure précédente (borne « as-of »).
  `Invoice.anchorBatchId` assigné une seule fois.
- **Seam `AnchorSink`** : `interface { anchor(rootHex, batchId): Promise<AnchorReceipt | null> }`.
  `NoopAnchorSink` par défaut (retourne `null` → la tranche reste `pending`).
  Un sink réel (Bitcoin RPC maintenu, ou IPFS+Cloudflare per DAT) = provider
  alternatif désigné par env, dans un module optionnel — **construit à la phase
  d'exploitation**.
- **Job `merkle-anchor-flush`** (30 min) : passe les tranches `pending` au sink ;
  `receipt` → `anchored` + `anchorProof`/`anchorRef`/`anchoredAt`. `failed`
  jamais posé automatiquement (le sink peut être transitoirement KO).
- **`GET /verify/:id`** gagne un champ `anchor` : la **preuve d'inclusion**
  (chemin feuille→racine, calculée à la volée) + `previousRoot` + l'état de
  l'ancre externe. `null` si la facture n'est pas encore ancrée.

## Écarté

- **`opentimestamps` npm (0.4.9)** : non maintenu depuis 2022, dépend de
  `request`/`request-promise` (dépréciés, CVE **runtime**) → `audit-ci` bloque.
  Il n'existe pas de client OpenTimestamps JS maintenu.
- **Ancrer chaque facture** (OTS par facture) : ~1 M soumissions/mois. La racine
  horaire couvre ~1400 factures en 32 octets.
- **Ethereum / smart contract** : gas + wallet + surveillance, disproportionné.
- **Feuilles dupliquées sur la tranche (`leafHashes String[]`)** : ~65 Mo/mois,
  redondant. `Invoice.anchorBatchId` + `ORDER BY hash` est normalisé et tout
  aussi vérifiable.
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
- Fast-follow : construire un `AnchorSink` réel (décider Bitcoin RPC vs IPFS à
  l'exploitation) ; cache de la preuve d'inclusion si `/verify` est scrappé.
