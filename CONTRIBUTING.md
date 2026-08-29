# Contribuer à facture.gn

## Workflow imposé

Aucun commit direct sur `master`. Toute évolution non triviale (> ~5 lignes) suit :

1. **Brainstorm + plan** — écrire un `docs/plans/AAAA-MM-JJ-<feature>.md` (voir les plans
   existants pour le gabarit : contexte, clarifications, problème, solution, alternatives
   écartées, découpage en tâches, tests à écrire *avant* le code, critères de done, risques).
   Pas de code de production tant que le plan n'est pas validé.
2. **Exploration/architecture** (features non triviales touchant un module complexe ou une
   nouvelle brique) — blueprint fichier par fichier avant le TDD.
3. **Branche** — `feat/…`, `fix/…`, `refactor/…` ou `chore/…`. Si une collision multi-session
   est détectée (une autre session travaille dans le même répertoire), basculer immédiatement
   tout le travail restant dans un `git worktree` isolé.
4. **TDD strict** — RED (test qui échoue) → GREEN (code minimal) → REFACTOR. Jamais de code de
   production avant un test qui échoue.
5. **Revues** (parallèles, indépendantes) — bugs & logique, conventions & lisibilité,
   cohérence avec l'historique git, performance, et, selon le diff : sécurité (données
   sensibles), modèle de domaine (nouveau type), résilience (gestion d'erreur), qualité des
   tests, frontend (UI). Pour tout correctif touchant l'authentification/autorisation :
   **ne jamais s'arrêter à une seule passe de revue** — répéter jusqu'à ce qu'une passe
   confirme explicitement « solide » plutôt que « rien trouvé ».
6. **Merge** `--no-ff` sur `master`, puis suppression de la branche.
7. **Revalidation post-merge** — `pnpm turbo lint typecheck test` complet, y compris quand le
   merge n'a affiché aucun conflit (un merge « propre » peut quand même perdre du contenu si
   l'historique partage un ancêtre inattendu).

## Convention de commit

```
test+feat(trust-api,db): description courte (Story ID / §réf ADR)
```

Le préfixe reflète le contenu réel (`test+feat`, `fix`, `refactor`, `chore`, `docs`) et
la portée nomme les paquets touchés. L'historique est 100 % TDD — un commit `feat` sans
`test` correspondant est suspect.

Terminer les messages de commit par les lignes de co-autorat en vigueur pour la session.

## Qualité — ce que la CI vérifie

| Job | Contenu | Bloquant |
|---|---|---|
| `build` | `pnpm install --frozen-lockfile`, Prisma generate + migrate deploy, `turbo lint typecheck test` | oui |
| `build` (couverture) | `trust-api` et `money-api` : `vitest run --coverage` avec seuils dans `apps/*/vitest.config.ts` — la CI casse sur une **régression** de couverture, pas sur du code non encore testé (seuils = plancher, à remonter) | oui |
| `security` | `audit-ci` (HIGH/CRITICAL non tolérées → voir `.audit-ci.jsonc`), gitleaks (secrets) | oui |
| `codeql` | SAST `javascript-typescript`, suite `security-and-quality` | oui |

Dependabot ouvre un PR groupé chaque lundi (patch/minor) + PR séparés pour les majors.

## Règles ESLint notables (`eslint.config.js`, type-checked)

- `@typescript-eslint/no-floating-promises` : **error**. Une promesse non attendue est un
  bug (événement d'audit non commité, notification best-effort avalée — déjà vus dans
  l'historique). La marquer `void` si l'oubli est délibéré.
- `@typescript-eslint/switch-exhaustiveness-check` : **error**. Un `switch` sur un enum de
  domaine doit couvrir tous les cas (ou avoir un `default` explicite).
- `@typescript-eslint/no-explicit-any` : **warn** en `src/`, **off** en `*.spec.ts` (les
  mocks Prisma/Nest utilisent `as any` massivement).

## Journalisation

- Logs JSON via `nestjs-pino`. Config + redaction dans `apps/*/src/common/logging.config.ts`.
- La redaction agit par **chemin** (`password`, `pinHash`, `nif`, `signature`,
  `*.secret`, en-têtes d'auth…). Elle ne peut pas deviner un champ sensible logué sous
  une clé inattendue.
- **Ne jamais passer un enregistrement Prisma entier à un logger.** Loguer des champs
  explicitement choisis (`{ invoiceId, status }`), jamais `{ invoice }`.
- Jamais de montant GNF, PIN, NIF ou secret en clair dans un message de log.

## Base de données

- Migrations **écrites à la main** (`prisma migrate dev` n'est pas exécuté contre une vraie
  DB dans cet environnement) — suivre le format des migrations existantes dans
  `packages/db/prisma/migrations/`.
- Après tout changement de `schema.prisma` : `pnpm --filter @facture-gn/db db:generate`
  **puis** `pnpm --filter @facture-gn/db build`. Oublier le `build` fait échouer le
  typecheck de `trust-api` contre un `dist/` périmé, avec un message d'erreur trompeur
  (« no exported member »).
- Un `enum` Prisma **non référencé par un champ de modèle n'apparaît pas dans le client
  généré** — `prisma generate` réussit silencieusement sans lui. Un « type » jamais
  persisté doit être un type TypeScript local dans le service, pas un enum Prisma.
- Modifier le `onDelete` d'une FK : vérifier s'il existe une contrainte `CHECK` sur la
  même table qui interagirait avec le nouvel état résultant (ex. un `CHECK` XOR + un
  `SET NULL` produisant `(NULL, NULL)`).

## Pièges TypeScript / Prisma

- `Array<…> as const` est `readonly` et incompatible avec les types `WhereInput` de Prisma
  (qui attendent un tableau mutable) — utiliser `: MonEnum[]` explicite pour toute liste
  passée à un filtre `{ in: [...] }`.
- Un champ Prisma `Json` ne peut pas contenir un `bigint` brut (`JSON.stringify` lève) —
  convertir en `string` à l'écriture, reconvertir en `BigInt` à la lecture.

## RBAC

- `RolesGuard` / `@Roles()` est **global** (`APP_GUARD`) mais no-op si `@Roles()` est absent.
- Toute identité qui n'est **pas** un `OrganizationMember` d'une organisation PME
  (`PublicBuyerAccount` / DAF, `client_portal`, Agent commercial terrain, futures identités
  parallèles) doit avoir son autorisation **entièrement en ligne dans le service** — jamais
  `@Roles()` / `@OrganizationIdSource`, qui résoudraient la mauvaise identité.

## Vérifier avant de faire confiance

Un rapport d'agent/fork « en cours » ou « lancé en arrière-plan » peut être convaincant
sans qu'aucun outil n'ait été appelé. Toujours vérifier l'état réel (`git log`,
`git status`, existence des fichiers annoncés) avant de s'y fier.
