# Plan : Hub Vision — parcours de numérisation d'une facture papier (ADR-122)

> **Numérotation.** Commandé sous « ADR-120 », numéro déjà en service
> (hébergement de la base : Supabase managé + Fly intérimaire, PR #1). ADR-121
> est pris par la barrière d'éligibilité au refinancement. Renuméroté en **122**.
> ADR : `docs/architecture/adr-122-ocr-vision-souveraine.md`.
>
> **Réalisation (11/09, PR #22).** La partie serveur est livrée — voir
> `docs/plans/2026-09-11-adr122-hub-vision-ocr.md` pour ce qui a été construit.
> Deux écarts avec ce plan : la projection sur `CreatePdpInvoiceDto` a été
> **abandonnée** au profit d'un registre dédié `ocr_document` (ADR §1 révisé :
> le worker PDP certifie sans relecture), et l'alerte marchand pose l'ambre
> foncé sur **surface blanche** plutôt que sur fond ambre pâle — le contraste
> maximal est ce qui tient en plein soleil. Le parcours UX en trois écrans
> ci-dessous reste à livrer.

## Contexte projet

- Modules : `apps/web` (parcours) et `apps/trust-api` (extraction, schéma,
  registre `ocr_document`, brouillon).
- Persona affecté : le commerçant du secteur informel qui tient un carnet à
  souches, et le collaborateur de cabinet qui saisit pour ses mandants.
- Données sensibles : photographies de factures — nom du client, montants,
  parfois une adresse. Données tenant de plein droit, sous `org_isolation`.
- Impact réglementaire : indirect mais réel. Le document produit finit certifié
  et transmis au guichet e-TVA ; une extraction fausse devient une déclaration
  fausse.

## Problème (en 3 lignes max)

Le commerçant visé par la LFI 2025 ne part pas d'un écran vide mais d'une liasse
déjà écrite. Retaper quatorze lignes sur un clavier tactile est ce qui fait
abandonner l'onboarding. Le clavier est l'obstacle, pas la conformité.

## Solution retenue (en 5 lignes max)

Une zone de dépôt unique, une transition de numérisation qui montre ce qui est
lu, puis le document reconstitué **à la place du papier** — les cellules
douteuses signalées là où elles se trouvent, corrigibles sur place. Le formulaire
de saisie complet reste accessible à tout moment, pré-rempli. Rien n'est certifié
avant relecture humaine.

## Parcours UX

### 1. Le dépôt

Une seule zone, sans bordure en pointillés ni icône de nuage : un cadre plein,
un intitulé, un bouton. Le glisser-déposer est un **bonus de bureau** — la cible
est sur téléphone, où le geste réel est « prendre une photo » ou « choisir dans
la galerie ». Ces deux entrées sont donc les boutons principaux, et la zone de
dépôt n'existe qu'au-delà de `md`.

L'`<input type="file">` reste dans le DOM et fonctionne sans JavaScript : c'est
la même discipline que le tiroir en `<details>` de l'espace cabinet.

### 2. La numérisation

Pas de barre de progression indéterminée qui tourne dans le vide. La transition
montre **l'image téléversée** et fait apparaître les blocs reconnus à mesure —
en-tête, lignes, pied. Le commerçant voit que la machine lit *sa* facture, ce qui
est la seule chose qui rende l'attente acceptable sur un réseau lent.

Un état d'échec explicite, jamais un retour silencieux à la zone de dépôt :
« Nous n'avons pas pu lire cette photo » + les deux issues (reprendre la photo /
saisir à la main), la seconde jamais grisée.

### 3. La relecture

Le tableau reconstitué reprend la disposition de la facture. Chaque cellule
douteuse est signalée **à sa place**, éditable en ligne, avec le fragment
d'image correspondant consultable au toucher — le commerçant vérifie contre son
papier sans changer d'écran.

Les deux équations d'ADR-122 sont affichées **résolues, pas cachées** : quand le
pied ne tombe pas juste, l'écart est nommé et chiffré. Une somme corrigée en
silence produirait un document fiscal signé sur un faux total.

## Signalement des anomalies — et l'arbitrage qu'il impose

L'énoncé demandait « les cellules en anomalie en Or mat, sur l'interface sombre
du Cabinet ou blanche du Marchand ». **La moitié de cette règle ne tient pas.**

L'Or `#d4af37` fait **2,10:1 sur blanc** : il échoue l'AA (seuil 4,5) et même la
tolérance des grands caractères. Sur le fond sombre du Cabinet, il est juste et
c'est déjà sa place dans la charte ; sur le fond clair du Marchand, il devient
un signal qu'une partie des utilisateurs ne verra pas — sur un écran de
téléphone en plein soleil à Madina, plus personne ne le voit. Or c'est
précisément l'écran où se joue l'inclusion visée.

Décision retenue, à confirmer :

| Univers | Signalement d'anomalie |
|---|---|
| Cabinet (sombre) | Or `#d4af37` en aplat + cerclage, conforme à la charte |
| Marchand (clair) | Ambre foncé sur fond ambre pâle, cerclé, ratio ≥ 4,5:1 |

Dans **les deux** cas, la couleur ne porte jamais seule l'information : icône
d'alerte, cellule cerclée, et libellé textuel de l'anomalie (« montant illisible »,
« le pied ne tombe pas juste »). WCAG 1.4.1 l'exige, et le terrain aussi — une
photocopie, un écran usé ou un daltonisme suffisent à effacer une nuance d'or.

Les pastilles `bg-red-bg` / `text-red-text` ne doivent pas être réutilisées sur
le fond sombre : elles sont calibrées pour un fond clair et tombent sous AA sur
le Navy.

## Alternatives écartées

- **Certifier directement l'extraction** — écartée. Les totaux sont scellés
  Ed25519 à l'émission ; une machine ne signe pas un document qu'aucun humain n'a
  relu.
- **Un écran de correction en JSON ou en formulaire à plat** — écartée. Sortir le
  commerçant de la disposition de sa facture lui retire le seul repère qu'il a
  pour vérifier.
- **Masquer les lignes de faible confiance** — écartée. Une ligne absente est
  plus coûteuse qu'une ligne douteuse : elle ne se remarque pas.
- **Or mat comme signal unique d'anomalie sur les deux univers** — écartée pour
  la raison de contraste ci-dessus. À rediscuter si la charte tranche autrement,
  mais alors avec un second porteur d'information que la couleur.

## Travail à livrer

### `apps/trust-api/src/ai/`
- `schemas/ocr-extraction.schema.ts` — schéma Zod, montants en chaînes de
  chiffres converties par `BigInt(...)` (JSON n'a pas de BigInt : `z.bigint()`
  rejetterait toute charge réelle).
- `OcrValidationService` (les deux gardes) et `OcrVisionService` (registre
  `ocr_document`, brouillon lié dans la même transaction) — **livrés**. Le seuil
  de bascule sur la confiance reste à calibrer ; seule l'arithmétique décide
  aujourd'hui.
- Écriture scopée `organizationScopedClient`, idempotence sur
  (empreinte du fichier, organisation) — **livrée**.

### `apps/web/src/`
- Parcours en trois écrans ci-dessus, la saisie manuelle toujours joignable.
- Tokens d'anomalie par univers, testés sur leur ratio comme le fait déjà
  l'atelier UI.

## Reste à trancher

- Hébergement du modèle d'inférence et souveraineté des images extraites — ouvert
  dans l'ADR, conditionne le positionnement « tiers de confiance privé certifié ».
- Seuil de `rawTextConfidence` : à calibrer sur des photos réelles de carnets à
  souches, pas à fixer sur le papier.
- L'arbitrage Or / ambre ci-dessus attend la confirmation du client, comme celui
  d'`emerald-600` resté en suspens sur l'atelier UI.
