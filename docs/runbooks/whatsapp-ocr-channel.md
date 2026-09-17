# Runbook — Canal OCR multicanal (audio PWA + webhook WhatsApp)

Infra/déploiement pour le plan `docs/plans/2026-09-16-ocr-multicanal-vocal-whatsapp.md`
(ADR à poser avant merge — voir « Critères de done » du plan, prochain numéro
libre `ADR-125` au moment de la rédaction de ce runbook, à revérifier).
Complète `docs/runbooks/secrets-management.md` (inventaire des secrets) et
`docs/runbooks/retention.md`/`merkle-anchor.md` (patron des files BullMQ
opt-in de trust-api) — ne les duplique pas.

## Ce que ce runbook couvre

Trois pièces d'infra neuves pour ce lot, aucune ne touche money-api ni web :

1. Un nouvel endpoint **public non authentifié** sur trust-api : `GET`/`POST
   /webhooks/whatsapp`.
2. Une nouvelle file BullMQ `ocr-pipeline` sur le Redis déjà partagé de
   trust-api.
3. Une capacité d'**écriture** dans un stockage objet, que trust-api n'a
   jamais eue avant ce lot (Étape 3 du plan). Le service dev (MinIO,
   `docker-compose.yml`) est posé par ce runbook ; le code applicatif
   (`whatsapp-media-relay.service.ts`) reste à écrire par backend-developer —
   voir §4.

## 1. Exposition réseau — la distinction à ne jamais perdre

CLAUDE.md et `README.md` (§Observabilité) posent la règle pour `/health/live`,
`/health/ready`, `/metrics` : **non authentifiés, réseau interne uniquement,
jamais exposés via l'ingress public**. `GET`/`POST /webhooks/whatsapp` est
l'**inverse exact** de cette règle, et c'est volontaire :

| Route | Authentification | Doit être joignable par |
|---|---|---|
| `GET /health/live`, `GET /health/ready`, `GET /metrics` | Aucune (`@Public()`) | Le réseau interne / le cluster (scrape Prometheus, probes) — **jamais Internet** |
| `GET /webhooks/whatsapp` (handshake), `POST /webhooks/whatsapp` (notification) | Aucune côté réseau — protection **applicative** par `WhatsAppWebhookAuthGuard` (HMAC-SHA256 du corps brut contre `WHATSAPP_APP_SECRET`, comparaison à temps constant) | **Internet public** — Meta doit pouvoir l'atteindre depuis son pool d'IP partagé, aucune allow-list d'IP viable côté facture.gn |

Ces deux routes n'ont donc pas la même politique d'exposition alors qu'elles
partagent la même caractéristique de surface (« pas de JWT ») — ne pas les
traiter comme une seule catégorie « routes `@Public()` » dans une règle
d'ingress ou de pare-feu future.

### État réel de l'infra aujourd'hui (vérifié, pas supposé)

`apps/trust-api/fly.toml` + `docs/architecture/adr-e7-database-hosting.md`
(§« APIs — Fly.io ») : trust-api n'a **qu'un seul** `http_service` Fly, sur le
port 3000, exposé publiquement dans son intégralité (`force_https = true`,
aucun routage par chemin). Il n'existe **aucun** reverse-proxy / ingress
applicatif dans ce dépôt qui filtre par route — la phrase « jamais exposés via
l'ingress » de CLAUDE.md/README est **déjà vraie aujourd'hui par accident**
(rien n'expose sélectivement `/health/*`/`/metrics`, mais rien ne les bloque
non plus : ils sont servis sur le même port public que tout le reste, protégés
uniquement par leur absence de valeur pour un attaquant — pas de sensibilité
dans les métriques HTTP exposées).

**Conséquence pour ce lot : aucun changement d'infra n'est nécessaire pour
rendre `/webhooks/whatsapp` public** — il l'est déjà, comme le reste de
trust-api, dès que le code est déployé sur l'app Fly existante.
`WhatsAppWebhookAuthGuard` est la SEULE protection réelle de cette route, et
elle doit rester « solide » (CONTRIBUTING.md — revues répétées jusqu'à
confirmation explicite).

**Risque à surveiller pour la cible DAT (Kubernetes OVH Gravelines,
`fly.toml` : « passerelle réversible »).** Le jour où un vrai ingress
Kubernetes remplace ce `http_service` Fly monolithique, il devra définir des
règles **par chemin** : `/webhooks/*` (WhatsApp, partenaires) et les routes
publiques métier (vérification, paiement) en `Ingress` ; `/health/*` et
`/metrics` **jamais** en `Ingress`, seulement en `Service` ClusterIP scrappé
par Prometheus in-cluster. Si cette distinction n'est pas faite
explicitement à ce moment-là (ex. un ingress générique `/*` recopié depuis
Fly par réflexe), `/metrics` redeviendrait public sur la cible — pas un risque
nouveau introduit par ce lot, mais le webhook WhatsApp est le premier endpoint
de ce dépôt dont l'exposition publique est **une exigence produit** (pas
juste tolérée) : c'est l'occasion de documenter la règle avant qu'elle ne soit
oubliée. Aucune action requise aujourd'hui (interimaire Fly, single service) —
à réévaluer explicitement dans l'ADR/le plan de bascule K8s.

## 2. Variables d'environnement à provisionner pour un déploiement réel

Aucune de ces valeurs n'existe pour de vrai dans cet environnement (pas de
compte Meta, pas de hub STT hébergé) — ce runbook documente **où** les poser
quand elles existeront, il ne les invente pas.

| Variable | Rôle | Format attendu (`assertSecretsValid`) | État dans le dépôt à ce jour |
|---|---|---|---|
| `OCR_STT_ENDPOINT` | Base du hub STT auto-hébergé (jamais un SaaS — clarification 2 du plan) | URL | Documentée dans `apps/trust-api/.env.example` (déjà à jour par backend-developer) |
| `OCR_STT_TOKEN` | Jeton du hub STT | `hexMin32` (à confirmer par backend-developer) | idem |
| `WHATSAPP_APP_SECRET` | HMAC du webhook (`X-Hub-Signature-256`) | `hexMin32`/format Meta (secret d'app Meta, pas généré par nous) | **Pas encore dans `.env.example`** (tâche 31 du plan, pas encore faite) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Handshake `GET /webhooks/whatsapp` | chaîne opaque, choisie par nous | idem |
| `WHATSAPP_ACCESS_TOKEN` | Appels sortants vers Graph API (envoi de message + téléchargement média) | jeton Meta (rotatif, pas un `hexMin32` généré ici) | idem |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant du numéro WhatsApp plateforme | identifiant Meta, pas un secret au sens HMAC | idem |
| `STORAGE_ENDPOINT` | Base du stockage objet MinIO (relais média WhatsApp, §4) | URL — `http://minio:9000` en docker-compose (réseau interne conteneurs) | Câblé en dev dans `docker-compose.yml` (service `minio`, ce runbook). Côté trust-api : `.env.example`/`secrets.ts` sont du ressort de backend-developer, pas de moi (voir §4) |
| `STORAGE_ACCESS_KEY` | Identifiant d'accès MinIO | dev : identique à `MINIO_ROOT_USER` du service `minio` (trivial, non secret) ; prod : clé de service dédiée, jamais la clé root | idem |
| `STORAGE_SECRET_KEY` | Secret d'accès MinIO | dev : identique à `MINIO_ROOT_PASSWORD` du service `minio` (trivial, non secret) ; prod : secret réel, provisionné hors dépôt | idem |
| `STORAGE_BUCKET` | Bucket cible des médias WhatsApp relayés | `ocr-media` | Bucket créé en dev par le job `minio-mc-init` (profil `full`, `docker-compose.yml`) — voir §4 |

Points de vérification faits sur les mécanismes **existants** pour des
secrets de même nature, à reproduire à l'identique pour les cinq ci-dessus une
fois les comptes réels ouverts — **rien à faire aujourd'hui**, juste où
insérer :

1. **`apps/trust-api/src/common/secrets.ts` (`TRUST_API_SECRETS`)** —
   c'est la source de vérité unique (voir `secrets-management.md`). À ce
   jour, `OCR_STT_ENDPOINT`/`OCR_STT_TOKEN`/`WHATSAPP_*` n'y figurent **pas
   encore** (vérifié par grep) — seul `ETAX_API_KEY` sert de gabarit récent
   (`requiredInProduction: true`, `format: "hexMin32"`, un `purpose` en une
   phrase). C'est du code trust-api : à ajouter par backend-developer, pas par
   moi — signalé ici pour qu'il ne soit pas oublié, exactement comme le
   `OCR_VISION_TOKEN` existant y figure déjà.
2. **`apps/trust-api/.env.example`** — `OCR_STT_*` y est déjà (commentaire
   au même format que la section `OCR_VISION_*`, avec la clause « souverain,
   jamais un SaaS tiers »). `WHATSAPP_*` reste à ajouter (tâche 31 du plan) —
   suivre le même gabarit de commentaire que `APIP_WEBHOOK_SECRET` (rôle,
   ADR/plan de référence, distinction stricte avec les autres secrets).
3. **`apps/trust-api/fly.toml`** (en-tête, bloc `fly secrets set` commenté) —
   c'est le point d'insertion réel en déploiement Fly intérimaire (ADR-120).
   Ajouter les 5 variables à la liste existante, dans le même bloc que
   `APIP_WEBHOOK_SECRET`/`ETAX_API_KEY` (ce dernier n'y est **pas encore**
   non plus, à vérifier/ajouter en même temps si backend-developer l'a
   oublié — hors périmètre strict de ce lot mais du même chantier).
4. **`scripts/setup-staging-secrets.ps1`** — génère et pose les secrets
   `hexMin32` **auto-générés** (`New-HexSecret`) pour trust-api/money-api.
   `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
   et `OCR_STT_TOKEN`/`OCR_STT_ENDPOINT` **ne peuvent pas** être générés par ce
   script — ce sont des valeurs qui viennent d'un compte Meta / d'un hub STT
   réel, pas des secrets internes aléatoires. Si ce script est étendu un
   jour, ces 5 variables devront rester des **paramètres** passés à la main
   (comme `SupabaseProjectRef`), jamais des `New-HexSecret`. Je ne modifie
   pas ce script ici (rien de réel à y poser).
5. **`docs/runbooks/secrets-management.md`** — inventaire par famille ; à
   compléter avec une ligne « Canal WhatsApp/OCR vocal » une fois les
   variables réellement provisionnées.

**Constat additionnel (hors mandat direct, signalé pour ne pas être
redécouvert) :** `REDIS_URL` n'apparaît dans **aucune** des deux listes
(`TRUST_API_SECRETS` ni le bloc `fly secrets set` de `apps/trust-api/fly.toml`)
alors que trust-api déclare déjà `BullModule.forRoot()` (`queue.module.ts`,
Lot J3) et que ce lot ajoute une file qui, contrairement à `retention`/
`merkle-anchor` (opt-in par `*_ENABLED`), **enfile à chaque appel de
`POST /ai/ocr/audio-notes`, sans interrupteur**. Sur le déploiement Fly actuel,
`queue.config.ts` retombe sur `redis://localhost:6379` en l'absence de
`REDIS_URL` — injoignable dans le conteneur Fly. Résultat concret : tant que
`REDIS_URL` n'est pas provisionné pour **trust-api** (il ne l'est aujourd'hui
que pour money-api, via Upstash — voir `apps/money-api/fly.toml`), AUDIO_PWA
échouera systématiquement en 503 dès sa mise en production, pas seulement en
cas de panne Redis réelle. `retention.md` recommande déjà, pour son propre
besoin, un Redis `rediss://` TLS avec ACL dédié partagé entre les files BullMQ
de trust-api — la même instance (éventuellement le même Upstash que
money-api, avec un ACL/DB Redis distinct) couvre `ocr-pipeline`. **Aucun
changement de code requis** (`queue.config.ts` lit déjà `REDIS_URL`
correctement).

**Traitement exact à suivre — même mécanisme que tout autre secret de ce
dépôt, JAMAIS une exception :**

1. `apps/trust-api/src/common/secrets.ts` (`TRUST_API_SECRETS`) — ajouter une
   entrée `REDIS_URL` (`format: "redisUrl"`, `requiredInProduction: true`,
   `required: false` — un fallback dev `redis://localhost:6379` reste toléré
   hors production, même patron que `WHATSAPP_APP_SECRET` déjà dans ce
   fichier).
2. `apps/trust-api/.env.example` — un **placeholder** uniquement
   (`REDIS_URL="redis://localhost:6379"`, déjà présent dans ce fichier pour
   le besoin `retention`/`merkle-anchor` — à confirmer qu'il couvre aussi ce
   besoin, pas une seconde variable).
3. `apps/trust-api/fly.toml` (bloc `fly secrets set` en en-tête, commenté) —
   ajouter le **NOM** `REDIS_URL` à la liste, avec un gabarit illustratif du
   même style que `apps/money-api/fly.toml` ligne 14
   (`REDIS_URL='rediss://default:<token>@<endpoint>.upstash.io:6379'`) —
   un placeholder dans un commentaire, jamais une valeur active.
4. La valeur **réelle** est posée en dehors du dépôt, une seule fois, via :
   `fly secrets set --config apps/trust-api/fly.toml REDIS_URL='rediss://…'`
   (commande interactive, jamais commitée, jamais dans `[env]` de
   `fly.toml`, qui est en clair dans git).

**Ne JAMAIS écrire de valeur `REDIS_URL` dans `[env]` de `fly.toml`** — cette
section est un fichier versionné en clair ; `[env]` ne doit contenir que du
non-secret (`PORT`, feature flags `*_ENABLED`, URLs internes Fly 6PN comme
`MONEY_API_URL`). Je corrige ici explicitement toute formulation antérieure
de ce runbook qui aurait pu laisser entendre l'inverse : à ce jour,
`apps/trust-api/fly.toml` ne contient et ne doit contenir aucune valeur
`REDIS_URL`, ni dans `[env]` ni ailleurs — seul `apps/money-api/fly.toml`
documente déjà le bon patron (placeholder dans le bloc commenté
`fly secrets set`, valeur réelle posée hors dépôt via `flyctl`).

## 3. File BullMQ `ocr-pipeline` — pas de changement d'infra Redis nécessaire

Vérifié plutôt que supposé : `docker-compose.yml` (service `redis`,
`redis:7-alpine`, `--save 60 1 --appendonly no`, aucune limite mémoire) et
`apps/trust-api/src/queue/queue.module.ts` (`BullModule.forRoot()`
`@Global()`, connexion Redis **unique** partagée par toutes les files
`registerQueue()` de trust-api — `retention`, `merkle-anchor-seal`,
`merkle-anchor-flush`, la file `pdp`). `ocr-pipeline` (tâche 15 du plan,
`ai.module.ts`) est une **cinquième** file BullMQ sur cette même connexion,
enregistrée du même geste (`BullModule.registerQueue({name: OCR_PIPELINE_QUEUE,
defaultJobOptions: OCR_PIPELINE_JOB_OPTIONS})`) — aucune infra Redis
supplémentaire, aucun paramètre de persistence/mémoire à changer en local.
Le compteur anti-abus WhatsApp (`whatsapp-ocr:{organizationId}:{heure}`,
clarification 6 point 7 du plan) réutilise également cette même connexion
Redis (`INCR`/`EXPIRE`, pas BullMQ) — même constat.

**Seul le point Redis en production (§2 ci-dessus, `REDIS_URL` absent des
secrets Fly de trust-api) reste à faire avant un déploiement réel** — pas un
changement de `docker-compose.yml`.

## 4. Stockage objet pour le relais média WhatsApp — MinIO (décidé)

**Décision effective (fondateur) : MinIO auto-hébergé**, conforme
`facture.gn-docs/DAT-facture-gn.md` (§1, Stack technique — « Stockage objet |
MinIO — WORM + object lock 10 ans | Preuves, PDF/A archivage ») et
`facture.gn-docs/Registre-ADR-facture-gn.md`, ADR-013 (« MinIO avec object
lock WORM 10 ans »). L'alternative Supabase Storage envisagée par une passe
antérieure de ce runbook est écartée : elle aurait divergé de la décision DAT
et créé une dette de migration à la bascule K8s pour un gain de simplicité
marginal, alors que MinIO est déjà le choix documenté et que ce lot ajoute
par ailleurs un hub STT auto-hébergé du même esprit souverain (clarification
2 du plan).

**Ce qui a été fait EN DEV par cette passe (`docker-compose.yml`, racine du
dépôt) :**

- Service `minio` (`quay.io/minio/minio`, tag épinglé — voir le commentaire
  du service pour la raison de `quay.io` plutôt que `docker.io/minio/minio`,
  images identiques mais Docker Hub n'accepte plus le pull anonyme pour ces
  deux images MinIO au moment d'écrire ceci), volume nommé
  `facture_gn_miniodata`, healthcheck réel (voir commentaire du service :
  `/dev/tcp` + requête HTTP minimale contre `/minio/health/live`, l'image
  n'embarquant ni `curl` ni `wget` ni `mc`). **Non gated par le profil
  `full`** — même patron que `postgres`/`redis` : disponible dès
  `docker compose up -d`, pour que `pnpm --filter trust-api dev` (hors
  Docker) puisse aussi l'atteindre via `localhost:9000`.
- Service `minio-mc-init` (profil `full` uniquement, `quay.io/minio/mc`) :
  crée le bucket `ocr-media` une fois (`mc mb --ignore-existing`, idempotent
  — testé manuellement en le relançant deux fois de suite, code 0 les deux
  fois), `depends_on: minio: {condition: service_healthy}`. **Hypothèse
  documentée, à vérifier** : au moment d'écrire ceci,
  `whatsapp-media-relay.service.ts` (backend-developer, en parallèle)
  n'existe pas encore dans l'arbre de travail — je ne peux donc pas savoir si
  son code gérera lui-même une création de bucket idempotente
  (`CreateBucketCommand` + capture de l'existant). Si c'est le cas, ce job
  d'init devient redondant mais reste sans effet de bord (idempotent) ; à
  retirer alors, pas urgent.
- `trust-api` (profil `full`) reçoit `STORAGE_ENDPOINT=http://minio:9000`,
  `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` (= `MINIO_ROOT_USER`/
  `MINIO_ROOT_PASSWORD` du service `minio`, triviaux, dev uniquement),
  `STORAGE_BUCKET=ocr-media`, et dépend de `minio` (`service_healthy`) et
  `minio-mc-init` (`service_completed_successfully`).
- **Non fait ici, volontairement hors de mon périmètre :** aucun code
  applicatif (`whatsapp-media-relay.service.ts`, client S3 dans trust-api),
  aucune entrée dans `TRUST_API_SECRETS`/`.env.example`/`fly.toml` pour
  `STORAGE_*` (à charge de backend-developer, même traitement que les autres
  secrets — voir §2, checklist point 10).

**Ce qui reste une action humaine future, PAS construite dans cette passe :**
provisionner une **instance MinIO de PRODUCTION** réelle (hébergement,
dimensionnement, sauvegardes, TLS) avec **WORM + object lock activé, rétention
10 ans** (ADR-013) — ceci est une opération d'exploitation avec des
implications de coût et de conformité qui dépasse un service docker-compose
de développement ; aucun object lock n'est configuré sur le service `minio`
ci-dessus (l'image `minio/minio` seule ne suffit pas : l'object lock
s'active à la CRÉATION du bucket avec un backend de stockage qui le supporte,
et doit être décidé avec le fondateur avant le premier bucket de production —
voir checklist point 10). Provisionnement du principe « référence, pas
octets » (ADR-122) inchangé : le stockage reste un intermédiaire vers le hub
STT, jamais un chemin direct octets → hub d'inférence.

## 5. Observabilité — recommandation (pas d'implémentation)

Vérifié : `apps/trust-api/src/metrics/` (`HttpMetricsInterceptor`,
`HTTP_DURATION_METRIC`) capture déjà, **génériquement, pour toute route** y
compris `/webhooks/whatsapp`, un histogramme de latence par `{method, route,
status_code}` — la latence brute du webhook et son taux de statuts HTTP
n'ont donc **rien à ajouter** de ce côté. Le patron `*.metrics.ts` par domaine
(`etax.metrics.ts`, `retention.metrics.ts`, `merkle-anchor.metrics.ts`) est en
revanche systématiquement complété de compteurs **métier**, que le générique
HTTP ne peut pas exprimer (un webhook peut répondre `200` à Meta tout en
rejetant le message côté métier — clarification 6 du plan : « 200 à Meta ≠
réponse à l'utilisateur »). Recommandation, à faire trancher/écrire par
backend-developer en suivant exactement ce patron (nouveau fichier
`whatsapp/whatsapp.metrics.ts` + `ai/ocr-pipeline.metrics.ts`, préfixe
`trust_api_`, `makeCounterProvider`/`makeHistogramProvider` via
`@willsoto/nestjs-prometheus`) :

- `trust_api_whatsapp_webhook_messages_total{outcome}` — un compteur par
  verdict de `whatsapp-inbound.service.ts` (`accepted`, `unknown_sender`,
  `unverified_sender`, `role_insufficient`, `channel_disabled`,
  `rate_limited`, `unsupported_type`, `duplicate`). C'est le signal qui aurait
  manqué à eTax si son échec de transmission n'était pas compté séparément —
  ici, un pic de `rate_limited` ou `unverified_sender` est le signe qu'une
  organisation (ou un attaquant) tape sur le webhook, invisible dans le
  générique HTTP puisque la route répond `200` dans tous ces cas.
- `trust_api_whatsapp_webhook_signature_rejected_total` — **séparé** du
  compteur ci-dessus : une signature HMAC invalide n'atteint jamais
  `whatsapp-inbound.service.ts` (rejetée par le guard, 401). C'est la
  métrique de sécurité la plus sensible de ce lot (revue « solide » exigée
  par CONTRIBUTING.md sur ce guard) — un plateau à zéro est attendu, toute
  hausse mérite une alerte immédiate.
- `trust_api_ocr_pipeline_jobs_failed_total{jobName,reason}` — miroir de
  `trust_api_etax_declarations_failed_total` pour `TRANSCRIBE_AND_EXTRACT`/
  `EXTRACT_FROM_TEXT`, posé au moment où `OcrPipelineProcessor` marque un
  document `REJECTED` par épuisement (clarification 3 du plan) — sans lui,
  un hub STT durablement en panne n'a aucun signal Prometheus, seulement des
  commerçants sans réponse.
- `trust_api_ocr_stt_duration_seconds` (histogramme) — latence du hub STT
  auto-hébergé isolément de l'extraction texte : si le hub STT dérive vers le
  budget `OCR_STT_REQUEST_TIMEOUT_MS = 30_000`, ce sera visible avant que le
  taux d'échec ne bouge (buckets à calquer sur le budget, ex. `[1, 3, 5, 10,
  15, 20, 30]`, cf. `HTTP_DURATION_METRIC` calé sur le SLO P95 API).
- `trust_api_whatsapp_ocr_channel_enabled_organizations` (gauge, recalculée
  périodiquement ou à l'activation/désactivation) — utile pour dimensionner
  le hub STT/l'anti-abus avant le pilote (le plan qualifie déjà le plafond
  30/heure/organisation d'« arbitraire, à recalibrer sur usage réel » —
  cette gauge est le point de départ du recalibrage).

Rien de ceci ne bloque le déploiement — à écrire par backend-developer au fil
de l'Étape 2/3, pas une pièce d'infra préalable.

## Checklist — ce qui reste à faire/décider avant un déploiement réel

À charge du fondateur, de backend-developer ou d'un futur lot (aucune de ces
actions n'est faite dans cette passe — comptes externes inexistants,
décisions produit à trancher) :

1. **Compte Meta WhatsApp Business Cloud API** (ou BSP intermédiaire — le
   plan signale l'hypothèse non contractualisée) à ouvrir avant de pouvoir
   poser `WHATSAPP_APP_SECRET`/`WHATSAPP_WEBHOOK_VERIFY_TOKEN`/
   `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` pour de vrai.
2. **Hub STT auto-hébergé** (Whisper/`faster-whisper`/`whisper.cpp`, décision
   déjà tranchée dans le plan) à déployer quelque part (rack, cloud —
   explicitement laissé ouvert par le plan comme une question d'exploitation)
   avant de poser `OCR_STT_ENDPOINT`/`OCR_STT_TOKEN`.
3. **`REDIS_URL` à déclarer dans `TRUST_API_SECRETS`/`.env.example` (backend-developer) puis provisionner pour de vrai via `flyctl secrets set`, jamais une valeur en clair dans `fly.toml`** (absent aujourd'hui,
   §2/§3 ci-dessus — traitement exact détaillé en §2) — sans quoi AUDIO_PWA
   échoue systématiquement en production dès sa mise en ligne, indépendamment
   de toute panne réelle.
4. ~~Décision de stockage objet~~ **Tranchée** (fondateur) : MinIO
   auto-hébergé, conforme DAT/ADR-013 — voir §4. Le service dev
   (`docker-compose.yml`) est posé par ce runbook ; reste une action humaine
   distincte, non couverte ici : provisionner l'instance MinIO de
   **PRODUCTION** avec WORM/object lock 10 ans (§4).
5. **Durée de rétention de `textBrut`/du média vocal relayé** — signalé comme
   risque CNDP non résolu par le plan lui-même ; toujours ouvert (le module
   `retention/` existant est le candidat naturel).
6. `apps/trust-api/src/common/secrets.ts` (`TRUST_API_SECRETS`) et
   `apps/trust-api/.env.example` : ajouter les 5 variables WhatsApp (tâche 31
   du plan, backend-developer) — `OCR_STT_*` y est déjà.
7. `apps/trust-api/fly.toml` (bloc `fly secrets set` en en-tête — NOMS et
   gabarits illustratifs uniquement, jamais des valeurs) et
   `docs/runbooks/secrets-management.md` (tableau d'inventaire) : compléter
   une fois les 5 variables WhatsApp + `OCR_STT_*` + `REDIS_URL` réellement
   provisionnées — pas avant, pour ne pas documenter des secrets qui
   n'existent pas encore.
8. Observabilité (§5) : compteurs `whatsapp.metrics.ts`/
   `ocr-pipeline.metrics.ts` à écrire par backend-developer au fil du code.
9. ADR du lot (numéro libre à confirmer, `ADR-125` pressenti au moment de ce
   runbook) — déjà listé comme critère de done du plan, rappelé ici pour
   mémoire.
10. **Instance MinIO de PRODUCTION** (§4) — action opérationnelle humaine,
    hors périmètre de cette passe : provisionnement réel (hébergement,
    volumes, sauvegardes, TLS), activation WORM/object lock 10 ans (ADR-013),
    `STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` de
    production à ajouter à `TRUST_API_SECRETS`/`.env.example` (backend-developer)
    puis à provisionner hors dépôt via `flyctl secrets set` — même traitement
    que `REDIS_URL` ci-dessus, jamais une valeur en clair dans `fly.toml`.
