# Plan : Hub de Vision Souveraine — extraction des factures papier (ADR-122)

## Contexte projet

Les commerçants de Madina facturent sur carnet à souche. Pour les faire entrer
dans le circuit certifié sans ressaisie, une photo du carnet est lue par un
modèle de vision **souverain** (hébergé par facture.gn, aucun SDK d'éditeur) qui
rend une lecture structurée. Le serveur ne fait confiance à cette lecture sur
**rien qui se recalcule** : chaque égalité arithmétique du papier est vérifiée
en BigInt, et le premier centime d'écart bloque l'insertion automatique.

Cette tranche livre le registre, le contrat de données, la double-garde,
l'insertion du brouillon et l'alerte de relecture. **Elle ne câble pas le
modèle** : le port `OCR_VISION_PROVIDER` est lié à une implémentation qui rend
503 explicite (`OCR_VISION_ENDPOINT` absent). Le jour où le point d'inférence
existe, c'est une ligne d'`ai.module.ts` qui change.

## Clarifications — ce que l'énoncé demandait et ce que le schéma permet

**1. `DRAFT_PENDING_MANUAL_REVIEW` n'est pas un statut de facture.**
`InvoiceStatus` porte 7 valeurs protégées par le cycle de vie Article 23 et des
contraintes CHECK. Y ajouter un état « en attente de relecture » aurait fait
exister une facture qui n'en est pas une. Le statut vit sur le **document
scanné** (`OcrDocument.status`, enum `OcrDocumentStatus` : `RECEIVED`,
`AUTO_INSERTED`, `DRAFT_PENDING_MANUAL_REVIEW`, `REJECTED`). Une facture est
un brouillon ou ne l'est pas ; c'est le scan qui attend une main.

**2. Les montants sont des chaînes de CHIFFRES SEULS, déjà en centimes.**
Plus strict que la passerelle PDP (`pdp-amounts.ts`, chaînes décimales GNF) :
`z.string().regex(/^\d+$/)`, pas de point décimal du tout, conversion par
`BigInt(chaîne)` sans aucun flottant. Borne à 17 chiffres (≈ 10^15 GNF) pour
qu'un modèle qui hallucine n'insère pas un BigInt de plusieurs kilo-octets.

**3. Le taux de TVA ne vient jamais du papier.** C4 / ADR-033 : le taux est
résolu depuis `organization.regimeFiscal`. Une TVA lue sur un carnet chez une
organisation en TPU est un **écart** (`TVA_REGIME`, attendu `0`), pas une
donnée — c'est exactement la facture qu'on ne doit pas insérer sans relecture.

**4. Le régime de saisie (ADR-108) est déclaré par le modèle, jamais deviné.**
`saisieRegime: HT_FIRST | TTC_FIRST` décide de la colonne de pied contre
laquelle les lignes se resomment (HT ou TTC), et de la formule de TVA (HT × taux
tronqué, ou `computeTaxBreakdown(TTC)` — l'unique point de calcul du parcours
marchand, pour que le brouillon inséré soit ventilé comme un brouillon saisi à
la main). Chaque `InvoiceLine` créée hérite du drapeau.

**5. Aucune tolérance d'arrondi.** Un carnet qui arrondit sa TVA au demi-centime
supérieur là où le serveur tronque produit un écart d'un centime → relecture.
Le serveur ne devine pas la règle d'arrondi du papier.

## Modèle de données

`ocr_document` (migration `20260911120000_ocr_document`, DDL généré par
`prisma migrate dev --create-only` — base d'ombre disponible sur ce poste —
section RLS ajoutée à la main : ENABLE + FORCE + politique `org_isolation`,
GRANT `facture_app`).

- `@@unique([organizationId, imageSha256])` — idempotence du scan, composite
  avec l'organisation comme `clientUniqueId` côté PDP. L'empreinte est
  **déclarée par la PWA** (le serveur ne voit pas les octets, voir §Transport).
- `invoiceId @unique` — l'ancre d'idempotence de l'insertion, posée **dans la
  même transaction** que le brouillon.
- `extraction Json` — la sortie **brute** du modèle, telle que reçue. La pièce à
  produire quand un commerçant conteste « ce que la machine a lu ».
- `reviewFindings Json` — les écarts `[{ code, chemin, attendu, constate }]`,
  rendus tels quels à `OcrReviewAlert`.

## Transport de l'image

trust-api ne fait **pas** transiter la photo : limite Express JSON à 100 ko
(`main.ts`), et le stockage objet est la seule pièce qui doit détenir l'image.
`POST /ai/ocr/scans` reçoit `{ organizationId, imageSha256, storageKey,
mimeType }` ; le modèle reçoit la référence de stockage.

## Étanchéité

- `organizationId` vient de `@CurrentOrganizationId()` (RolesGuard), jamais du
  corps. `GET /ai/ocr/scans/:id` résout l'organisation depuis le document
  (`@OrganizationIdSource("ocr-document")`, nouveau cas du guard).
- Chaque lecture passe par `organizationScopedClient` **et** porte le filtre
  explicite `organizationId` (double clause, convention du dépôt).
- Le test d'intégration endosse `facture_app` par `SET LOCAL ROLE` dans une
  transaction pour prouver la politique elle-même — le superutilisateur local
  bypasse la RLS, un vert sous `postgres` ne prouverait rien.

## Concurrence

Deux `traiter()` du même document peuvent courir (rejeu 3G pendant que le
premier attend le modèle) : tous deux lisent `invoiceId = null`. `invoice_id`
est `@unique`, mais deux factures **distinctes** ne se heurtent à rien. Un
`SELECT … FOR UPDATE` sur la ligne du registre, en tête de la transaction
d'insertion, sérialise : le second relit le lien posé par le premier et
n'insère rien. Prouvé par 10 scans concurrents → 1 registre, 1 brouillon.

## Front

`apps/web/src/components/ai/OcrReviewAlert.tsx` : ambre foncé (`amber-text`,
#a55a05, 5.2:1) sur **surface blanche** — pas sur la teinte `amber-bg`, le
contraste maximal est ce qui sauve la lecture en plein soleil. Jamais l'Or de
marque (1.8:1 sur clair, R-11). Icône SVG inline + titre en toutes lettres +
montants affichés **avec leurs centimes** (`formatGnf` tronque au GNF et
masquerait l'écart d'un centime qui a déclenché l'alerte). `role="alert"`.

## Hors périmètre, à trancher

- Le câblage du point d'inférence (protocole, authentification, timeout) et
  la question sync/async : le scan est synchrone à cette tranche ; un modèle
  qui dépasse le budget d'une requête HTTP justifierait une file BullMQ.
- L'écran de relecture lui-même (éditer la lecture, puis insérer) : seule
  l'alerte est livrée. Un document en `DRAFT_PENDING_MANUAL_REVIEW` n'a
  aujourd'hui d'autre issue que la saisie manuelle classique.
- La vérification serveur de `imageSha256` contre les octets (impossible sans
  lire le stockage) — l'empreinte reste une clé d'idempotence déclarative.
