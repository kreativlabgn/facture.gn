# ADR-122 : Hub Vision — extraction structurée des factures papier

> **Numérotation.** Ce texte a été commandé sous « ADR-120 ». Ce numéro est en
> service : il désigne l'hébergement de la base (Postgres managé Supabase +
> Fly intérimaire, PR #1), cité cinq fois dans le dépôt, dont l'en-tête de
> `apps/trust-api/fly.toml` et `docs/architecture/adr-e7-database-hosting.md`.
> ADR-121 vient d'être posé sur la barrière d'éligibilité au refinancement.
> Renuméroté en **122**, premier libre. La décision est inchangée.
>
> S'appuie sur ADR-107 (passerelle PDP, dont il reprend le patron registre / ancre d'idempotence) et sur ADR-108 (régimes
> de saisie HT/TTC). Contrainte par ADR-016 (idempotence) et ADR-111 (RLS).

## Statut

Approuvé — 10 septembre 2026. **Révisé le 11 septembre 2026** à la fusion de
l'implémentation (PR #22, `9157f97`) : la décision 1 est réécrite pour décrire
le chemin réellement construit — un registre dédié `ocr_document` et un
brouillon écrit directement, **pas** la table tampon PDP. La version du 10/09
prescrivait l'inverse ; les raisons du revirement sont dans la décision 1 et
dans les alternatives écartées. Les décisions 2 et 3 sont livrées telles
qu'écrites. Note de réalisation :
`docs/plans/2026-09-11-adr122-hub-vision-ocr.md`.

## Contexte terrain

À Madina, la facture est un carnet à souches. Le commerçant qui doit désormais
émettre un document conforme LFI 2025 ne part pas d'un écran vide : il part d'une
liasse déjà écrite, souvent à la main, pliée dans une sacoche, photographiée à
bout de bras sous un néon.

La fracture n'est pas l'accès au téléphone — elle est la **saisie**. Retaper
quatorze lignes d'articles sur un clavier tactile est ce qui fait abandonner un
onboarding, et c'est exactement la population que l'agrément PDP oblige à
embarquer. Le Hub Vision existe pour cette raison, et pour aucune autre : il ne
remplace pas la facturation, il remplace le clavier.

Trois faits de terrain fixent les contraintes :

- **Le papier est abîmé.** Pliure sur une colonne de montants, reflet, encre
  passée, souche carbone illisible. Un module qui suppose une image nette n'est
  pas utilisable ici.
- **Le réseau est cher et intermittent.** L'extraction est un aller-retour
  serveur ; l'écran doit rester utile quand il échoue.
- **Le commerçant ne relira pas une ligne de JSON.** Ce qui est douteux doit se
  voir sur le document, à sa place, en un regard.

## Décision

### 1. L'inférence produit un brouillon dans un registre dédié, jamais un document certifié

La sortie du modèle est validée par un schéma Zod
(`apps/trust-api/src/ai/schemas/ocr-extraction.schema.ts`), archivée **telle
quelle** dans un registre propre au Hub — la table `ocr_document` — puis, si la
double garde de la décision 2 tombe juste au centime, projetée en un
**brouillon** `invoice` dans la même transaction que le lien
`ocr_document.invoice_id`. Ce lien est l'ancre d'idempotence de l'insertion,
exactement comme `pdp_raw_transaction.invoice_id` l'est pour la passerelle ;
un verrou de ligne `FOR UPDATE` sérialise deux traitements concurrents du même
cliché (rejeu 3G pendant que le premier attend le modèle).

Le registre porte ce que la table tampon PDP n'a pas et que le Hub exige : un
statut `DRAFT_PENDING_MANUAL_REVIEW` propre au **scan** — jamais à la facture,
dont les sept statuts sont protégés par le cycle Article 23 et des contraintes
CHECK — et les écarts relevés (`reviewFindings`), rendus tels quels à l'écran
de relecture.

**Pourquoi pas la table tampon PDP et son worker**, contrairement à la version
du 10/09 : le worker e-invoicing (`PdpConsolidationService.consolidateUnitary`)
crée le brouillon **et l'émet** via `issue()`, dans la foulée, sans main
humaine — c'est sa raison d'être pour un ERP tiers dont le document est déjà
validé en amont. Y faire passer un scan aurait fait certifier automatiquement
une lecture de machine, l'exact contraire du principe ci-dessous. Il aurait
fallu un troisième flux PDP « brouillon sans émission », c'est-à-dire porter la
politique de certification dans deux modules à la fois. Le registre dédié coûte
une table de plus et garde chaque chemin à une seule règle.

Conséquence inchangée : l'extraction crée un **brouillon**. La certification
reste `InvoicesService.issue()`, déclenchée par un humain qui a vu et confirmé
les montants. Les totaux sont scellés Ed25519 à l'émission (ADR-108) : une
machine ne signe jamais un document qu'un commerçant n'a pas relu.

### 2. Double garde de cohérence mathématique, sur des centimes entiers

Aucune extraction n'est acceptée sans que **deux** gardes tombent juste, sur
des entiers, jamais sur des flottants — et sans aucune tolérance : un centime
d'écart bascule le scan en `DRAFT_PENDING_MANUAL_REVIEW`, et rien n'est inséré.

1. **Les lignes** — chaque total de ligne vaut `quantité × prixUnitaireCentimes`
   tel qu'écrit sur le papier, et la somme des totaux de ligne reconstitue le
   pied ; le sens de la reconstitution dépend de `saisieRegime` (ADR-108) :
   - `HT_FIRST` : `Σ lignes` = `totalHtCentimes`, la TVA est ajoutée par-dessus ;
   - `TTC_FIRST` : `Σ lignes` = `totalTtcCentimes`, le HT et la TVA en sont
     extraits par `computeTaxBreakdown`, l'unique point de calcul du parcours
     marchand.
2. **Les taxes** — `totalHtCentimes + totalTvaCentimes === totalTtcCentimes`, et
   la TVA vaut **exactement** ce que le régime fiscal de l'organisation impose
   (`resolveTaxRateBps(organization.regimeFiscal)`, C4 / ADR-033). Le taux ne
   vient jamais du papier ni du modèle : une TVA lue chez un commerçant en TPU
   est un écart, pas une donnée.

Inverser les deux produit un document fiscal certifié aux mauvais montants —
c'est le défaut que l'ADR-108 a déjà eu à corriger sur le chemin PDP. Le régime
n'est donc **pas** inféré librement : il est déduit de la mise en page reconnue,
et toute ambiguïté descend en anomalie plutôt que d'être tranchée par le modèle.

**Le transport des montants n'est pas un `bigint` Zod.** Une réponse de modèle
arrive en JSON, où `BigInt` n'existe pas : `z.bigint()` rejetterait toute charge
réelle. Les montants voyagent en **chaînes de chiffres** validées
(`z.string().regex(/^\d+$/)`) et sont converties par `BigInt(...)` après parsing.
Deux raisons de ne pas se contenter d'un `z.number()` : un montant en centimes
GNF dépasse `Number.MAX_SAFE_INTEGER` avant d'être exotique, et `apps/web` cible
ES2017, où les littéraux `0n` ne compilent pas — le front lit ces montants en
chaînes et appelle `BigInt(...)`, jamais l'inverse.

### 3. Une extraction est une donnée tenant

Le fichier téléversé, le texte reconnu et le brouillon produit portent tous
`organization_id`, sont écrits par `organizationScopedClient` et rangés sous la
politique `org_isolation` (ADR-111). Une photo de facture nomme un client, un
montant et une adresse : la traiter comme un artefact technique hors périmètre
RLS ouvrirait une fuite inter-locataires par la porte de service.

La clé d'idempotence (ADR-016) est l'empreinte du fichier **et** l'organisation :
deux commerçants qui photographient la même facture type ne doivent pas
converger sur le même document.

## Conséquences

**Zéro saisie manuelle sur le chemin nominal.** Le commerçant photographie,
relit, corrige ce qui est signalé, émet. C'est le seul parcours qui rende
l'onboarding tenable pour la cible visée.

**Mode de secours manuel, toujours accessible.** Pliure sur la colonne des
montants, souche illisible, extraction sous le seuil de confiance : le formulaire
de saisie complet reste à un clic, pré-rempli de ce qui a pu être lu, et jamais
bloqué derrière une nouvelle tentative de photo. Une extraction qui échoue ne
doit pas coûter au commerçant plus cher que de ne pas avoir essayé.

**Le doute est rendu au commerçant, jamais absorbé.** Une cellule dont la
confiance est basse, ou qui casse l'une des deux équations, est signalée comme
telle. Le modèle ne « corrige » jamais un montant pour faire tomber juste : un
total rééquilibré en silence est un faux document, et il serait certifié.

**Coût et dépendance externe.** L'inférence est facturée à l'appel et sort du
périmètre souverain si le modèle est hébergé hors Guinée. Le point est ouvert :
il conditionne le positionnement « tiers de confiance privé certifié » et devra
être tranché avant tout déploiement, pas après.

## Alternatives écartées

- **Passer par la table tampon PDP et son worker** (version du 10/09) — écartée
  le 11/09. Le worker émet ce qu'il consolide ; un scan y serait certifié sans
  relecture. Le registre `ocr_document` reprend ce que le tampon apportait
  (idempotence composite, archivage brut, ancre `invoice_id`, RLS forcée) et
  ajoute le statut de relecture et les écarts persistés.
- **Faire confiance aux totaux lus** — écartée. Sans les deux équations, une
  virgule mal placée devient un document fiscal signé.
- **Laisser le modèle trancher `saisieRegime`** — écartée. Le régime décide de la
  signification des montants ; une ambiguïté doit remonter au commerçant.
- **`z.bigint()` sur la sortie du modèle** — impossible : JSON n'a pas de BigInt.

## Reste ouvert

- Hébergement du modèle et souveraineté des données extraites. Au 11/09, le
  port `OCR_VISION_PROVIDER` est lié à une implémentation qui répond 503
  explicite : le registre, la double garde et l'insertion sont livrés et
  testés, le point d'inférence ne l'est pas.
- L'écran de relecture lui-même (corriger la lecture, puis insérer). Seule
  l'alerte `OcrReviewAlert` est livrée ; un scan en
  `DRAFT_PENDING_MANUAL_REVIEW` n'a aujourd'hui d'autre issue que la saisie
  manuelle classique.
- Seuil de `rawTextConfidence` sous lequel l'extraction bascule d'office en
  saisie manuelle — à calibrer sur des photos réelles, pas à décider ici.
- Rapprochement du `detectedNifp` avec l'annuaire : la seule route existante est
  `GET /practices/lookup-organization`, réservée aux cabinets et limitée à
  5 appels/minute. Un usage Vision demanderait sa propre porte.
