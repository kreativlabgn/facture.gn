# Plan : OCR multicanal — note vocale PWA et WhatsApp (photo, voix, texte)

## Contexte projet

Le Hub Vision (ADR-122) sait aujourd'hui lire une photo de carnet à souche et en
faire un brouillon, via un unique chemin synchrone : `POST /ai/ocr/scans` →
`OcrVisionProvider.extraire()` (image) → `ocrExtractionSchema` → double-garde
BigInt (`OcrValidationService`) → brouillon `Invoice` inséré dans la même
transaction que le lien `ocr_document.invoice_id`.

Cette tranche ajoute **trois nouvelles portes d'entrée** vers ce même pipeline,
sans jamais dupliquer sa partie protégée (double-garde, contrat Zod,
transaction d'insertion) :

1. **AUDIO_PWA** — le commerçant dicte sa facture dans la PWA (micro), au lieu
   de la taper ou de la photographier. Aucune nouvelle surface publique :
   même garde JWT/RolesGuard que le scan photo.
2. **WHATSAPP_TEXT** — le commerçant tape un message WhatsApp au numéro
   plateforme, qui le lit et en tire un brouillon. **Nouvelle surface
   publique non authentifiée** (webhook Meta Cloud API) — c'est le risque
   réel de cette tranche.
3. **WHATSAPP_VOICE** — même chose, en note vocale WhatsApp. Ajoute la
   transcription sur un tuyau déjà validé par WHATSAPP_TEXT.

Ordre de livraison confirmé (celui recommandé par le PM) : AUDIO_PWA d'abord
(zéro nouvelle frontière de confiance, sert de filet pour le pipeline
asynchrone) → WHATSAPP_TEXT (le webhook, la résolution d'expéditeur, l'opt-in
— tout le risque de surface publique concentré ici) → WHATSAPP_VOICE
(ajoute seulement la transcription sur un webhook déjà durci). Aucune raison
de s'en écarter : inverser ferait porter la nouvelle frontière de confiance
ET la transcription au même moment, ce qui doublerait ce qu'une revue de
sécurité doit vérifier en une seule passe.

## Ce qui reste verrouillé, non rouvert dans ce plan

Repris tel quel de la commande (avec la justification déjà actée) :

- `OcrDocument` est étendu, jamais dupliqué en un second modèle.
- `OcrDocumentStatus` reste à 4 valeurs. Aucun état "en cours de
  transcription" n'est ajouté (justification à la clarification 3).
- `ocrExtractionSchema` reste un contrat Zod unique, sans `buyerPhone`. Le
  numéro (PWA ou WhatsApp) se résout **avant** d'entrer dans ce contrat, côté
  service, et alimente `customer: {name, nif?}` comme aujourd'hui pour la
  photo (`resoudreClient()` dans `ocr-vision.service.ts`).
- La double-garde BigInt et `OcrValidationService` restent le SEUL routeur
  vers `DRAFT_PENDING_MANUAL_REVIEW`. Aucune des trois nouvelles sources n'a
  sa propre logique de validation — toutes retombent dans
  `OcrVisionService.traiter()`, inchangé dans sa signature.

## Clarifications — ce que la commande laissait ouvert, et ce que je tranche

### 1. `OcrVisionService.traiter()` ne change pas de signature

`traiter(documentId, organizationId, inference)` est déjà, dans le code
existant, détaché de tout ce qui est spécifique à la photo (voir son propre
commentaire : "Public et détaché de `scanner()`... la décision serveur ne
dépend d'aucune propriété du modèle"). C'est le point de convergence naturel
des quatre sources — je ne le touche donc qu'à la marge : le littéral
`emissionChannel: "pwa"` codé en dur dans la création de l'`Invoice` devient
une fonction pure `emissionChannelForSource(document.source)` (nouveau fichier
`ai/ocr-document-source.ts`), lue depuis le document déjà chargé en tête de la
méthode. Aucun appelant existant (le chemin photo, son test d'intégration
Postgres réel) ne change de contrat.

### 2. Deux nouveaux ports de modèle, pas un seul élargi

La commande ne demande de trancher que l'hébergement de la transcription.
Mais le pipeline texte a en réalité DEUX étapes distinctes que la photo
confond en une seule (le modèle de vision lit ET structure en un appel) :

- **Transcription** (audio → texte brut) : nouveau port `SttProvider`
  (`ai/stt.provider.ts`), même discipline que `OcrVisionProvider` — appelé
  UNIQUEMENT pour AUDIO_PWA et WHATSAPP_VOICE.
- **Extraction depuis un texte** (texte → `{modelId, extraction}` conforme à
  `ocrExtractionSchema`) : nouveau port `OcrTextExtractionProvider`
  (`ai/ocr-text-extraction.provider.ts`) — appelé pour les TROIS sources
  textuelles (WHATSAPP_TEXT directement, AUDIO_PWA/WHATSAPP_VOICE après
  transcription).

Je ne les fusionne pas dans un seul port à union discriminée
(`{kind: "image"} | {kind: "text"}`) : cela aurait obligé à toucher
`OcrVisionProvider`, contrat déjà utilisé par le chemin photo en production,
pour une fonctionnalité qui ne le concerne pas. Deux ports neufs, additifs,
gardent le rayon d'explosion d'une revue de sécurité limité aux fichiers
neufs.

**Hébergement — je tranche, je ne laisse rien ouvert en silence :**

- **Extraction texte** : réutilise le HUB VISION SOUVERAIN existant
  (`OCR_VISION_ENDPOINT`/`OCR_VISION_TOKEN`), sur un sous-chemin neuf
  `{endpoint}/extractions/text` au lieu de `/extractions`. Même hub, même
  secret, zéro variable d'environnement nouvelle à provisionner : un modèle
  de langage capable de structurer une facture depuis une image en sait
  généralement tout autant depuis un texte — ce n'est pas un second modèle à
  héberger, c'est un second point d'entrée du même modèle. La question de
  souveraineté est déjà tranchée par ADR-122 pour ce hub ; je ne la rouvre
  pas.
- **Transcription (STT)** : **auto-hébergée, sur l'infrastructure souveraine
  de facture.gn — jamais un SaaS tiers.** Nouvelles variables
  `OCR_STT_ENDPOINT`/`OCR_STT_TOKEN`, même discipline exacte que
  `OCR_VISION_ENDPOINT`. Trois raisons de trancher ainsi plutôt que de
  laisser la question ouverte comme ADR-122 l'a fait pour la vision :
  (a) le positionnement "tiers de confiance privé certifié" (CLAUDE.md) est
  non négociable, et envoyer des notes vocales contenant un nom de client et
  un montant à une API de transcription étrangère est exactement la fuite de
  souveraineté qu'ADR-122 avait laissée en suspens sans trancher — ce lot ne
  reproduit pas l'omission ; (b) le PM nomme explicitement Whisper, un modèle
  à poids ouverts conçu pour l'auto-hébergement (`faster-whisper`,
  `whisper.cpp`) — il n'y a pas de gain de simplicité à payer un SaaS pour un
  modèle qu'on peut faire tourner soi-même ; (c) c'est le SEUL moyen de
  réduire, et non seulement signaler, le risque CNDP déjà relevé par le PM
  (voir §Risques) — l'auto-hébergement ne fait pas sortir la donnée vocale du
  périmètre facture.gn. Ce qui reste ouvert, à dessein, exactement comme pour
  le hub vision : OÙ tourne cette infrastructure (quel rack, quel cloud) —
  une question d'exploitation pour devops-engineer, pas d'architecture.

### 3. Pas de 5e statut — `RECEIVED` + `processedAt: null` suffit, avec une nuance

Le PM suggère cette option ; je la retiens, avec le mécanisme exact qui la
rend suffisante :

- **AUDIO_PWA** est **asynchrone** (voir clarification 4). L'accusé de
  réception (`POST /ai/ocr/audio-notes` répond immédiatement `{status:
  "RECEIVED"}`) est suivi d'un job en file qui appelle `SttProvider` puis
  `OcrTextExtractionProvider` puis `traiter()`. Si CE job échoue après tous
  ses essais (panne du hub STT, pas une erreur de lecture), le document est
  marqué **`REJECTED`** avec `rejectionReason: "Transcription impossible
  après N tentatives — reprenez la note vocale ou saisissez la facture
  manuellement"`. Ce n'est pas un nouvel état : `REJECTED` signifie déjà "rien
  n'a pu être lu, le document est à rescanner" (commentaire existant du
  schéma), et une transcription qui échoue est exactement ce cas. Aucune
  invention nécessaire.
- Le "rejeu" que la commande évoque pour AUDIO_PWA n'est donc pas un 503
  HTTP synchrone sur la requête d'origine (impossible : cette requête a déjà
  répondu) — c'est la MÊME idempotence déclarative que la photo :
  `@@unique([organizationId, audioSha256])` fait que renvoyer le MÊME
  enregistrement audio après un `REJECTED` par épuisement retombe sur la
  ligne existante. Si le job avait échoué pour une cause transitoire non
  définitive (Redis indisponible AU MOMENT DE L'ENFILEMENT, pas pendant le
  traitement), la requête d'origine, elle, lève un 503 synchrone — c'est là,
  et seulement là, que le "pattern 503 rejouable existant" s'applique
  réellement : rejouer la même requête audio ré-enfile.
- **WHATSAPP_VOICE/WHATSAPP_TEXT** n'ont pas d'écran : le même épuisement de
  tentatives aboutit au même `REJECTED`, mais le signal n'est PAS une réponse
  HTTP — c'est un message WhatsApp sortant terminal, envoyé via
  `WHATSAPP_PROVIDER` (voir clarification 6).

`processedAt` reste le marqueur binaire "encore en cours" (`null`) / "verdict
posé" (horodaté) pour LES DEUX branches (succès ou `REJECTED` par
épuisement) — comportement inchangé de la colonne, pas de sémantique
nouvelle à lui superposer.

### 4. AUDIO_PWA est asynchrone — j'entérine la recommandation du PM

Le scan photo est synchrone parce qu'un appel HTTP peut tenir un budget de
20 s (`OCR_VISION_REQUEST_TIMEOUT_MS`) sur de la 3G. Une transcription audio
PUIS une extraction sont DEUX appels réseau séquentiels vers deux hubs
distincts : chaîner les deux dans le même budget de requête doublerait le
risque de timeout précisément pour l'usage (dicter à la voix) pensé pour les
connexions les plus dégradées. Le PM a raison de recommander l'async ; je
l'entérine et je précise le mécanisme : `POST /ai/ocr/audio-notes` enregistre
le document (idempotent sur `audioSha256`), enfile un job BullMQ
`TRANSCRIBE_AND_EXTRACT` sur une file NEUVE `ocr-pipeline` (infrastructure
`QueueModule`/`@nestjs/bullmq` déjà globale dans trust-api — voir
`etax`/`retention`/`pdp`/`merkle-anchor` pour le même patron), et répond
immédiatement. La notification de complétion (prêt à relire / relecture
requise / échec définitif) réutilise `SMS_PROVIDER`/`WHATSAPP_PROVIDER` via
le numéro `UserPhone` primaire de l'uploader — même patron best-effort que
`PaymentReminderService.send()`.

Profil de réessai — **délibérément plus court que celui d'eTax** (5 tentatves,
backoff 5 s, ~2h35 de budget) : eTax n'a personne qui attend une réponse,
un marchand qui a dicté une facture, si. `OCR_PIPELINE_JOB_OPTIONS = {
attempts: 3, backoff: { type: "exponential", delay: 10_000 } }` — 10 s, 20 s,
40 s, échec définitif sous la minute et demie. Un STT hub qui reste
indisponible plus de deux minutes ne se rattrapera pas en s'acharnant
davantage ; le mode de secours (saisie manuelle / renvoi WhatsApp) prend le
relais.

### 5. `EmissionChannel` gagne la valeur `whatsapp`

Le code actuel force `emissionChannel: "pwa"` pour TOUT brouillon issu du Hub
Vision, quelle que soit la source — vrai aujourd'hui (seule la PWA existe),
faux dès que WHATSAPP_TEXT/WHATSAPP_VOICE insèrent un brouillon. Ne pas
ajouter la valeur ferait mentir silencieusement ce champ pour tout brouillon
né d'un message WhatsApp — exactement le genre d'erreur de modélisation
"jamais deviné, jamais implicite" que ce dépôt refuse ailleurs (ADR-108,
saisieRegime). Je tranche : **`whatsapp` est ajoutée à `EmissionChannel`**,
posée par `emissionChannelForSource()` pour WHATSAPP_VOICE/WHATSAPP_TEXT
uniquement (AUDIO_PWA reste `"pwa"` : la dictée est un acte PWA comme la
photo).

Couplage avec `Payment.collectionChannel`, signalé par la commande comme à
évaluer : ce lot ne construit AUCUNE collecte de paiement par WhatsApp — la
valeur `whatsapp` restera non posée côté `Payment` jusqu'à ce qu'un besoin
réel existe. C'est le précédent déjà accepté par CE MÊME enum pour `api`
("modélisé pour le futur... aucun code ne le pose encore" — commentaire du
schéma). Aucune incohérence nouvelle introduite.

Blast radius identifié (à couvrir dans les tâches) : le filtre
`z.enum(["pwa","ussd","agent_terrain","api"])` de
`invoices/dto/list-invoices-query.dto.ts` doit gagner `"whatsapp"`, sans quoi
un brouillon WhatsApp serait invisible au filtre "factures émises par canal"
sans qu'aucun test ne le signale. Aucun `switch` exhaustif sur
`EmissionChannel` n'existe aujourd'hui dans trust-api (vérifié par grep) — pas
de second point à corriger de ce côté, mais à revérifier au moment de coder
(le code évolue vite dans ce dépôt).

### 6. Le webhook WhatsApp — contrat, garde, résolution, anti-abus

**Fournisseur supposé : Meta WhatsApp Business Cloud API** (hypothèse
explicite, non encore contractualisée — à confirmer avant le lot
WHATSAPP_TEXT). Contrat retenu :

- **Handshake** `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…
  &hub.challenge=…` — Meta l'appelle une fois à la configuration du webhook
  dans son tableau de bord. `@Public()`, pas de garde de classe : comparaison
  à temps constant de `hub.verify_token` contre `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
  (secret partagé, provisionné au déploiement), renvoie `hub.challenge` en
  texte brut si égal, 403 sinon.
- **Notification** `POST /webhooks/whatsapp`, corps
  `{ object, entry: [{ changes: [{ field: "messages", value: {
  messages?: [{ from, id, timestamp, type, text?: {body}, audio?: {id,
  mime_type} }], statuses?: […] } }] }] }`. Zod **tolérant** (pas
  `.strict()`) : Meta ajoute des champs (statuts de lecture, réactions) qu'on
  ignore délibérément plutôt que de faire échouer tout le webhook dessus.
  Types de message NON gérés (image, vidéo, document, sticker, localisation,
  contact) : réponse WhatsApp générique "je ne sais lire qu'un texte ou une
  note vocale" — jamais un crash, jamais un silence.
- **Garde de signature** `WhatsAppWebhookAuthGuard`
  (`whatsapp/whatsapp-webhook-auth.guard.ts`) — vérifie l'en-tête
  `X-Hub-Signature-256: sha256=<hex>` en HMAC-SHA256 du corps BRUT
  (`request.rawBody`, DÉJÀ activé globalement dans `main.ts` pour
  `PartnerWebhookAuthGuard` — aucun changement à `main.ts`) contre
  `WHATSAPP_APP_SECRET`, comparaison à temps constant. Mécanique HMAC
  directement reprise de `PartnerWebhookAuthGuard` (c'est un algorithme
  générique, pas une décision métier) ; TOUT le reste (résolution
  d'expéditeur, opt-in, anti-abus) est neuf — la commande a raison de dire
  qu'aucun garde existant ne couvre ce cas, et je ne prétends pas le
  contraire.
- **200 à Meta ≠ réponse à l'utilisateur.** Le corps HTTP renvoyé à Meta est
  un accusé de réception technique (toujours 200 si la signature est valide,
  y compris pour un message qu'on choisit d'ignorer côté métier — sans quoi
  Meta RE-livre le webhook en boucle). Le message que l'expéditeur WhatsApp
  voit est un appel SORTANT séparé vers l'API Meta d'envoi de message
  (`POST /{phone_number_id}/messages`), via `WHATSAPP_PROVIDER` — jamais le
  corps de la réponse webhook.

**Résolution expéditeur → organisation**, dans
`whatsapp/whatsapp-inbound.service.ts` :

1. Normaliser `from` au format `+224XXXXXXXXX` (`msisdnSchema`,
   `auth/dto/register.dto.ts` — réutilisé, jamais redupliqué).
2. `UserPhone.findUnique({msisdn})`. Absent → réponse générique "inscrivez-vous
   sur facture.gn" — **jamais** de distinction entre "numéro inconnu" et
   "numéro connu mais pas d'organisation", exactement comme demandé.
3. **`verifiedAt` est une condition EXPLICITE, tranchée par ce plan.**
   `UserPhone.verifiedAt IS NOT NULL` est exigé avant de faire confiance au
   numéro pour attribuer une action de saisie à une organisation.
   Justification : c'est le même niveau de preuve que ce dépôt exige déjà
   partout ailleurs où un numéro sert à authentifier plutôt qu'à notifier
   (`ClientPortalOtp`, `UssdAuthService.confirmPhoneOwnership` — "un PIN *620#
   vérifié avec succès prouve la possession du numéro exactement au même
   titre qu'un OTP SMS"). Un `UserPhone` non vérifié n'a jamais fourni cette
   preuve. Un numéro non vérifié → même réponse générique qu'un numéro
   inconnu (ne pas distinguer les deux évite de révéler qu'un numéro EST
   enregistré mais pas encore vérifié).
4. `OrganizationMember.findMany({userId, revokedAt: null})`. Différent de 1 →
   réponse générique "ouvrez l'app" (couvre le cas multi-organisation, hors
   scope ce lot, ET le cas 0 organisation active, qui ne devrait pas
   survenir si 3. est correct mais reste fail-closed).
5. Rôle du membre hors `ROLES_SAISIE` (constante partagée avec
   `AiController`, déplacée dans `ai/ocr-roles.ts` pour être importée des
   deux côtés sans dupliquer le tableau) → réponse "votre rôle ne permet pas
   cette action, contactez votre administrateur". Distincte de la réponse
   générique du point 2 : à ce stade l'identité EST confirmée (membre actif,
   numéro vérifié), donc lui dire pourquoi ne fuit rien qu'il ne sache déjà
   — même raisonnement que `PdpApiKeyAuthGuard`, qui distingue "clé invalide"
   (message unique, anti-énumération) de "palier insuffisant" (403 explicite,
   une fois l'identité acquise).
6. `organization.whatsappOcrEnabled === false` → réponse explicite "activez
   ce canal depuis les paramètres de votre organisation" (owner/admin
   seulement peuvent l'activer — voir clarification 7). Jamais un traitement
   silencieux.
7. Anti-abus, **par organisation résolue, jamais par IP** — tout le trafic
   Meta Cloud API sort d'un pool d'IP partagé par TOUTES les PME clientes ;
   throttler global par IP (`ThrottlerModule`, défaut 100/60 s) protégerait
   à l'échelle de la plateforme entière, pas d'une organisation qui
   spammerait le hub STT. Compteur Redis `whatsapp-ocr:{organizationId}:
   {heure}` (INCR + EXPIRE 3600, réutilise la connexion Redis déjà
   configurée pour BullMQ), plafond **30 soumissions/organisation/heure** —
   arbitraire mais documenté comme tel, du même ordre que les 20/60 s de
   `POST /ai/ocr/scans`, à recalibrer sur usage réel. Dépassement → réponse
   WhatsApp "trop de documents envoyés, réessayez dans une heure", PAS un
   403 muet.
8. Déduplication : `OcrDocument.whatsappMessageId` `@unique` (le `id` Meta,
   `wamid…`, globalement unique — pas composite avec l'organisation,
   contrairement à `imageSha256` : c'est l'espace d'identifiants de Meta, pas
   le nôtre). Un webhook re-livré par Meta (timeout, non-200 précédent)
   retombe sur l'enregistrement idempotent, ne ré-enfile rien.

**Média vocal WhatsApp — ce que ce plan NE résout PAS en détail et signale
comme risque d'infrastructure neuve (voir §Risques).** trust-api n'a
aujourd'hui **aucun client de stockage objet** — `storageKey` n'est qu'une
référence opaque que la PWA écrit directement dans un stockage que trust-api
ne touche jamais (vérifié : aucune trace de SDK S3/Supabase Storage dans
`apps/trust-api/src`). Pour WHATSAPP_VOICE, les octets vivent chez Meta ; le
seul moyen de les obtenir est un appel serveur-à-serveur authentifié par
`WHATSAPP_ACCESS_TOKEN` (jamais un secret exposable à un hub tiers). Décision :
`whatsapp/whatsapp-media-relay.service.ts` télécharge le média depuis l'API
Graph de Meta (`GET /{media-id}` puis `GET {url}`, jeton en en-tête) et le
DÉPOSE dans le MÊME stockage objet souverain que les photos, sous une
`storageKey` fraîche, avant d'appeler `SttProvider` par référence — jamais
inline dans l'appel HTTP au hub STT (même invariant "référence, pas octets,
traverse vers le hub d'inférence" qu'ADR-122 pour la vision). Cela exige une
capacité d'ÉCRITURE dans le stockage objet que trust-api n'a jamais eue :
c'est une pièce d'infrastructure neuve, pas seulement une intégration
applicative, et backend-developer doit la coordonner avec devops-engineer
avant d'écrire le code (bucket, SDK, credentials).

### 7. Bascule d'organisation — endpoint dédié, pas le PATCH d'identité

`PATCH /organizations/:id` (`update-organization.dto.ts`) est réservé à
l'identité légale (nom, régime fiscal, NIF/RCCM) — son commentaire liste
explicitement ce qui N'Y appartient PAS. `paymentLinkAutoSend` (précédent
direct : booléen sur `Organization`, `@default(true)`) n'y transite pas non
plus. Je suis le patron déjà établi par `/commercial-tier` (transition
nommée, verbe `POST`, pas un champ noyé dans un PATCH générique) :

```
POST /organizations/:id/whatsapp-ocr-channel
@Roles("owner", "admin")
@OrganizationIdSource("organization")
Body: { enabled: boolean }
→ OrganizationsService.setWhatsappOcrEnabled(organizationId, enabled)
```

### 8. Le sender WhatsApp sortant doit être réellement câblé, pas seulement stubé

`WhatsAppStubProvider` (existant) journalise et répond `{success: true}` sans
rien envoyer. Si ce lot s'arrête là, TOUTE la discipline "jamais de silence
définitif" votée par le PM devient un mensonge en l'absence de configuration
réelle : dans n'importe quel environnement sans câblage supplémentaire, les
messages d'opt-in désactivé, de rôle insuffisant, d'échec de transcription
terminal, etc. sont avalés par un `logger.log` que personne ne lit. Je
tranche : **ce lot câble un `MetaWhatsAppSendProvider` réel**, derrière le
MÊME token `WHATSAPP_PROVIDER`, avec la MÊME discipline d'usine que
`ocrVisionProviderFromEnv()` — `WHATSAPP_ACCESS_TOKEN` +
`WHATSAPP_PHONE_NUMBER_ID` présents → connecteur live (`POST
/{phone_number_id}/messages`) ; absents → `WhatsAppStubProvider` inchangé
(environnements de dev/test, comportement actuel préservé). Modifie
`notifications.module.ts` : `{ provide: WHATSAPP_PROVIDER, useClass:
WhatsAppStubProvider }` devient `useFactory: whatsappProviderFromEnv` — seule
modification d'un fichier de production existant en dehors du module `ai/`.

**Note Meta, à ne pas perdre** : hors de la fenêtre de 24 h suivant le
dernier message entrant d'un utilisateur, WhatsApp Business exige un message
TEMPLATE pré-approuvé, pas du texte libre. Ce lot ne répond QU'À un message
entrant (fenêtre toujours ouverte au moment de la réponse) — jamais de
notification WhatsApp proactive. Si un futur lot veut prévenir un marchand
hors de toute conversation active, il lui faudra des templates Meta
approuvés : hors périmètre ici, signalé pour ne pas être découvert trop tard.

## Solution — vue d'ensemble

```
                         ┌─────────────────────────────────────────┐
PWA (photo)  ──HTTP──►   │ AiController.scanner()  (INCHANGÉ)       │
                         │  → OcrVisionService.scanner()            │
                         │     → provider vision → traiter()        │
PWA (voix)   ──HTTP──►   │ AiController.recevoirAudio()  (NEUF)     │──enfile──┐
                         │  → OcrVisionService.recevoirAudio()      │          │
                         │     (registre + idempotence, PAS de      │          │
                         │      provider synchrone)                 │          │
                         └─────────────────────────────────────────┘          │
                                                                                ▼
Meta ──webhook──►  WhatsAppInboundController/Service (NEUF, whatsapp/)   Queue "ocr-pipeline"
  (texte/voix)       → auth signature, résolution expéditeur, opt-in,          │
                        anti-abus, dédup wamid                                 │
                      → OcrVisionService.recevoirMessageWhatsapp() ──enfile────┤
                                                                                ▼
                                                              OcrPipelineProcessor (NEUF)
                                                                → SttProvider (si audio)
                                                                → OcrTextExtractionProvider
                                                                → OcrVisionService.traiter()
                                                                   (INCHANGÉ : double-garde,
                                                                    transaction, insertion)
                                                                → notification best-effort
                                                                  (SMS / WhatsApp sortant)
```

`OcrVisionService.traiter()`, `OcrValidationService`, `ocrExtractionSchema`
sont au centre du diagramme et ne bougent pas de contrat — c'est le point que
toute revue va vérifier en premier, et c'est vérifiable par simple lecture :
zéro nouvelle branche à l'intérieur de ces trois fichiers au-delà de la
substitution `"pwa"` → `emissionChannelForSource(document.source)`.

### Diff `packages/db/prisma/schema.prisma` (à appliquer par backend-developer)

```diff
 model OcrDocument {
   id             String @id @default(uuid())
   organizationId String @map("organization_id")
   uploadedByUserId String @map("uploaded_by_user_id")

+  // Canal d'origine du document (ce plan, 2026-09-16). IMAGE_SCAN = valeur
+  // historique, @default pour compat rétroactive de toutes les lignes
+  // existantes. Détermine emissionChannelForSource() et si textBrut /
+  // audioSha256 / whatsappMessageId sont pertinents.
+  source OcrDocumentSource @default(IMAGE_SCAN)

   imageSha256 String? @map("image_sha256")   // devient nullable — voir note
   storageKey  String? @map("storage_key")    // devient nullable — voir note
   status OcrDocumentStatus @default(RECEIVED)
   modelId String? @map("model_id")
   extraction Json?

+  // Idempotence AUDIO_PWA — même statut déclaratif qu'imageSha256, jamais
+  // renommé/réutilisé : "image" dans le nom mentirait pour un fichier audio.
+  audioSha256 String? @map("audio_sha256")
+  // Transcription brute (STT) ou texte WhatsApp tel quel — jamais pour
+  // IMAGE_SCAN. Alimente OcrReviewAlert quand la source est vocale.
+  textBrut String? @map("text_brut")
+  // Idempotence WHATSAPP_TEXT/WHATSAPP_VOICE — le wamid Meta, GLOBALEMENT
+  // unique (espace d'identifiants de Meta, pas le nôtre) : pas composite
+  // avec organizationId, contrairement à audioSha256/imageSha256.
+  whatsappMessageId String? @unique @map("whatsapp_message_id")

   totalHtCentimes  BigInt? @map("total_ht_centimes")
   totalVatCentimes BigInt? @map("total_vat_centimes")
   totalTtcCentimes BigInt? @map("total_ttc_centimes")
   saisieRegime SaisieRegime? @map("saisie_regime")
   reviewFindings Json? @map("review_findings")
   rejectionReason String? @map("rejection_reason")
   invoiceId String? @unique @map("invoice_id")
   receivedAt  DateTime  @default(now()) @map("received_at")
   processedAt DateTime? @map("processed_at")
   organization Organization @relation(...)
   uploadedBy   User         @relation("OcrDocumentUploader", ...)
   invoice      Invoice?     @relation("OcrDocumentInvoice", ...)

   @@unique([organizationId, imageSha256])
+  @@unique([organizationId, audioSha256])
   @@index([organizationId, status])
   @@map("ocr_document")
 }

+enum OcrDocumentSource {
+  IMAGE_SCAN
+  AUDIO_PWA
+  WHATSAPP_VOICE
+  WHATSAPP_TEXT
+}

 enum EmissionChannel {
   pwa
   ussd
   agent_terrain
   api
+  whatsapp
 }
```

```diff
 model Organization {
   ...
   paymentLinkAutoSend Boolean @default(true) @map("payment_link_auto_send")
+  // Opt-in explicite (ce plan, 2026-09-16) — défaut OFF : sans bascule
+  // consciente owner/admin, aucun message WhatsApp entrant n'est traité pour
+  // cette organisation, même si l'expéditeur est un membre vérifié.
+  whatsappOcrEnabled Boolean @default(false) @map("whatsapp_ocr_enabled")
   commercialTier CommercialTier @default(freemium) @map("commercial_tier")
   ...
 }
```

**Note sur `imageSha256`/`storageKey` devenant nullable.** Ce sont
aujourd'hui des colonnes `String` obligatoires — correct tant que
`OcrDocument` ne représentait QUE des photos. WHATSAPP_TEXT n'a ni image ni
`storageKey` (le texte est dans `textBrut` directement). Cette nullabilité
est additive dans l'esprit (rien n'est retiré, un CHECK peut même formaliser
la corrélation avec `source` si backend-developer le juge utile — non
imposé ici) mais c'est techniquement une modification de colonnes
EXISTANTES, à distinguer clairement dans la migration des colonnes
purement neuves. `@@unique([organizationId, imageSha256])` reste valide :
Postgres autorise plusieurs `NULL` sur un index unique (même précédent que
`nif`/`etaxNumber`/`rccm` sur `Organization`).

### Squelette de migration (illustratif — à écrire pour de vrai par
backend-developer, format main comme toutes les migrations de ce dépôt)

`packages/db/prisma/migrations/<timestamp>_ocr_multicanal_whatsapp_audio/migration.sql` :

```sql
-- OCR multicanal — note vocale PWA et WhatsApp (texte/voix), plan
-- docs/plans/2026-09-16-ocr-multicanal-vocal-whatsapp.md. Extension ADDITIVE
-- de ocr_document (ADR-122 reste la décision de fond, aucun second modèle).
--
-- RLS : RIEN À AJOUTER — ocr_document et organization sont déjà sous
-- ENABLE + FORCE ROW LEVEL SECURITY (migrations 20260911120000 et la mise en
-- place initiale) ; une politique porte sur la ligne, pas sur la liste des
-- colonnes (même raisonnement que 20260916140000_product_catalog_fields).
--
-- whatsapp_message_id est UNIQUE SEUL, pas composite avec organization_id :
-- c'est l'espace d'identifiants de Meta (wamid…), globalement unique par
-- construction. Un P2002 dessus ne peut survenir que sur une re-livraison du
-- MÊME message par Meta vers NOTRE webhook — aucune fuite inter-tenant : la
-- valeur n'est jamais fournie par un appelant, seulement par notre propre
-- guichet WhatsApp après vérification de signature.
--
-- ATTENTION ALTER TYPE ... ADD VALUE : Postgres interdit d'utiliser une
-- valeur d'enum tout juste ajoutée dans LA MÊME transaction qui l'a créée.
-- Cette migration ne contient aucun DML qui référence 'whatsapp' — seulement
-- des DDL — donc sûre telle quelle. Ne JAMAIS ajouter un seed/smoke-test qui
-- insère emission_channel='whatsapp' dans ce même fichier.

-- CreateEnum
CREATE TYPE "OcrDocumentSource" AS ENUM ('IMAGE_SCAN', 'AUDIO_PWA', 'WHATSAPP_VOICE', 'WHATSAPP_TEXT');

-- AlterTable — colonnes neuves, additives
ALTER TABLE "ocr_document"
  ADD COLUMN "source" "OcrDocumentSource" NOT NULL DEFAULT 'IMAGE_SCAN',
  ADD COLUMN "audio_sha256" TEXT,
  ADD COLUMN "text_brut" TEXT,
  ADD COLUMN "whatsapp_message_id" TEXT;

-- AlterTable — nullabilité élargie (photo reste NOT NULL en pratique, la
-- contrainte applicative vit dans les DTO/services par source)
ALTER TABLE "ocr_document" ALTER COLUMN "image_sha256" DROP NOT NULL;
ALTER TABLE "ocr_document" ALTER COLUMN "storage_key" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ocr_document_organization_id_audio_sha256_key" ON "ocr_document"("organization_id", "audio_sha256");
CREATE UNIQUE INDEX "ocr_document_whatsapp_message_id_key" ON "ocr_document"("whatsapp_message_id");

-- AlterTable
ALTER TABLE "organization" ADD COLUMN "whatsapp_ocr_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum
ALTER TYPE "EmissionChannel" ADD VALUE 'whatsapp';
```

## Alternatives écartées

- **Un port de modèle unique, à union discriminée image/texte.** Écartée :
  aurait forcé à toucher `OcrVisionProvider`, contrat déjà en production pour
  la photo, pour une fonctionnalité qui ne le concerne pas — risque de
  régression sur le seul chemin qui certifie déjà des factures réelles, pour
  un gain de factorisation marginal (deux fichiers neufs contre un fichier
  modifié + un fichier neuf).
- **Un second hub souverain dédié à l'extraction texte.** Écartée : aucune
  raison technique de dupliquer l'hébergement — un modèle de langage capable
  de structurer depuis une image sait le faire depuis un texte ; dupliquer le
  hub aurait dupliqué la question de souveraineté qu'ADR-122 a déjà tranchée
  pour un seul hub.
- **SaaS tiers pour la transcription (Whisper API hébergée, Google
  Speech-to-Text, etc.).** Écartée explicitement (clarification 2) : viole le
  positionnement souverain non négociable, et expose des données
  personnelles (nom client, montant) à un tiers pour un modèle qui
  s'auto-héberge très bien.
- **Un 5e statut `TRANSCRIBING` sur `OcrDocumentStatus`.** Écartée
  (clarification 3) : `RECEIVED` + `processedAt: null` porte déjà cette
  information ; le seul besoin réel (distinguer "en cours" de "abandonné
  après épuisement") est couvert par `REJECTED`, qui a déjà ce sens.
- **Réutiliser `UssdAuthService`/le flux PIN *620# pour authentifier
  l'expéditeur WhatsApp.** Écartée : un PIN par message vocal/texte casserait
  l'usage (dicter une facture ne doit pas exiger un code à quatre chiffres à
  chaque envoi). Le risque résiduel est borné différemment : contrairement à
  *620# qui peut PAYER et DÉPENSER du crédit, le Hub Vision ne fait jamais
  plus qu'un BROUILLON, systématiquement revu par un humain avant
  certification — le même plafond d'autorisation que `ROLES_SAISIE` sur le
  scan photo authentifié par JWT, déjà jugé suffisant sans PIN additionnel
  pour cette classe d'action.
- **Comparer le nom du profil WhatsApp (`contacts[].profile.name`) à
  `User.name`.** Écartée : le nom de profil WhatsApp est auto-déclaré et
  modifiable par l'utilisateur, aucune valeur de preuve ; seule la propriété
  du numéro (via `UserPhone.verifiedAt`) est vérifiable côté serveur.
- **Un throttle par IP source du webhook.** Écartée (clarification 6, point
  7) : toutes les requêtes Meta partagent un pool d'IP à l'échelle de la
  plateforme entière — un throttle IP protégerait facture.gn globalement,
  jamais une organisation individuelle contre l'abus d'une autre.

## Découpage en tâches

Ordre : AUDIO_PWA d'abord (aucune nouvelle frontière de confiance),
WHATSAPP_TEXT ensuite (toute la surface publique), WHATSAPP_VOICE en dernier
(ajoute la transcription sur un webhook déjà durci).

### Étape 0 — Schéma (préalable aux trois étapes)

1. `packages/db/prisma/schema.prisma` : diff ci-dessus (OcrDocument, enum
   `OcrDocumentSource`, `EmissionChannel.whatsapp`,
   `Organization.whatsappOcrEnabled`).
2. Migration écrite à la main (squelette ci-dessus, timestamp réel au moment
   de l'implémentation).
3. `pnpm --filter db db:generate` puis `pnpm --filter db build` — dans cet
   ordre, sans quoi le typecheck de trust-api échoue avec un message
   trompeur (CONTRIBUTING.md).
4. `apps/trust-api/src/ai/ocr-document-source.ts` (neuf) :
   `emissionChannelForSource(source: OcrDocumentSource): EmissionChannel`,
   fonction pure.
5. `apps/trust-api/src/ai/ocr-roles.ts` (neuf) : extraction de `ROLES_SAISIE`
   hors de `ai.controller.ts`, réexporté par lui, importé par
   `whatsapp-inbound.service.ts`. Zéro duplication du tableau de rôles.
6. `apps/trust-api/src/invoices/dto/list-invoices-query.dto.ts` : ajouter
   `"whatsapp"` au `z.enum(...)` d'`emissionChannel`.

### Étape 1 — AUDIO_PWA (aucune nouvelle frontière de confiance)

7. `apps/trust-api/src/ai/stt.provider.ts` (neuf) : `STT_PROVIDER`,
   `SttAudioRef`, `SttResult`, `SttProvider`, `UnconfiguredSttProvider`
   (503), même structure que `ocr-vision.provider.ts`.
8. `apps/trust-api/src/ai/sovereign-stt.provider.ts` (neuf) : `POST
   {OCR_STT_ENDPOINT}/transcriptions` avec `{storageKey, mimeType}`, attend
   `{modelId, texte}`, timeout `OCR_STT_REQUEST_TIMEOUT_MS = 30_000`
   (budget worker, pas budget requête utilisateur — voir clarification 4),
   503 sur toute panne, `sttProviderFromEnv()` — copie quasi ligne à ligne de
   `sovereign-ocr-vision.provider.ts`, refus au démarrage si endpoint sans
   jeton.
9. `apps/trust-api/src/ai/ocr-text-extraction.provider.ts` +
   `sovereign-ocr-text-extraction.provider.ts` (neufs) :
   `OCR_TEXT_EXTRACTION_PROVIDER`, `POST {OCR_VISION_ENDPOINT}/extractions/text`
   avec `{texte}`, même enveloppe `{modelId, extraction}` que la vision,
   réutilise `OCR_VISION_ENDPOINT`/`OCR_VISION_TOKEN` (clarification 2).
10. `apps/trust-api/src/ai/dto/scan-audio.dto.ts` (neuf) : `scanAudioSchema`
    `{organizationId: uuid, audioSha256: /^[0-9a-f]{64}$/, storageKey,
    mimeType: enum(["audio/ogg","audio/mpeg","audio/mp4","audio/webm"])}`.
11. `apps/trust-api/src/ai/ocr-vision.service.ts` (modifié, minimalement) :
    - `traiter()` : substituer le littéral `"pwa"` par
      `emissionChannelForSource(document.source)`.
    - `enregistrer()` élargi ou dédoublé en `enregistrerAudio()` — écrit
      `source: "AUDIO_PWA"`, `audioSha256`, `storageKey`, PAS d'appel au
      provider (contrairement à `scanner()`).
    - Nouvelle méthode publique `recevoirAudio(dto, organizationId, userId):
      Promise<OcrScanResult>` — enregistre puis enfile
      `TRANSCRIBE_AND_EXTRACT` sur la file `ocr-pipeline` ; échec
      d'enfilement (Redis injoignable) → `ServiceUnavailableException`
      synchrone (c'est ici, et seulement ici, que vit le "503 rejouable").
    - `PROJECTION_LISTE`/`findOne` : ajouter `source`, `textBrut` à la
      sélection (additif, pour le front — clarification frontend).
12. `apps/trust-api/src/ai/ocr-pipeline.constants.ts` (neuf) :
    `OCR_PIPELINE_QUEUE = "ocr-pipeline"`, jobs `TRANSCRIBE_AND_EXTRACT` /
    `EXTRACT_FROM_TEXT`, `OCR_PIPELINE_JOB_OPTIONS` (attempts: 3, backoff
    exponentiel 10 s — clarification 4).
13. `apps/trust-api/src/ai/ocr-pipeline.service.ts` (neuf) : logique
    d'orchestration appelée par le processeur — transcrit si besoin, extrait,
    appelle `OcrVisionService.traiter()`, sur épuisement des tentatives
    marque `REJECTED` + notifie best-effort (réutilise
    `resolveNotificationProviders`/`SMS_PROVIDER`/`WHATSAPP_PROVIDER`, numéro
    `UserPhone` primaire de l'uploader pour AUDIO_PWA).
14. `apps/trust-api/src/ai/ocr-pipeline.processor.ts` (neuf) :
    `@Processor(OCR_PIPELINE_QUEUE) extends WorkerHost`, aiguille sur
    `job.name` vers `OcrPipelineService`, `UnrecoverableError` sur nom
    inconnu — patron exact d'`EtaxSyncProcessor`.
15. `apps/trust-api/src/ai/ai.module.ts` (modifié) : enregistre
    `BullModule.registerQueue({name: OCR_PIPELINE_QUEUE, defaultJobOptions:
    OCR_PIPELINE_JOB_OPTIONS})`, les nouveaux providers/services/processeur.
16. `apps/trust-api/src/ai/ai.controller.ts` (modifié) : `POST
    /ai/ocr/audio-notes`, `@Roles(...ROLES_SAISIE)`, `@Throttle({default:
    {limit: 20, ttl: 60_000}})` — même trio que `/ai/ocr/scans`.
17. `.env.example` (trust-api) : `OCR_STT_ENDPOINT`, `OCR_STT_TOKEN`,
    commentaire même format que la section `OCR_VISION_*` existante.

### Étape 2 — WHATSAPP_TEXT (toute la surface publique neuve)

18. `apps/trust-api/src/organizations/dto/set-whatsapp-ocr-channel.dto.ts`
    (neuf) : `{enabled: z.boolean()}`.
19. `apps/trust-api/src/organizations/organizations.service.ts` (modifié) :
    `setWhatsappOcrEnabled(organizationId, enabled)`.
20. `apps/trust-api/src/organizations/organizations.controller.ts` (modifié) :
    `POST :id/whatsapp-ocr-channel`, `@Roles("owner","admin")`,
    `@OrganizationIdSource("organization")`.
21. `apps/trust-api/src/whatsapp/whatsapp.constants.ts` (neuf) : en-têtes
    Meta, chemins Graph API, `WHATSAPP_OCR_HOURLY_LIMIT = 30`.
22. `apps/trust-api/src/whatsapp/dto/whatsapp-webhook.dto.ts` (neuf) : schéma
    Zod tolérant du corps Meta (clarification 6).
23. `apps/trust-api/src/whatsapp/whatsapp-webhook-auth.guard.ts` (neuf) :
    HMAC-SHA256 sur `request.rawBody` contre `WHATSAPP_APP_SECRET`,
    comparaison à temps constant — mécanique reprise de
    `PartnerWebhookAuthGuard`, secret et en-tête propres (`X-Hub-Signature-256`,
    format `sha256=<hex>`, distinct du format `PartnerWebhookAuthGuard`).
24. `apps/trust-api/src/whatsapp/whatsapp-abuse-guard.service.ts` (neuf) :
    compteur Redis par organisation résolue (clarification 6, point 7).
25. `apps/trust-api/src/whatsapp/whatsapp-inbound.service.ts` (neuf) :
    résolution expéditeur (points 1-6 de la clarification 6), dédup
    `whatsappMessageId`, dispatch vers `OcrVisionService
    .recevoirMessageWhatsapp()`, construction des réponses WhatsApp
    différenciées par verdict (voir tâche 27).
26. `apps/trust-api/src/whatsapp/whatsapp-inbound.controller.ts` (neuf) :
    `GET /webhooks/whatsapp` (handshake, `@Public()`, pas de garde de
    classe) ; `POST /webhooks/whatsapp` (`@Public()` +
    `@UseGuards(WhatsAppWebhookAuthGuard)`).
27. `apps/trust-api/src/ai/ocr-vision.service.ts` (modifié) : nouvelle
    méthode publique `recevoirMessageWhatsapp({organizationId,
    uploadedByUserId, whatsappMessageId, customerPhone} & ({kind: "text",
    texte} | {kind: "audio", storageKey, mimeType})): Promise<OcrScanResult>`
    — idempotente sur `whatsappMessageId`, enregistre (source WHATSAPP_TEXT
    ou WHATSAPP_VOICE), enfile `EXTRACT_FROM_TEXT` (texte, immédiat) ou
    `TRANSCRIBE_AND_EXTRACT` (audio, étape 3).
28. `apps/trust-api/src/ai/ocr-pipeline.service.ts` (modifié, suite de la
    tâche 13) : messages WhatsApp sortants différenciés par verdict —
    `AUTO_INSERTED` ("brouillon créé, ouvrez l'app"), `DRAFT_PENDING_MANUAL_REVIEW`
    /`REJECTED` par extraction pauvre ("exemple de message attendu : …" +
    lien app, PAS de formulaire en chat — clarification produit #4), échec de
    transcription épuisé (message terminal, clarification 3).
29. `apps/trust-api/src/notifications/notifications.tokens.ts` /
    `sovereign-whatsapp-send.provider.ts` (neuf) + `notifications.module.ts`
    (modifié) : `whatsappProviderFromEnv()` (clarification 8) —
    `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` présents → connecteur
    live, absents → `WhatsAppStubProvider` inchangé.
30. `apps/trust-api/src/whatsapp/whatsapp-media-relay.service.ts` (neuf,
    étape 3 seulement mais le fichier peut être posé ici) : à coordonner
    avec devops-engineer AVANT le code (clarification 6, note stockage).
31. `apps/trust-api/.env.example` : `WHATSAPP_APP_SECRET`,
    `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`,
    `WHATSAPP_PHONE_NUMBER_ID`, même format commenté que les sections
    existantes.
32. `apps/trust-api/src/whatsapp/whatsapp.module.ts` (neuf) : assemble
    contrôleur, garde, services ; importe `AiModule`.

### Étape 3 — WHATSAPP_VOICE (sur un webhook déjà durci)

33. `whatsapp-inbound.service.ts` (modifié) : branche `type === "audio"` —
    appelle `whatsapp-media-relay.service.ts` puis
    `OcrVisionService.recevoirMessageWhatsapp({kind: "audio", …})`.
34. `whatsapp-webhook.dto.ts` (modifié) : accepter `audio: {id, mime_type}`
    dans le message (déjà prévu dans le schéma de la tâche 22, à activer/
    tester réellement ici si laissé en `.optional()` non exercé avant).

### Frontend (peut être mené en parallèle de l'étape 2, dépend du schéma de
l'étape 0)

35. `apps/web/src/components/ai/OcrReviewAlert.tsx` (modifié, additif) :
    nouvelle prop optionnelle `source?: OcrDocumentSource` et `textBrut?:
    string | null`. Quand la source est vocale (`AUDIO_PWA`/`WHATSAPP_VOICE`),
    afficher un badge "Source : note vocale" + un bloc `textBrut` cité
    au-dessus de la liste des écarts (réutilise le style `blockquote`
    navy-950/texte blanc déjà présent dans `OcrRelectureDemo.tsx`, "Lecture
    du modèle"). Quand la source est `WHATSAPP_TEXT`, badge "Source :
    WhatsApp" + le même bloc `textBrut` (c'est le message tel quel, pas une
    transcription). `IMAGE_SCAN` : aucun changement visuel (comportement
    actuel).
36. Pas de nouvel écran de production de relecture construit ici — ADR-122
    laissait déjà ce point ouvert ("l'écran de relecture lui-même... reste
    ouvert") et aucun consommateur en production de `GET /ai/ocr/scans`
    n'existe aujourd'hui (vérifié : seul `OcrRelectureDemo.tsx`, une
    démonstration non branchée, l'utilise). ÉLARGIR `OcrReviewAlert` reste
    dans le périmètre demandé par la commande ; CONSTRUIRE l'écran de
    production ne l'est pas — à signaler si le fondateur veut l'ajouter au
    lot.
37. `apps/web/src/app/(app)/organisation/...` (paramètres d'organisation,
    fichier exact à identifier par frontend-developer selon l'arborescence
    actuelle des réglages) : bascule owner/admin pour
    `POST :id/whatsapp-ocr-channel`, avec le libellé exact du numéro
    WhatsApp plateforme à contacter et un rappel "vous et vos employés
    autorisés uniquement, jamais vos clients" (cadrage produit #2).

## Tests à écrire avant le code (TDD strict — RED avant tout code de production)

- `ai/ocr-document-source.spec.ts` — `emissionChannelForSource` : les 4
  sources vers les 2 canaux attendus, exhaustif.
- `packages/db` (ou `ai/schemas`) — régression verrouillant la décision 3 du
  cadrage : `ocrExtractionSchema` n'accepte toujours pas `buyerPhone` ni
  `organizationId` (étend le test déjà existant sur les clés élaguées).
- `ai/stt.provider.spec.ts` — `UnconfiguredSttProvider` rejette en 503.
- `ai/sovereign-stt.provider.spec.ts` — mêmes cas que
  `sovereign-ocr-vision.provider.spec.ts` : succès, timeout (`AbortError`),
  statut non-2xx, enveloppe sans `modelId`/`texte`, `sttProviderFromEnv()`
  (absent → non configuré, présent sans jeton → throw synchrone au démarrage).
- `ai/ocr-text-extraction.provider.spec.ts` +
  `sovereign-ocr-text-extraction.provider.spec.ts` — mêmes cas, plus :
  vérifie le sous-chemin `/extractions/text` et la réutilisation de
  `OCR_VISION_ENDPOINT`/`OCR_VISION_TOKEN` (pas de nouvelle variable lue).
- `ai/dto/scan-audio.dto.spec.ts` — accepte une commande complète, refuse un
  `audioSha256` mal formé, refuse un `mimeType` hors liste.
- `ai/ocr-vision.service.spec.ts` (étendu) :
  - `recevoirAudio()` enregistre avec `source: "AUDIO_PWA"`, enfile le job,
    NE PPELLE AUCUN provider de manière synchrone.
  - Rejeu du même `audioSha256` (même organisation) → pas de second
    enregistrement, pas de second enfilement (idempotence).
  - Échec d'enfilement (mock Queue.add qui rejette) → `ServiceUnavailableException`.
  - `traiter()` pose `emissionChannel: "whatsapp"` quand
    `document.source` est `WHATSAPP_TEXT`/`WHATSAPP_VOICE`, `"pwa"` sinon —
    ne casse AUCUN test existant sur le chemin photo.
  - `recevoirMessageWhatsapp()` : idempotence sur `whatsappMessageId`
    (rejeu → même document, pas de second enfilement), branche texte vs
    audio écrit les bons champs additifs.
- `ai/ocr-pipeline.service.spec.ts` (neuf) :
  - `TRANSCRIBE_AND_EXTRACT` réussi : `textBrut` persisté, `traiter()`
    appelé avec l'inférence issue de l'extraction texte.
  - Échec `SttProvider` transitoire : l'exception REMONTE (jamais avalée,
    même doctrine qu'`EtaxSyncProcessor` — c'est elle qui doit déclencher le
    backoff BullMQ).
  - Dernière tentative épuisée (mock `job.attemptsMade + 1 >= attempts`) :
    document → `REJECTED`, `rejectionReason` posée, notification best-effort
    envoyée (spy sur `SMS_PROVIDER`/`WHATSAPP_PROVIDER`, jamais levée en cas
    d'échec de la notification elle-même).
  - `EXTRACT_FROM_TEXT` : appelle `OcrTextExtractionProvider` avec
    `document.textBrut`, jamais `SttProvider`.
  - Messages WhatsApp sortants différenciés par verdict (un cas par valeur
    de `OcrScanResult.status`).
- `ai/ocr-pipeline.processor.spec.ts` (neuf) — patron exact de
  `etax-sync.processor.spec.ts` : aiguillage par `job.name`,
  `UnrecoverableError` sur nom inconnu, erreur métier non rattrapée.
- `whatsapp/whatsapp-webhook-auth.guard.spec.ts` (neuf) : signature valide
  accepte, signature absente/mal formée/incorrecte rejette (401), corps
  altéré après signature rejette. **Revue répétée jusqu'à "solide" explicite
  exigée par CONTRIBUTING.md — ce test est le premier filet.**
- `whatsapp/whatsapp-inbound.service.spec.ts` (neuf), un cas par branche de
  la clarification 6 :
  - Numéro inconnu → réponse générique, jamais distincte d'un numéro non
    vérifié.
  - `UserPhone` trouvé mais `verifiedAt: null` → même réponse générique que
    numéro inconnu (test qui compare littéralement les deux messages
    renvoyés — anti-régression sur la non-fuite).
  - Zéro ou plusieurs `OrganizationMember` actifs → réponse "ouvrez l'app".
  - Membre actif hors `ROLES_SAISIE` → réponse rôle insuffisant, DISTINCTE
    du cas générique (test qui vérifie l'écart de libellé, pour verrouiller
    la décision de la clarification 6 point 5).
  - `whatsappOcrEnabled: false` → réponse "activez le canal", AUCUN appel à
    `OcrVisionService`.
  - Plafond horaire dépassé → réponse "réessayez plus tard", AUCUN appel à
    `OcrVisionService`.
  - Message déjà vu (`whatsappMessageId` déjà en base) → pas de second
    appel à `recevoirMessageWhatsapp`, réponse 200 silencieuse à Meta.
  - Type de message non supporté (image, sticker...) → réponse pédagogique,
    aucun crash.
  - Chemin heureux texte → délègue avec les bons champs.
- `whatsapp/whatsapp-inbound.controller.spec.ts` (neuf) : handshake GET
  (jeton correct/incorrect), POST délègue au service après le garde.
- `whatsapp/whatsapp-abuse-guard.service.spec.ts` (neuf) : compteur Redis,
  plafond, expiration horaire (fake timers ou TTL mocké).
- `whatsapp/whatsapp-media-relay.service.spec.ts` (neuf) : succès, jeton Meta
  invalide, média introuvable — jamais d'octets journalisés.
- `notifications/sovereign-whatsapp-send.provider.spec.ts` (neuf) : miroir
  exact de `sovereign-ocr-vision.provider.spec.ts` adapté à l'API d'envoi
  Meta ; `whatsappProviderFromEnv()` (absent → stub, présent → live).
- `organizations/organizations.service.spec.ts` (étendu) :
  `setWhatsappOcrEnabled` écrit exactement le booléen demandé, rien d'autre.
- `organizations/organizations.controller.spec.ts` (étendu) : rôle
  owner/admin exigé sur `POST :id/whatsapp-ocr-channel`.
- `packages/db` — `ocr-vision.integration.spec.ts` (étendu, Postgres réel,
  RLS via `SET LOCAL ROLE facture_app`) : les deux nouveaux index uniques
  (`organizationId+audioSha256`, `whatsappMessageId`) rejettent bien un
  doublon ; une organisation ne voit jamais les `ocr_document` d'une autre,
  toutes sources confondues.
- `apps/web/src/components/ai/OcrReviewAlert.spec.tsx` (étendu) : badge de
  source affiché seulement pour les sources vocales/texte, `textBrut` rendu
  tel quel (pas de troncature), `IMAGE_SCAN` inchangé pixel-pour-pixel côté
  markup testable (pas de nouveau nœud DOM injecté).

## Critères de done

- `pnpm turbo lint typecheck test build` vert sur `trust-api`, `web`, `db`.
- Couverture `trust-api` non régressée (gate CI existant).
- Chemin photo (ADR-122) intégralement vert, AUCUN test existant modifié en
  dehors de `PROJECTION_LISTE`/`findOne` (ajout de champs, pas de retrait) et
  du littéral `emissionChannel`.
- Revues répétées jusqu'à "solide" explicite sur : `WhatsAppWebhookAuthGuard`,
  `whatsapp-inbound.service.ts` (résolution expéditeur, opt-in, anti-fuite),
  et la fonction de notification différenciée par verdict — conformément à
  CONTRIBUTING.md pour toute nouvelle frontière de confiance.
- `docs/architecture/adr-*.md` : un ADR posé pour ce lot avant merge
  (numérotation à vérifier au moment de l'écrire — `git grep "ADR-12[4-9]"`
  d'abord, le registre sauvegardé est en retard sur le code, précédent
  ADR-122/ADR-124 déjà rencontré dans ce dépôt).
- `.env.example` (trust-api) documente toutes les variables neuves avec le
  même niveau de commentaire que les sections `OCR_VISION_*`/`ETAX_*`
  existantes.
- Démonstration manuelle : un message WhatsApp texte de test, envoyé au
  numéro plateforme configuré en sandbox Meta, produit soit un brouillon,
  soit une relecture, soit un rejet — jamais un silence, jamais un crash 500.
- Aucun secret (jeton Meta, token STT) en clair dans un log — vérifié
  manuellement sur les nouveaux fichiers avant merge (redaction par chemin,
  CONTRIBUTING.md, ne devine pas une clé sous un nom inattendu).

## Risques

- **Conformité / CNDP — conservation de notes vocales et de textes contenant
  des données personnelles (nom client, montant).** Signalé par le PM,
  volontairement NON résolu ici : ce plan choisit l'auto-hébergement du STT
  pour RÉDUIRE l'exposition externe, mais ne tranche ni la durée de
  rétention de `textBrut`/de l'audio relayé, ni une éventuelle purge
  automatique (le module `retention/` existe déjà dans ce dépôt — à
  solliciter, pas à reconstruire). À faire trancher explicitement avant
  déploiement, pas découvert en production.
- **Dépendance Meta WhatsApp Business API.** Hypothèse de fournisseur non
  contractualisée à la date de ce plan (clarification 6). Le contrat de
  webhook précisé ici (Cloud API) peut différer d'un partenaire BSP
  (Business Solution Provider) si l'intégration passe par un intermédiaire —
  à reconfirmer avant d'écrire `whatsapp-webhook.dto.ts` pour de vrai.
- **Stockage objet — capacité neuve pour trust-api.** trust-api n'a
  aujourd'hui aucun client de stockage ; `whatsapp-media-relay.service.ts`
  lui en donne un pour la première fois (écriture, pas seulement référence).
  C'est une pièce d'infrastructure, pas seulement applicative — coordination
  devops-engineer nécessaire avant le code de l'étape 3, risque de retard si
  découvert tard.
- **Throttle anti-abus par organisation — valeur arbitraire (30/heure).**
  Non calibré sur un usage réel ; à revoir après le pilote, comme le
  20/60 s de `POST /ai/ocr/scans` l'a été implicitement.
- **Fenêtre de 24 h Meta pour les messages texte libre.** Ce lot ne répond
  qu'à des messages entrants (fenêtre toujours ouverte) — mais un futur
  ajout de notification proactive (ex. "votre canal WhatsApp a été
  réactivé") se heurterait aux templates pré-approuvés Meta sans qu'aucun
  code actuel ne le signale. Documenté ici pour ne pas être redécouvert à la
  dure.
- **`textBrut` d'une transcription fautive peut contenir un montant erroné
  jamais détecté par la double-garde si le modèle d'extraction "invente" des
  totaux cohérents à partir d'un texte mal transcrit.** La double-garde
  vérifie la cohérence ARITHMÉTIQUE de ce que le modèle a rendu, jamais sa
  fidélité au texte source — un "trois cent mille" mal transcrit en "trente
  mille" peut très bien passer la double-garde si le modèle d'extraction
  reste cohérent avec sa propre lecture fausse. C'est exactement le même
  risque, structurellement, que le modèle de vision lisant "8" pour "3" sur
  un carnet — déjà accepté par ADR-122 comme un risque résiduel couvert par
  la relecture humaine, pas éliminé par la double-garde. Pas un risque
  nouveau introduit par ce plan, mais à rappeler explicitement puisque
  l'audio ajoute une couche de traduction (son → texte) que la photo n'a
  pas.
- **`OcrPipelineService`/`OcrPipelineProcessor` deviennent un second endroit
  qui appelle `OcrVisionService.traiter()`, en plus de `scanner()`.** Risque
  de divergence future si quelqu'un modifie `traiter()` sans relire les deux
  appelants — atténué par le test d'intégration partagé et par le fait que
  `traiter()` reste volontairement le SEUL point qui touche la double-garde
  et la transaction d'insertion (aucune des deux nouvelles voies ne la
  contourne).

## Hors périmètre de ce plan

- Modèle de tarification de l'ingestion (signalé hors mandat par le PM).
- Contexte Capital.
- Support multi-organisation pour un même numéro expéditeur (réponse
  générique "ouvrez l'app" en attendant).
- L'écran de production de relecture des scans (`GET /ai/ocr/scans`
  n'a aujourd'hui aucun consommateur en production — ADR-122 l'a déjà laissé
  ouvert, ce plan élargit seulement `OcrReviewAlert` pour être prêt le jour
  où cet écran existera).
- Notification WhatsApp proactive hors fenêtre de 24 h (templates Meta
  pré-approuvés) — signalé en risque, non construit.
- Le choix définitif du fournisseur WhatsApp (Cloud API directe vs BSP) —
  hypothèse posée, à reconfirmer.
