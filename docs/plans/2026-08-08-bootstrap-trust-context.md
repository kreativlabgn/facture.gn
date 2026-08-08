# Plan : Bootstrap monorepo + squelette Trust Context

## Contexte facture.gn
- Bounded context : Trust Context (Squad Trust) — IAM, organisations multi-tenant, facturation core, certification
- Persona affecté : équipe de développement (aucun utilisateur final encore exposé à ce stade)
- Données sensibles manipulées : NIF (organization), PIN (à venir en IAM), aucune clé Ed25519 réelle à ce stade (stub)
- Impact réglementaire : OHADA/SYSCOHADA (séquence sans trou Article 23) à respecter dès le schéma `invoice.number`

## Problème (en 3 lignes max)

Aucun code n'existe encore pour facture.gn — seulement de la documentation (PRD/DAT/ERD). Il faut poser les fondations techniques (monorepo, base de données, API) du Trust Context, dont dépendent les trois autres bounded contexts (Money, Capital, Platform), sans construire une usine à gaz avant d'avoir validé la structure de base.

## Solution retenue (en 5 lignes max)

Monorepo pnpm workspaces + Turborepo avec un package `apps/trust-api` (NestJS 20, Zod, OpenAPI auto-généré) et un package `packages/db` (Postgres 16 via Prisma ou Drizzle — à trancher en tâche 1). Schéma initial limité aux entités de la chaîne Trust MVP : `user`, `user_phone`, `organization`, `invoice`, `invoice_line`, `invoice_event` — avec les invariants ERD (immutabilité post-émission, séquence `number` sans trou par org/année). Certification Ed25519 implémentée comme interface `CertificationService` avec une implémentation stub Node (`@noble/curves`), remplaçable plus tard par le vrai service Rust isolé sans changer l'appelant. CI GitHub Actions basique : lint + typecheck + tests sur chaque push.

## Alternatives écartées

- **Nx au lieu de pnpm+Turborepo** : écarté par choix explicite de l'utilisateur — plus riche mais plus lourd à configurer pour un premier sprint.
- **Vrai Cert-Engine Rust dès maintenant** : écarté — le volume de signatures (12k/s visé) ne justifie pas l'isolation Rust au stade squelette ; le stub Node garde l'interface stable pour la migration future.
- **RBAC/PIN complet dès ce sprint** : écarté — périmètre volontairement réduit au scaffold + modèle de données ; l'authentification complète (9 rôles MVP) est un sprint suivant distinct.

## Découpage en tâches bite-sized (2–5 min chacune)

- [x] Tâche 1 : `git init` dans `code/`, `.gitignore` Node standard, README minimal
- [x] Tâche 2 : `pnpm init` racine + `pnpm-workspace.yaml` (apps/*, packages/*) + config Turborepo (`turbo.json`)
- [x] Tâche 3 : ORM choisi et confirmé : Prisma (vitesse de scaffold + migrations type-safe ; RLS multi-tenant avancée passera par du SQL brut ponctuel si besoin)
- [x] Tâche 4 : Scaffold `packages/db` — schéma Prisma des 6 entités MVP (`user`, `user_phone`, `organization`, `invoice`, `invoice_line`, `invoice_event`) avec enums (`status` 7 valeurs, `regime_fiscal` 4 valeurs, `document_type` 3 valeurs)
- [x] Tâche 5 : Migration initiale Postgres + script `pnpm db:migrate` — débloqué en contournant Docker Desktop (toujours "unable to start", souci WSL2 non résolu) : instance Postgres 16 portable (binaires ZIP EDB, sans installeur ni droits admin) extraite dans `../pgtools/` (hors dépôt git), cluster initialisé via `initdb`/`pg_ctl`, base `facture_gn_dev` créée. Migration `20260808035339_init` appliquée, 8 tables en base conformes au schéma.
- [x] Tâche 6 : Scaffold `apps/trust-api` NestJS (module `organizations`, module `invoices`, module `certification`)
- [x] Tâche 7 : `CertificationService` (interface) + `StubEd25519CertificationService` (implémentation `@noble/curves`) — chaînage SHA-256, `certification_id` format `GN-{NIF8}-{YYYY}-{HASH6}`
- [x] Tâche 8 : Endpoint `POST /organizations` (création, régime fiscal obligatoire, NIF unique)
- [x] Tâche 9 : Endpoint `POST /invoices` (draft) + `POST /invoices/:id/issue` (transition draft→issued, immutabilité post-émission, appel `CertificationService`)
- [x] Tâche 10 : Générateur de `number` séquentiel sans trou par organisation/année (upsert-incrément SQL atomique) — logique et format validés par test ; test de concurrence réelle exécuté contre Postgres réel (20 émissions concurrentes, aucun trou ni doublon confirmé)
- [x] Tâche 11 : OpenAPI auto-généré exposé sur `/docs`
- [x] Tâche 12 : CI GitHub Actions (lint, typecheck, test) sur push/PR — sans service Postgres pour l'instant, voir Tâche 5

## Tests à écrire AVANT le code

- [x] Test 1 : `create-organization.dto.spec.ts` / `organizations.service.spec.ts` — création rejetée si `regime_fiscal` absent (jamais de défaut TVA silencieux)
- [x] Test 2 : `invoices.service.spec.ts` — une facture `issued` refuse toute mutation directe (seul un événement append-only ou un avoir peut faire évoluer le statut)
- [x] Test 3 : `invoice-numbering.service.spec.ts` (format, GREEN) + `invoice-numbering.service.integration.spec.ts` (concurrence réelle, exécuté contre Postgres réel — 20/20 numéros uniques et consécutifs, GREEN)
- [x] Test 4 : `certification.service.spec.ts` — `certification_id` déterministe à partir de NIF+année+hash, `chain.prev` correctement chaîné (GENESIS puis chaînage)
- [x] Test 5 : `invoices.service.spec.ts` — machine à états : draft→issued autorisé, issued immuable, voided uniquement si `amountPaid = 0`

## Critères de done

- [x] Tous les tests verts (19 passés, y compris le test d'intégration Postgres de concurrence, plus aucun skip)
- [x] Aucune donnée sensible loggée (NIF ok en log applicatif, jamais de futur PIN)
- [x] Aucun hardcoded secret (`.env.example` uniquement, `.env` gitignoré)
- [x] `pnpm turbo lint typecheck test` passe en local (CI GitHub Actions écrite, pas encore exécutée — nécessite un push)
- [x] Schéma Prisma conforme à l'ERD de référence (mêmes noms de champs via `@map`, mêmes enums) — divergence `number` rendu nullable documentée en commentaire (bug réel trouvé en cours de route : un draft ne doit jamais consommer de numéro séquentiel)

## Risques identifiés & mitigations

- Risque 1 : dérive du schéma par rapport à l'ERD de référence (`Desktop/facture.gn/V/ERD-facture-gn.md`) → mitigation : chaque migration relit l'ERD, toute divergence volontaire est documentée en commentaire de schéma
- Risque 2 : le stub Ed25519 Node est traité comme définitif et jamais remplacé → mitigation : interface `CertificationService` isolée dans son propre module, TODO explicite référençant le Cert-Engine Rust cible (12k sig/s, ADR technique DAT §1)
- Risque 3 : numérotation séquentielle non atomique sous concurrence → mitigation : test de concurrence dédié (Tâche/Test 3) avant de considérer l'endpoint `issue` comme fait — **levé** : test exécuté contre Postgres réel, aucune violation observée
- Risque 4 : Docker Desktop indisponible en local reste non résolu (souci WSL2) → mitigation retenue : Postgres portable (binaires ZIP EDB) dans `../pgtools/`, hors dépôt git, comme solution de contournement pour le développement local ; CI GitHub Actions utilise un vrai service `postgres:16` conteneurisé (environnement CI non affecté par le souci Docker Desktop local)
