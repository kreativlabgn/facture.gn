# ADR-120 (provisoire) — Hébergement intérimaire : Postgres managé (Supabase) + APIs sur Fly.io

> **Provisoire** : rédigé dans `code/` car `V/Registre-ADR-facture-gn.md` est
> momentanément indisponible (migration de charte en cours dans un autre
> contexte). À porter tel quel dans `V/`, Partie 28+, quand `V/` est propre.
> Numéro **120** (118 = PWA offline phase 1 ; 119 = icônes PWA + prompt
> d'installation, lot en cours dans un autre contexte, non encore mergé).
>
> **Cet ADR révise le DAT §1** (tableau « Stack technique ») pour la période
> pré-lancement uniquement. Il ne remplace pas la cible : Kubernetes OVH
> Gravelines (3 AZ) + edge Conakry pour les services, PostgreSQL 16 + TimescaleDB
> auto-géré avec RLS. Il pose une étape intermédiaire réversible.

## Contexte

Le monorepo n'a **aucune cible d'hébergement**. `trust-api`, `money-api` et `web`
ne tournent qu'en local (`pnpm dev`) ; la base est un conteneur `docker compose`
éphémère ; `packages/db` porte 66 migrations écrites à la main jamais appliquées
ailleurs qu'en local et en CI.

La cible DAT §1 — Kubernetes OVH Gravelines, PostgreSQL auto-géré, MinIO WORM,
HSM cloud, edge Conakry — est un chantier d'infrastructure de plusieurs semaines
qui n'a pas à bloquer un premier environnement accessible (démonstration aux
pilotes PME, à un DAF, à un cabinet ; tests hors du poste de dev ; previews de
branche pour `apps/web`).

Contrainte de marque (Charte §01, DAT §1) : « souveraineté locale — infrastructure
guinéenne ». Aucun hébergeur cloud ne propose de région en Guinée ; la cible OVH
elle-même est en France. Le sujet n'est donc pas « UE vs Guinée » mais « OVH
auto-géré (France) vs service managé tiers (France/UE) » pour une phase transitoire.

Décision produit/juridique en attente : le sponsor doit arbitrer si un service
managé piloté hors UE est acceptable avant l'agrément PDP. Cet ADR **n'anticipe
pas** cet arbitrage — il rend la bascule triviale dans les deux sens.

## Décision

### Base de données — Supabase, Postgres managé **et rien d'autre**

Un projet Supabase (PostgreSQL 16, région `eu-west-3` Paris) sert de base pour
`trust-api` et `money-api` en environnement de démonstration / staging.

**Périmètre strictement limité à « une boîte Postgres »** :

- **Utilisé** : le Postgres managé, le connection pooler (Supavisor, mode
  transaction, port 6543), la connexion directe (port 5432) pour les migrations,
  les sauvegardes automatiques du plan.
- **Non utilisé, explicitement** : Supabase Auth (GoTrue), PostgREST (API REST
  auto), Realtime, Storage, Edge Functions, `supabase/` CLI migrations. Les rôles
  Postgres `anon` / `authenticated` / `service_role` / `authenticator` restent
  inertes. Aucune policy RLS basée sur `auth.uid()`.
- **Raison** : l'IAM appartient à `trust-api` (JWT RS256, PIN argon2, PIN USSD,
  identité multi-numéros ADR-087, récupération de compte ADR-042, clés Ed25519
  déléguées). Le modèle PIN / feature phone / USSD est incompatible avec GoTrue.
  Le RLS du repo (migration `20260829150000`) est piloté par GUC de session
  (`set_config('app.current_org_id', …, TRUE)`), pas par claims JWT — il tourne
  à l'identique sur n'importe quel Postgres 16.

Conséquence sur Prisma : la datasource gagne `directUrl`. `DATABASE_URL` = pooler
transaction (`?pgbouncer=true`) au runtime ; `DIRECT_URL` = connexion directe pour
`prisma migrate`. `pgbouncer=true` désactive les prepared statements côté Prisma —
attendu. Le RLS reste compatible pooler (portée transaction, déjà noté dans
`rls-rollout.md`).

### APIs — Fly.io, un app par service, réseau privé

`apps/trust-api/fly.toml` et `apps/money-api/fly.toml`. Build des Dockerfiles de
production existants (multi-stage, non-root, Node 20) depuis la racine du
monorepo. Région primaire `cdg` (Paris).

- **Réseau inter-services** : `MONEY_API_URL` / `TRUST_API_URL` pointent sur
  `http://<app>.internal:<port>` (réseau privé 6PN Fly, jamais exposé). Seul
  `trust-api` a un `http_service` public (consommé par `apps/web`) ; money-api
  peut rester interne-seul (webhooks providers = phase ultérieure, credentials
  absents).
- **Santé** : le check de déploiement Fly cible `/health/live` pour money-api
  (`/health/ready` y dépend de Redis) et `/health/ready` pour trust-api (ne
  dépend que de Postgres).
- **Secrets** : posés via `fly secrets set` (inventaire = `TRUST_API_SECRETS` /
  `MONEY_API_SECRETS` dans `src/common/secrets.ts`). `NODE_ENV=production` →
  `assertSecretsValid` rejette tout placeholder au bootstrap.
- **Migrations** : `release_command` laissé **commenté**. Premier passage manuel
  et supervisé (66 migrations, base vierge). Si activé plus tard : sur `trust-api`
  seulement, jamais les deux apps (une seule base).

### Redis — Upstash free tier (money-api)

`MONEY_API_SECRETS` marque `REDIS_URL` `requiredInProduction: true` : money-api
ne démarre pas en production sans une URL Redis de format valide. Upstash
(serverless, `rediss://` TLS, compatible ioredis/BullMQ) est provisionné.
`RECONCILIATION_ENABLED="false"` — la brique BullMQ est chargée, le worker
répétable n'est pas armé (pas de credentials provider réels).

### Frontend — Vercel (`apps/web`)

Déjà au plan DAT §1. Hors de cet ADR quant à l'exécution : `TRUST_API_URL`
(server-only) pointera sur l'URL publique Fly de trust-api. Projet créé au
provisioning.

## Alternatives écartées

- **Attendre la cible DAT (OVH k8s + Postgres auto-géré).** Correct à terme, mais
  bloque tout environnement partageable pendant des semaines. Cet ADR est une
  passerelle, pas un remplacement.
- **Plateforme Supabase complète (Auth + PostgREST + RLS par JWT).** Réécriture
  lourde de l'IAM, incompatible avec le modèle PIN/USSD, et adoption de services
  propriétaires qui rendraient la sortie coûteuse — contraire au principe de
  réversibilité. Écarté sans ambiguïté (cf. clarification produit).
- **Neon / Railway Postgres / RDS pour la base.** Équivalents techniques. Supabase
  retenu pour les sauvegardes intégrées, le dashboard SQL, et parce que la CLI
  était déjà installée sur le poste. Le choix est sans conséquence : Prisma +
  migrations SQL → portable vers n'importe quel Postgres 16.
- **Railway pour les APIs** (au lieu de Fly). DX plus simple, mais réseau privé
  moins mûr, régions moins proches de l'Afrique de l'Ouest, et modèle de pricing
  plus opaque. Fly = du Docker nu + 6PN + région Paris/Johannesburg.
- **Render pour les APIs.** Services privés propres, mais le free tier suspend les
  services (cold start de plusieurs dizaines de secondes) — mauvais pour une démo.
- **Tout sur Vercel (APIs en Serverless Functions).** Contraire au DAT (« services
  séparés par bounded context, jamais un monolithe ») ; NestJS long-running + BullMQ
  + connexions Postgres persistantes ne conviennent pas au modèle Serverless.
- **Fly Postgres (au lieu de Supabase).** Fly a déprécié son offre Postgres
  managée (Managed Postgres encore jeune). Supabase est plus établi pour ce rôle.
- **Pas de Redis, patcher `requiredInProduction` sur `REDIS_URL`.** Modifie une
  garde de sécurité au bootstrap pour une raison d'infra — mauvais signal.
  Upstash free tier coûte zéro effort.

## Conséquences

- `packages/db/prisma/schema.prisma` : `datasource db` gagne
  `directUrl = env("DIRECT_URL")`. `DIRECT_URL` doit être défini partout où
  `prisma migrate` tourne : `.env.example` ×3, `docker-compose.yml` (services
  `trust-api` / `money-api`), job `build` de `.github/workflows/ci.yml`. En local
  et en CI : `DIRECT_URL` = `DATABASE_URL` (Postgres nu, pas de pooler).
- Nouveaux fichiers versionnés : `apps/trust-api/fly.toml`,
  `apps/money-api/fly.toml`. Aucune dépendance npm ajoutée.
- `DATABASE_URL` de production n'est plus une URL « simple » : au runtime c'est le
  pooler (`...pooler.supabase.com:6543/postgres?pgbouncer=true`), pour les
  migrations la directe (`db.<ref>.supabase.co:5432/postgres`). Documenté dans les
  `.env.example` et `rls-rollout.md`.
- Résidence des données : les données tenant (dont PII — MSISDN, NIF) résident
  chez Supabase (AWS UE, Paris) pour la durée de la phase intérimaire. À acter
  formellement par le sponsor avant d'y mettre des données de pilotes réelles.
- Free tiers : Supabase met le projet en pause après 7 jours sans activité (une
  démo à trafic intermittent le déclenchera — prévoir un ping ou l'upgrade au
  plan payant si la démo devient permanente) ; Fly `min_machines_running = 0` +
  `auto_stop_machines` (cold start de quelques secondes accepté en démo).
- La cible DAT (RLS, TimescaleDB si un jour nécessaire, HSM, MinIO WORM,
  edge Conakry) reste intacte — rien ici ne la contredit, tout est réversible :
  `pg_dump` → restauration sur le Postgres OVH, `fly.toml` → manifests k8s.
- `V/DAT-facture-gn.md` §1 : à annoter au prochain passage sur `V/` (« Infra :
  Kubernetes OVH … » → ajouter la ligne « Intérimaire pré-lancement : Supabase
  (Postgres) + Fly.io (APIs) + Vercel (web) — ADR-120, réversible »).

## Fast-follows

- **Provisioning effectif** (Supabase + Fly + Upstash + Vercel) — gaté sur les
  logins interactifs et le feu vert. Séquence dans le plan
  `2026-09-05-supabase-postgres-fly-interim.md`.
- **Mise à jour `README.md` + `CLAUDE.md`** après provisioning (la base n'est
  plus « auto-gérée » / `docker compose` seul).
- **Rôle applicatif `facture_app`** (non-propriétaire, sans BYPASSRLS) sur
  Supabase — étape 2 du `rls-rollout.md`, supervisée, quand on veut activer le
  RLS en staging.
- **money-api public** (`http_service`) le jour où les webhooks providers réels
  sont branchés (Djomy / Moneroo).
- **Arbitrage sponsor sur la résidence des données** avant données de pilotes
  réelles.
- **Bascule vers la cible DAT** (OVH k8s + Postgres auto-géré) — cet ADR devient
  caduc, `pg_dump` + manifests k8s.
