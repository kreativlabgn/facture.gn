# facture.gn — code

Infrastructure de facturation certifiée pour les PME de Guinée. Monorepo pnpm workspaces + Turborepo.

## Bounded contexts

- `apps/trust-api` — Trust Context : IAM, organisations, facturation core, certification (Ed25519 stub Node en attendant le Cert-Engine Rust)
- `packages/db` — schéma Prisma partagé, Postgres 16

Money, Capital et Platform Contexts ne sont pas encore scaffoldés — voir `docs/plans/`.

## Développement

```bash
pnpm install
pnpm --filter @facture-gn/db db:migrate
pnpm turbo dev
```

### Base de données locale sans Docker

Docker Desktop est instable sur certains postes de dev (souci WSL2). Solution de
contournement : Postgres 16 portable (binaires ZIP EDB, sans installeur ni droits
admin), extrait dans `../pgtools/` (hors dépôt git, au même niveau que `code/`).

```bash
# une seule fois : télécharger et extraire https://www.postgresql.org/download/windows/
# (binaires ZIP EDB Windows x64) dans facture.gn/pgtools/pgsql

pgtools/pgsql/bin/initdb.exe -D pgtools/pgdata -U postgres --pwfile=<fichier contenant "postgres">
pgtools/pgsql/bin/pg_ctl.exe -D pgtools/pgdata -l pgtools/pg.log start
pgtools/pgsql/bin/createdb.exe -U postgres -h localhost -p 5432 facture_gn_dev
```

`packages/db/.env` (copié depuis `.env.example`) pointe déjà vers
`postgresql://postgres:postgres@localhost:5432/facture_gn_dev`. La CI GitHub
Actions, elle, utilise un vrai service `postgres:16` conteneurisé et n'est pas
affectée par ce contournement.

### Authentification (JWT RS256, ADR-011)

`apps/trust-api` a besoin de `DATABASE_URL`, `JWT_PRIVATE_KEY` et `JWT_PUBLIC_KEY`
comme vraies variables d'environnement au démarrage (aucun chargement automatique
de `.env` côté NestJS — copier `apps/trust-api/.env.example` en `.env` documente le
format mais ne suffit pas à lui seul ; exporter les variables ou passer par un
gestionnaire de process qui charge le `.env`, ex. `dotenv -e .env -- pnpm dev`).

Générer une paire de clés RS256 de dev (jamais la même qu'en prod — voir ADR-008
pour la cible Vault Transit) :

```bash
node -e "const{generateKeyPairSync}=require('crypto');const{privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});console.log('JWT_PRIVATE_KEY=\"'+privateKey.replace(/\n/g,'\\\\n')+'\"');console.log('JWT_PUBLIC_KEY=\"'+publicKey.replace(/\n/g,'\\\\n')+'\"');"
```

## Documentation de référence

Voir `../V/` (PRD, DAT, ERD, Registre ADR) pour les invariants métier — toute divergence du schéma avec l'ERD doit être documentée.
