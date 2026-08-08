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

## Documentation de référence

Voir `../V/` (PRD, DAT, ERD, Registre ADR) pour les invariants métier — toute divergence du schéma avec l'ERD doit être documentée.
