# facture.gn — code

Infrastructure de facturation certifiée pour les PME de Guinée. Monorepo pnpm workspaces + Turborepo.

> Documentation métier de référence : `../V/` (PRD, DAT, ERD, Registre ADR, Backlog, Spec USSD).
> Toute divergence du schéma avec l'ERD doit être documentée dans `packages/db/prisma/schema.prisma`.

## Contenu du monorepo

| Paquet | Rôle | État |
|---|---|---|
| `apps/trust-api` | **Trust Context** — IAM, organisations multi-tenant, facturation core (invoice / proforma / devis / avoir / remboursement), certification (Ed25519, chaînage SHA-256), vérification publique, USSD, portail client, portail acheteur public (B2G), cabinet/CGA, FEC | actif — backlog 77/77 |
| `apps/money-api` | **Money Context** — orchestrateur de paiement multi-provider (interface `PaymentProvider` unique), circuit breaker Djomy → Moneroo, webhooks normalisés + idempotents | actif — stubs providers (pas de credentials réels) |
| `apps/web` | PWA Next.js — dashboard PME, page de paiement publique, page de vérification publique, portail client, vue cabinet | actif — périmètre réduit |
| `packages/db` | Schéma Prisma partagé (Postgres 16), client généré, migrations écrites à la main | actif |

**Capital Context** et **Platform Context** ne sont pas encore scaffoldés (voir `docs/plans/` et `../V/DAT-facture-gn.md`).

Le **Cert-Engine** (cible : service Rust isolé, 12 k signatures/s, HSM) est pour l'instant un stub Node (`@noble/curves` / `@noble/hashes`) intégré à `trust-api`.

## Architecture

Voir [`docs/architecture/`](docs/architecture/) — diagrammes C4 (contexte + conteneurs) et flux d'authentification inter-services.

## Prérequis

- Node ≥ 20 (la CI tourne sur Node 20 — ne pas figer une décision sur une version locale plus récente sans revérifier en CI)
- pnpm 11 (`packageManager` épinglé dans `package.json`)
- PostgreSQL 16

## Démarrage

```bash
pnpm install
pnpm --filter @facture-gn/db db:generate      # génère le client Prisma
pnpm --filter @facture-gn/db db:migrate        # applique les migrations (dev)
pnpm turbo dev                                 # lance tous les services en watch
```

### Infra locale avec Docker

```bash
docker compose up -d   # Postgres 16 + Redis 7 (docker-compose.yml)
```

Redis est requis par le worker de réconciliation des paiements de `money-api`
(BullMQ) — sans lui, mettre `RECONCILIATION_ENABLED=false`.

### Base de données locale sans Docker

Docker Desktop est instable sur certains postes de dev (WSL2). Contournement :
Postgres 16 portable (binaires ZIP EDB, sans installeur ni droits admin), extrait
dans `../pgtools/` (hors dépôt git, au même niveau que `code/`).

```bash
pgtools/pgsql/bin/initdb.exe -D pgtools/pgdata -U postgres --pwfile=<fichier contenant "postgres">
pgtools/pgsql/bin/pg_ctl.exe -D pgtools/pgdata -l pgtools/pg.log start
pgtools/pgsql/bin/createdb.exe -U postgres -h localhost -p 5432 facture_gn_dev
```

`packages/db/.env` (copié depuis `.env.example`) pointe déjà vers
`postgresql://postgres:postgres@localhost:5432/facture_gn_dev`. La CI utilise un
service `postgres:16` conteneurisé, non affecté par ce contournement.

### Variables d'environnement

Chaque service a un `.env.example` documentant le format **et la raison** de chaque
variable — les copier en `.env` puis renseigner de vraies valeurs :

| Service | Fichier | Secrets notables |
|---|---|---|
| `trust-api` | `apps/trust-api/.env.example` | `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (RS256), `CERTIFICATION_PRIVATE_KEY` (Ed25519), `CERTIFICATION_MASTER_KEY` (enveloppe AES des clés d'organisation), 5 secrets inter-services **strictement distincts** |
| `money-api` | `apps/money-api/.env.example` | `MONEY_API_INTERNAL_KEY` (partagé avec trust-api), secrets de webhook par provider |
| `web` | `apps/web/.env.example` | `TRUST_API_URL` (server-only, jamais `NEXT_PUBLIC_`) |
| `db` | `packages/db/.env.example` | `DATABASE_URL` |

NestJS ne charge **pas** automatiquement `.env` — exporter les variables ou utiliser
un lanceur (`dotenv -e .env -- pnpm dev`). Un secret manquant fait échouer le
démarrage (fail-fast) plutôt que de générer une valeur aléatoire silencieuse.

Générer des paires/clés de dev (jamais celles de prod — cible : Vault, ADR-008) :

```bash
# JWT RS256
node -e "const{generateKeyPairSync}=require('crypto');const{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});console.log('JWT_PRIVATE_KEY=\"'+privateKey.replace(/\n/g,'\\\\n')+'\"');console.log('JWT_PUBLIC_KEY=\"'+publicKey.replace(/\n/g,'\\\\n')+'\"');"
# Clé Ed25519 / secret 32 octets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Scripts

```bash
pnpm turbo lint        # ESLint (type-checked ; règles strictes — voir eslint.config.js)
pnpm turbo typecheck   # tsc --noEmit
pnpm turbo test        # vitest — avec gate de couverture sur trust-api et money-api
pnpm turbo build
```

Après **tout** changement de `packages/db/prisma/schema.prisma` :
`pnpm --filter @facture-gn/db db:generate` **puis** `pnpm --filter @facture-gn/db build`
(dans cet ordre — `packages/db` expose `dist/` compilé, pas les sources).

Un test d'intégration exige un vrai Postgres et échoue en local sans lui —
`apps/trust-api/src/invoices/invoice-numbering.service.integration.spec.ts`.
Pré-existant, indépendant, passe en CI.

## Journalisation

Logs JSON structurés (pino) avec redaction PII systémique et corrélation par
`x-request-id`. En dev, sortie lisible via `pino-pretty`. Niveau ajustable par
`LOG_LEVEL`. Ne jamais loguer un enregistrement Prisma entier — voir
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Observabilité

| Endpoint | Rôle |
|---|---|
| `GET /health/live` | livenessProbe k8s — le process répond, aucun I/O |
| `GET /health/ready` | readinessProbe — dépendances dures (Postgres ; + Redis sur money-api) |
| `GET /metrics` | exposition Prometheus (histogramme de latence HTTP + métriques Node) |

Ces trois routes sont **non authentifiées** et destinées au réseau interne du
cluster — **ne jamais les exposer via l'ingress public**. SLO et requêtes de
mesure : [`docs/slo.md`](docs/slo.md). Les traces OpenTelemetry sont une tranche
suivante.

## Contribuer

Workflow, conventions de commit et pièges connus : [`CONTRIBUTING.md`](CONTRIBUTING.md).
