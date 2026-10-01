# ADR-125 : Ingestion OCR multicanal — dictée vocale PWA et messages WhatsApp

## Statut

Approuvé — 17 septembre 2026. Réalisé dans la même session que sa conception ;
note de réalisation : `docs/plans/2026-09-16-ocr-multicanal-vocal-whatsapp.md`.
Étend ADR-122 (Hub Vision — extraction structurée des factures papier), ne le
remplace pas : les trois nouvelles sources convergent vers le même registre
`ocr_document` et le même pipeline de validation.

## Contexte

ADR-122 remplace le clavier par une photo pour un commerçant devant un carnet à
souche. Deux limites restaient ouvertes : un commerçant qui préfère dicter
plutôt que photographier n'avait aucun chemin, et une vente conclue à distance
— par téléphone, par un message WhatsApp du client — obligeait quand même une
re-saisie manuelle une fois la conversation terminée.

Trois sources d'entrée supplémentaires convergent vers le même registre et la
même double garde arithmétique qu'ADR-122 :

- **AUDIO_PWA** — dictée vocale enregistrée dans l'application.
- **WHATSAPP_TEXT** — message texte reçu sur le canal WhatsApp Business de la
  PME.
- **WHATSAPP_VOICE** — note vocale reçue sur ce même canal.

## Décisions

### 1. Extension additive d'`OcrDocument`, jamais un second registre

`OcrDocument` gagne `source` (enum `OcrDocumentSource` : `IMAGE_SCAN` par
défaut, `AUDIO_PWA`, `WHATSAPP_VOICE`, `WHATSAPP_TEXT`), `textBrut`
(transcription ou texte brut WhatsApp), `audioSha256` (idempotence audio, même
rôle qu'`imageSha256`) et `whatsappMessageId` (idempotence webhook, `@unique`
global). `imageSha256`/`storageKey` deviennent nullables plutôt que de forcer
une valeur factice sur les sources non-image. **`OcrDocumentStatus` reste
inchangé à quatre valeurs** (`RECEIVED`/`AUTO_INSERTED`/
`DRAFT_PENDING_MANUAL_REVIEW`/`REJECTED`) — décision assumée dès le cadrage,
pour ne pas faire porter à un statut une distinction (quel canal, quelle
étape de traitement) qui appartient au champ `source` et à la file BullMQ, pas
à l'état du document.

### 2. Transcription auto-hébergée (Whisper), jamais un SaaS tiers

Le product-manager a nommé explicitement Whisper (`faster-whisper`/
`whisper.cpp`, poids ouverts, auto-hébergeable) plutôt qu'une API de
transcription hébergée par un tiers (Whisper API OpenAI, Google Speech-to-Text).
Deux raisons, dans cet ordre : (a) envoyer un enregistrement vocal contenant un
nom de client et un montant à un tiers reproduirait exactement la fuite de
souveraineté qu'ADR-122 a déjà refusée pour l'image ; (b) c'est le seul moyen
de **réduire** l'exposition de la donnée vocale, pas seulement de la signaler
comme risque (voir décision 5). Nouveau connecteur `SttProvider`/
`SovereignSttProvider` (`apps/trust-api/src/ai/stt.provider.ts`), même patron
que le connecteur Vision d'ADR-122 : appel HTTP à un point d'inférence interne
(`OCR_STT_ENDPOINT`/`OCR_STT_TOKEN`), jamais un identifiant de service tiers.

L'extraction structurée depuis un texte déjà transcrit (ou reçu tel quel sur
WHATSAPP_TEXT) réutilise le hub Vision souverain existant sur un sous-chemin
dédié (`/extractions/text`) plutôt que d'ouvrir un second hub — même modèle,
même traçabilité de souveraineté (`modelId`), un seul point d'inférence texte
à opérer.

### 3. Stockage objet : MinIO auto-hébergé (DAT, ADR-013)

Le relais du média WhatsApp (téléchargement depuis l'API Graph Meta, dépôt
avant transcription) exigeait un stockage objet qui, à l'examen, n'existait
nulle part dans ce dépôt malgré ce que supposait la conception initiale.
Tranché en faveur de MinIO auto-hébergé, conformément au DAT et à ADR-013
(WORM/object-lock), plutôt qu'un stockage managé tiers (Supabase Storage) qui
aurait rouvert la même question de souveraineté que la décision 2. Un service
`minio` a été ajouté à `docker-compose.yml` pour le développement local
(identifiants `minioadmin`, explicitement commentés comme non valables en
production). **L'instance de production, avec le verrouillage WORM 10 ans
qu'ADR-013 prescrit, reste une action opérationnelle humaine — non
provisionnée par ce chantier.**

### 4. Webhook WhatsApp entrant : authentification et anti-fuite

`POST/GET /webhooks/whatsapp` (`apps/trust-api/src/whatsapp/`) est la première
route de ce dépôt qui reçoit un contenu utilisateur (voix ou texte) sans que
l'expéditeur ait de session facture.gn. Trois garanties, vérifiées par deux
passes de revue de sécurité jusqu'à un verdict solide explicite :

- **Garde HMAC-SHA256 à comparaison temps constant** sur le corps brut de la
  requête (`WhatsAppWebhookAuthGuard`), signature de plateforme Meta — pas
  l'identité de l'expéditeur du message.
- **Résolution d'identité en huit étapes**, anti-fuite : un numéro inconnu de
  `UserPhone` et un numéro connu mais non vérifié renvoient **exactement** le
  même message WhatsApp, verrouillé par un test d'égalité stricte de chaînes —
  aucune confirmation d'existence avant identité pleinement établie.
- **Anti-abus scopé par organisation résolue** (jamais par IP, jamais par le
  numéro brut du payload) — un plafond horaire non contournable par rotation
  de numéro parmi les membres vérifiés d'une même organisation. Déduplication
  `whatsappMessageId` **avant** l'anti-abus (corrigé en cours de revue : une
  redélivraison Meta du même message ne doit pas consommer deux fois le
  quota).

### 5. Opt-in par organisation, défaut désactivé

Le canal WhatsApp ne s'active pas silencieusement : `Organization.whatsappOcrEnabled`
(défaut `false`), bascule exposée dans les réglages organisation
(`owner`/`admin` uniquement, `POST /organizations/:id/whatsapp-ocr-channel`).
Une PME qui n'a jamais entendu parler de ce canal n'y est jamais exposée.

### 6. Résolution du client par téléphone : complète, ne remplace jamais

Le numéro de l'expéditeur WhatsApp (nécessairement un membre vérifié de la
PME, jamais le client final — WhatsApp Business ne transmet pas l'identité
d'un tiers cité dans un message) **complète** la résolution du client déclaré
par l'extraction (`resolveByPhone`, réutilisé tel quel depuis
`CustomersService`), et ne la remplace **jamais**. Si le modèle a lu un nom de
client dans le message dicté, ce nom prime. `ocrExtractionSchema` (ADR-122)
reste inchangé — aucun champ `buyerPhone` n'y a été ajouté ; le numéro de
l'expéditeur ne transite que dans le service, jamais dans le contrat Zod
partagé par les quatre sources.

### 7. Observabilité de l'échec définitif

Un document qui épuise ses tentatives de traitement (panne prolongée du hub
STT ou Vision) passe `REJECTED` — état déjà existant, décision 1 — mais le job
BullMQ correspondant se termine normalement du point de vue de la file
(choix délibéré, documenté dans le code : l'échec métier n'est pas une panne
d'infrastructure à faire retenter). Pour que cet état ne reste pas invisible
d'un tableau de bord qui ne surveille que le taux d'échec BullMQ, un compteur
Prometheus dédié (`trust_api_ocr_pipeline_jobs_rejected_total`, label
`source`) est incrémenté au moment exact de la transition — même patron que
`etax.metrics.ts`.

## Risque non résolu par ce chantier — rétention CNDP

**Non tranché ici, à dessein.** La conservation de `textBrut` et du média
vocal relayé — qui contiennent potentiellement un nom de client et un montant
— pose une question de conformité (CNDP) que ce chantier réduit sans la
fermer : l'auto-hébergement (décisions 2 et 3) empêche la donnée de sortir du
périmètre facture.gn, mais **aucune durée de rétention ni politique de purge
n'a été décidée ou construite**. Le module `retention/` existe déjà dans ce
dépôt pour d'autres données et devra être sollicité, pas reconstruit, une fois
la durée tranchée. Cette décision revient à un avis de conformité, pas à un
choix d'architecture — elle doit être prise explicitement avant tout
déploiement réel du canal WhatsApp, pas déduite après coup d'un chiffre
retenu par défaut.

## Alternatives écartées

- **SaaS de transcription tiers** (Whisper API hébergée, Google
  Speech-to-Text). Écartée : viole le positionnement souverain non négociable
  et expose la même classe de données que l'auto-hébergement cherche à
  garder interne.
- **Second hub d'inférence pour l'extraction texte.** Écartée : aurait
  dupliqué une question de souveraineté déjà tranchée par ADR-122 pour un
  seul hub.
- **Stockage managé tiers (Supabase Storage) pour le relais média WhatsApp.**
  Écartée en faveur de MinIO auto-hébergé, conforme DAT/ADR-013 — même
  raisonnement de souveraineté que la décision 2.
- **Cinquième statut `OcrDocumentStatus` pour un état intermédiaire de
  traitement.** Écartée : `RECEIVED` porte déjà l'attente, et le besoin réel
  était de l'observabilité (décision 7), pas un état supplémentaire à
  maintenir dans toutes les branches du pipeline.

## Ce qui reste hors périmètre de ce chantier

Ouverture des comptes réels (Meta WhatsApp Business Cloud API ou BSP,
hébergement du hub STT), provisionnement de `REDIS_URL` sur les secrets Fly de
trust-api (absent aujourd'hui — sans lui, AUDIO_PWA échoue systématiquement en
production, pas seulement en cas de panne), instance MinIO de production avec
verrouillage WORM 10 ans, et la décision de rétention CNDP ci-dessus.
