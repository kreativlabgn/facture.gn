# Plan : Postgres managé (Supabase) + hébergement API intérimaire (Fly.io)

## Contexte projet

- **Modules touchés** : `packages/db` (datasource Prisma — ajout `directUrl`),
  `apps/trust-api` + `apps/money-api` (fichiers `fly.toml`, `.env.example`),
  `apps/web` (déploiement Vercel — hors de ce lot, préparé seulement),
  `docker-compose.yml` + `.github/workflows/ci.yml` (propagation de `DIRECT_URL`),
  `docs/architecture/adr-e7-database-hosting.md`, `docs/runbooks/rls-rollout.md`
  (note Supabase). **Aucun** changement de logique applicative, **aucune**
  nouvelle migration, **aucun** type de domaine.
- **Persona affecté** : aucun côté produit — c'est un chantier d'infrastructure.
  Indirectement, tous : passer d'un Postgres local `docker compose` à une cible
  hébergée est le préalable à un premier environnement de démonstration accessible
  (pilotes PME, DAF, cabinet).
- **Données sensibles** : la base contient toutes les données tenant (factures,
  clients, paiements, PII : MSISDN, NIF). Le déplacement vers un hébergeur tiers
  (Supabase = AWS UE) est une décision de résidence de données — tracée à
  l'ADR-e7, arbitrage produit/juridique explicité, non tranché par ce plan.
- **Impact réglementaire** : la Charte et le DAT §1 posent « infrastructure
  guinéenne / souveraineté locale ». Supabase (AWS `eu-west-3` Paris) est la même
  classe de résidence qu'OVH Gravelines (France) mais un service piloté hors UE.
  L'ADR-e7 le pose comme **choix intérimaire réversible**, la cible DAT (Postgres
  auto-géré sur k8s OVH) restant la référence. Loi L/2016/037 : le traitement
  reste soumis au même régime ; aucun transfert hors UE introduit.

## Clarifications

- Q (périmètre Supabase) → R : **Postgres managé uniquement**. On garde Prisma,
  l'auth NestJS (JWT RS256, PIN argon2, USSD, multi-numéros ADR-087), le RLS par
  GUC de session (migration `20260829150000`). **Aucun** usage de Supabase Auth
  (GoTrue), PostgREST, Realtime, Storage, Edge Functions. Supabase est « une boîte
  Postgres » — les rôles `anon` / `authenticated` / `service_role` / `authenticator`
  restent inutilisés.
- Q (hébergement `trust-api` + `money-api`) → R : **Fly.io**, région `cdg` (Paris),
  réseau privé `.internal` (6PN). Intérimaire — la cible DAT reste Kubernetes OVH
  Gravelines + edge Conakry. Fly retenu pour le moindre lock-in (rien que du
  Docker), les régions proches (Paris maintenant, Johannesburg `jnb` plus tard)
  et le réseau privé natif entre services.
- Q (`apps/web`) → R : **Vercel** (déjà au plan DAT §1). Hors de ce lot : ce plan
  prépare seulement `TRUST_API_URL` côté web. Le projet Vercel est créé à l'étape
  de provisioning (via MCP), pas ici.
- Q (Redis pour money-api) → R : **Upstash Redis free tier** (`rediss://` TLS,
  compatible ioredis/BullMQ). Rendu obligatoire par le code lui-même :
  `MONEY_API_SECRETS` marque `REDIS_URL` `requiredInProduction: true` — money-api
  ne démarre pas en `NODE_ENV=production` sans une URL Redis de format valide.
  `RECONCILIATION_ENABLED="false"` au départ (brique chargée, worker non armé —
  cf. `reconciliation.module.ts`), il n'y a de toute façon pas de credentials
  provider réels (webhooks en stub).
- Q (MinIO / stockage WORM) → R : **hors périmètre** — aucun SDK stockage dans le
  repo à ce jour. Reste sur la cible DAT (MinIO object-lock 10 ans).
- Q (`directUrl` : impact CI / Docker) → R : `prisma generate` (build Docker)
  n'exige pas la présence des variables de datasource ; `prisma migrate` (CI +
  local) si. Donc `DIRECT_URL` doit être défini partout où une commande `migrate`
  tourne : `.env.example` ×3, bloc `environment:` de `docker-compose.yml` (services
  `trust-api` / `money-api`), job `build` de `ci.yml`. En local et en CI,
  `DIRECT_URL` = `DATABASE_URL` (Postgres nu, pas de pooler).
- Q (activation RLS sur Supabase) → R : inchangée dans son principe. Le rôle
  `postgres` de Supabase a des privilèges élevés implicites → l'étape 2 du runbook
  (`CREATE ROLE facture_app` non-propriétaire, sans BYPASSRLS) reste une étape
  **supervisée ultérieure**, non incluse ici. Note ajoutée au runbook.
- Q (exécution des migrations au déploiement) → R : **manuelle et supervisée pour
  le premier passage** (66 migrations sur une base vierge), cohérent avec la
  posture CONTRIBUTING sur les migrations. `release_command` Fly laissé **commenté**
  dans `fly.toml` avec la marche à suivre ; activable après le premier run.

## Problème (3 lignes)

Le monorepo n'a aucune cible d'hébergement : les APIs ne tournent qu'en local
(`pnpm dev`), la base n'est qu'un conteneur `docker compose` éphémère, et
`apps/web` n'est jamais déployé. Impossible d'exposer un environnement de
démonstration ou de commencer à faire tester le produit hors du poste de dev.

## Solution retenue (5 lignes)

(1) **Base** : projet Supabase (Postgres 16, région Paris), branché en Prisma via
`DATABASE_URL` (pooler transaction, port 6543, `pgbouncer=true`) au runtime et
`DIRECT_URL` (connexion directe, port 5432) pour les migrations — d'où l'ajout de
`directUrl` à la datasource. (2) **APIs** : un `fly.toml` par service
(`apps/trust-api`, `apps/money-api`), build du Dockerfile existant depuis la racine,
région `cdg`, healthcheck Fly sur `/health/live` (money-api) et `/health/ready`
(trust-api, ne dépend que de Postgres). (3) **Réseau** : `MONEY_API_URL` /
`TRUST_API_URL` pointent sur `http://<app>.internal:<port>` (6PN Fly), jamais
exposés publiquement. (4) **Redis** : Upstash free tier pour money-api. (5) **Web** :
préparé seulement — `TRUST_API_URL` = URL publique Fly de trust-api, projet Vercel
créé au provisioning.

## Découpage en tâches (ce lot = points 1–6, aucun provisioning)

| # | Tâche | Fichier(s) | Type |
|---|---|---|---|
| 1 | Ce plan | `docs/plans/2026-09-05-supabase-postgres-fly-interim.md` | doc |
| 2 | ADR — révise DAT §1 (Postgres auto-géré → managé intérimaire ; OVH k8s → Fly intérimaire) | `docs/architecture/adr-e7-database-hosting.md` | doc |
| 3 | `directUrl = env("DIRECT_URL")` sur la datasource | `packages/db/prisma/schema.prisma` | config |
| 4 | Scission `DATABASE_URL` (pooler) / `DIRECT_URL` (direct), format Supabase + raison ; propagation CI + compose | `apps/{trust-api,money-api}/.env.example`, `packages/db/.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml` | config |
| 5 | `fly.toml` des deux APIs — build racine, région `cdg`, checks, `[env]` non secrets, inventaire des secrets à poser, `release_command` commenté | `apps/trust-api/fly.toml`, `apps/money-api/fly.toml` | config |
| 6 | Note Supabase (pooler transaction OK, rôle `facture_app` à créer, rôles Supabase inutilisés) | `docs/runbooks/rls-rollout.md` | doc |

## Étapes de provisioning (HORS de ce lot — gatées sur le feu vert + les logins)

1. `supabase login` (toi) → création projet `facture-gn` région `eu-west-3` →
   récup `DATABASE_URL` (pooler) + `DIRECT_URL` (direct).
2. `fly auth login` (toi) → `fly apps create facture-gn-trust-api` +
   `facture-gn-money-api`.
3. Upstash → Redis free tier → `rediss://` URL.
4. `fly secrets set` sur chaque app (inventaire au `fly.toml` ; générateurs :
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
   `MONEY_API_INTERNAL_KEY` **identique** des deux côtés).
5. Premier run migrations, supervisé :
   `DATABASE_URL=<direct> pnpm --filter @facture-gn/db db:migrate:deploy`.
6. `fly deploy --config apps/trust-api/fly.toml` puis money-api (depuis la racine).
7. Vérifier `/health/ready` des deux (money-api rouge tant que Redis absent —
   attendu) ; `fly logs`.
8. Vercel (MCP) : projet sur `apps/web`, root directory `apps/web`, build
   `next build --webpack`, env `TRUST_API_URL` = URL publique Fly de trust-api.
9. Mettre à jour `README.md` (§Démarrage) et `CLAUDE.md` (§structure — la base
   n'est plus « auto-gérée ») pour refléter la réalité post-provisioning.

## Tests à écrire avant le code

Aucun test unitaire : ce lot ne livre que de la configuration et de la
documentation. Garde-fous existants qui doivent rester verts **sans changement** :

- `pnpm --filter @facture-gn/db exec prisma validate` — la datasource avec
  `directUrl` reste valide.
- `pnpm turbo typecheck` — inchangé (le client Prisma généré ne dépend pas de
  `directUrl`).
- CI job `build` — après ajout de `DIRECT_URL` au job, `db:migrate:deploy`
  continue de passer contre le Postgres conteneurisé.
- `apps/*/src/common/secrets.spec.ts` — inchangés (aucun secret ajouté ou retiré
  de l'inventaire ; `DIRECT_URL` n'est pas un secret au sens de `validateSecrets`,
  c'est une URL de connexion sœur de `DATABASE_URL`, non listée — à confirmer en
  revue : faut-il l'ajouter à l'inventaire ? proposition : non pour ce lot, elle
  n'est lue que par le CLI Prisma, jamais par le process applicatif).

## Critères de done

- [ ] `prisma validate` OK avec `directUrl`.
- [ ] `pnpm turbo lint typecheck test` complet vert (là où Node tourne).
- [ ] CI verte : `DIRECT_URL` présent dans le job `build`, migrations appliquées.
- [ ] `docker compose --profile full up` : `DIRECT_URL` présent pour les deux
      services API.
- [ ] Les deux `fly.toml` : `fly config validate --config apps/<svc>/fly.toml`
      passe (à faire au provisioning, noté).
- [ ] ADR-e7 relie explicitement la décision au DAT §1 et au positionnement
      souveraineté, liste Fly + Supabase + Upstash, et pose la réversibilité.
- [ ] Runbook RLS : note Supabase ajoutée, cohérente avec les notes pooler
      existantes.
- [ ] `README.md` / `CLAUDE.md` : **non modifiés dans ce lot** (ils décrivent la
      réalité actuelle = local ; mis à jour à l'étape 9 du provisioning).
- [ ] `V/` non touché (ADR-e7 provisoire dans `code/docs/`, à porter en Partie
      28+ du Registre-ADR quand `V/` est propre).

## Risques identifiés & mitigations

- **R1 — souveraineté / résidence des données.** Supabase = AWS, service piloté
  hors UE, contre le positionnement DAT/Charte. → ADR-e7 pose le choix comme
  **intérimaire et réversible** (Prisma + migrations SQL portables → n'importe
  quel Postgres 16) ; région UE (Paris) ; décision d'arbitrage renvoyée au sponsor,
  pas prise par l'ingénierie. Aucun service Supafeature propriétaire adopté.
- **R2 — `directUrl` casse la CI / le build Docker.** → `DIRECT_URL` propagé au
  job `build` de `ci.yml` et aux services de `docker-compose.yml` ; `prisma
  generate` (seule commande Prisma du Docker build) n'exige pas la variable.
  Vérifié : la CI applique bien les migrations (`db:migrate:deploy`).
- **R3 — pooler PgBouncer (mode transaction) incompatible avec un `SET` de
  session.** → le RLS du repo utilise `set_config(key, value, TRUE)` (portée
  transaction), explicitement noté compatible pooler dans `rls-rollout.md`.
  `pgbouncer=true` dans l'URL désactive les prepared statements côté Prisma —
  comportement attendu, pas de perte fonctionnelle.
- **R4 — money-api ne démarre pas sans Redis en production.** → Upstash free tier
  provisionné ; `REDIS_URL` posé en secret Fly ; `RECONCILIATION_ENABLED="false"`
  tant qu'il n'y a pas de credentials provider.
- **R5 — migrations auto au déploiement Fly → exécution concurrente (2 apps, 1
  base) ou run non supervisé.** → `release_command` **commenté** dans les deux
  `fly.toml` ; premier run manuel ; si activé plus tard, uniquement sur
  `trust-api`, jamais les deux.
- **R6 — secrets de gabarit (`EXAMPLE0…`) déployés en prod.** → `assertSecretsValid`
  (bootstrap, avant NestFactory) rejette déjà les placeholders en
  `NODE_ENV=production`. `fly.toml` liste l'inventaire complet à poser via
  `fly secrets set`. `NODE_ENV=production` dans `[env]`.
- **R7 — `MONEY_API_INTERNAL_KEY` différent des deux côtés → 100 % des appels
  inter-services en échec.** → noté explicitement dans le plan de provisioning et
  en commentaire du `fly.toml` : une seule génération, même valeur sur les deux
  apps.
- **R8 — coûts.** Fly (2 machines shared-cpu-1x, auto-stop), Supabase free tier
  (pause après 7j d'inactivité), Upstash free tier. → `min_machines_running = 0`
  + `auto_stop_machines` ; surveiller la pause Supabase (démo = trafic
  intermittent) — noté comme limite du free tier dans l'ADR.
- **R9 — `V/Registre-ADR` indisponible, numéro d'ADR incertain.** → même
  convention qu'ADR-e5/118 : ADR provisoire dans `code/docs/architecture/`,
  numéro **120** (118 = PWA offline phase 1, 119 = icônes PWA — lot en cours dans
  un autre contexte, non mergé). À réconcilier au portage dans `V/`.

## Séquence de revue

Livrer les 6 points, puis en parallèle : `dev-code-reviewer` (cohérence config,
`fly.toml` corrects, propagation `DIRECT_URL` exhaustive) + `dev-architect`
(sous-agent — la décision révise le DAT §1 : périmètre Supabase tenu à « Postgres
seul », réversibilité réelle, frontières inter-services préservées) +
`dev-security-reviewer` (sous-agent — inventaire des secrets, `.internal` jamais
public, `NODE_ENV=production`, pas de secret en clair dans les `fly.toml`) +
`dev-git-historian` (cohérence avec ADR-e5/118 et la convention ADR provisoire).
**Pas** de `dev-domain-model-reviewer` (aucun type de domaine). **Pas** de
`dev-frontend-quality` (rien côté UI). Revalidation post-merge :
`pnpm turbo lint typecheck test`.
