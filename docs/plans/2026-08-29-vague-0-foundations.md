# Plan : Vague 0 — Le plancher (fondations qualité, sécurité, exploitation, doc)

## Contexte projet
- Module : transverse — **aucun bounded context métier touché**, aucune migration `packages/db`, aucun changement de logique applicative. Cible : `.github/`, `eslint.config.js`, configs de test, un module de logging technique dans `trust-api` + `money-api`, `README.md`, `docs/`.
- Persona affecté : **développeurs** (présents et futurs), équipe SRE future, auditeur d'agrément PDP. Aucun changement observable par un utilisateur final.
- Données sensibles manipulées : aucune donnée sensible *ajoutée* — au contraire, H1 **réduit** le risque de fuite (redaction PII systémique dans les logs). PIN, NIF, secrets, montants ne doivent jamais transiter en clair dans un log JSON.
- Impact réglementaire : indirect et positif — journalisation exploitable + scan de dépendances + doc d'architecture sont des prérequis d'audit (agrément PDP visé Q3 2027).

## Spec consultée
- `docs/plans/` (convention de plan), mémoire projet (workflow, pièges connus), `benchmark-facture-gn` (artifact du 29/08, Vague 0).
- `V/DAT-facture-gn.md` : « OpenTelemetry natif », « Prometheus/Grafana/Loki », seuils P95 — H1 en est la première brique (logs) ; traces/métriques = Vague 2.
- `.github/workflows/ci.yml` (existant : lint + typecheck + test sur `master` + PR, Postgres 16 conteneurisé).

## Clarifications
- Q : Une seule branche pour les 5 items, ou une par item ? → R : **une branche** `chore/vague-0-foundations`, commits logiques séparés. Justification : items indépendants, aucun ne touche `schema.prisma` ni un service métier partagé → risque de collision quasi nul (contrairement aux lots A–E). Merge `--no-ff` unique.
- Q : Worktree isolé (règle mémoire) ? → R : **non** — la règle se déclenche « dès la première collision détectée ». `git worktree list` = 1 seule copie, aucune session parallèle, aucun fichier chaud partagé. Si une collision survient en cours de route, bascule immédiate en worktree.
- Q : Seuil de couverture (B1) ? → R : **mesuré puis fixé juste sous la valeur courante**, plancher 80 %, jamais au-dessus de la réalité (sinon la CI casse au premier run). Ratchet à la hausse dans les vagues suivantes.
- Q : ESLint type-checked (B2) — tout en `error` d'un coup ? → R : **non** — mesurer d'abord le nombre de violations. `no-floating-promises` + `switch-exhaustiveness-check` visés en `error` (fort ROI, faible volume attendu sur un code TDD) ; `no-explicit-any` en `warn` pour `src/`, désactivé pour `*.spec.ts` (les mocks utilisent `as any` massivement) ; ratchet ensuite.
- Q : Migrer les `new Logger()` des services vers `nestjs-pino` ? → R : **oui si volume faible** (grep : ~2 occurrences dans `invoices.service.ts`), sinon note de suivi. Le `app.useLogger()` route déjà l'essentiel.

## Problème (3 lignes max)
Le socle du projet a des trous invisibles quand on ne regarde que le code applicatif : aucun scan de dépendances/secrets en CI, aucune mesure de couverture, ESLint permissif (`any` autorisé, promesses flottantes non détectées), aucune journalisation exploitable, et un `README` périmé qui affirme que `money-api` n'existe pas. Ces trous coûtent 10× plus cher à combler une fois 5 lots de code empilés par-dessus et un premier déploiement fait.

## Solution retenue (5 lignes max)
Cinq chantiers indépendants, une branche, cinq commits :
1. **K1** — `README.md` remis à jour + `docs/architecture/` (C4 Mermaid, contexte + conteneurs) + `CONTRIBUTING.md` (workflow, conventions, pièges connus).
2. **C1** — `.github/dependabot.yml` (npm + github-actions, hebdo, groupé) + job `security` dans `ci.yml` (`pnpm audit --audit-level=high`, gitleaks) + `codeql.yml`.
3. **H1** — `nestjs-pino` dans `trust-api` + `money-api` : logs JSON, `x-request-id` propagé, redaction PII systémique (auth, pin, password, secret, token, key, nif, signature), `app.useLogger()`.
4. **B2** — `eslint.config.js` : passage en type-checked, `no-floating-promises`/`no-misused-promises`/`switch-exhaustiveness-check` en `error`, `no-explicit-any` en `warn` (src) / off (spec), overrides tests.
5. **B1** — `@vitest/coverage-v8` + `vitest.config.ts` par package testé, `test` script → `--coverage`, seuils mesurés puis figés, CI publie le rapport.

## Alternatives écartées
1. **Cinq branches / cinq PR séparées** — écarté : surcoût de cérémonie (5× worktree/merge/revalidation) sans bénéfice, les items ne partagent aucun fichier à risque. Retenu seulement si une collision apparaît.
2. **B1 avec seuil « idéal » 85 % d'emblée** — écarté : casse la CI si la couverture réelle est en dessous, transforme un chantier « plancher » en chantier « écrire 200 tests ». Ratchet progressif à la place.
3. **B2 : `recommendedTypeChecked` intégral en `error`** — écarté : sur ~1200 tests avec `as any` massif, produit un mur de milliers d'erreurs qui bloque tout. Sélection ciblée + relaxation sur les specs.
4. **H1 : OpenTelemetry complet (traces + métriques) maintenant** — écarté : c'est la Vague 2. La brique « logs structurés + redaction » a de la valeur seule et est un prérequis de tout déploiement ; traces/métriques demandent un collecteur OTLP qui n'existe pas encore.
5. **H1 : garder `Logger` NestJS + un `LoggerService` maison de redaction** — écarté : réinvente `pino.redact` (rapide, éprouvé, chemins de redaction déclaratifs) et `pino-http` (corrélation de requête). `nestjs-pino` est le standard de l'écosystème.

## Découpage en tâches bite-sized

### Groupe K1 — Documentation (aucun risque, valeur immédiate)
- [ ] [P] Tâche 1 : réécrire `README.md` — état réel (3 apps + `packages/db`), statut des 4 bounded contexts, setup dev (pnpm/turbo), variables d'env par service (renvoi vers `.env.example`), lancer les tests, lien vers `docs/architecture/` et `CONTRIBUTING.md`.
- [ ] [P] Tâche 2 : `docs/architecture/README.md` — diagramme C4 niveau 1 (contexte : PME, DAF, client, agent, partenaires APIP/Djomy/Moneroo ↔ facture.gn) et niveau 2 (conteneurs : `web`, `trust-api`, `money-api`, Postgres, [Redis/BullMQ à venir], providers) en ```mermaid```. Légende des flux internes (secret par flux : `MONEY_API_INTERNAL_KEY`, `DGI_VERIFICATION_INTERNAL_KEY`, …).
- [ ] [P] Tâche 3 : `CONTRIBUTING.md` — workflow (`dev-planner` → `PLAN.md` dans `docs/plans/AAAA-MM-JJ-*.md` → branche `feat|fix|refactor|chore/*` → `dev-tdd-enforcer` → 4 revues → merge `--no-ff` sur `master`), convention de commit (`test+feat(app,...): description (Story ID / §ref)`), pièges connus (après tout changement de `schema.prisma` : `db:generate` **puis** `build` ; enum Prisma non référencé = absent du client ; `as const` incompatible `WhereInput` ; migrations écrites à la main ; `invoice-numbering.service.integration.spec.ts` échoue toujours en local sans Postgres).

### Groupe C1 — Sécurité CI
- [ ] Tâche 4 : `.github/dependabot.yml` — écosystèmes `npm` (répertoire `/`, hebdo lundi, `groups` : `minor-and-patch` regroupés, majors séparés) et `github-actions` (hebdo). `open-pull-requests-limit: 5`.
- [ ] Tâche 5 : `ci.yml` — nouveau job `security` (parallèle à `build`, `needs: []`) : `pnpm install --frozen-lockfile` puis `pnpm audit --audit-level=high`. Si bruit sur une CVE transitive sans correctif : `pnpm.auditConfig.ignoreCves` dans `package.json` racine (documenté, jamais silencieux).
- [ ] Tâche 6 : `ci.yml` job `security` — ajouter `gitleaks/gitleaks-action@v2` (scan secrets, `GITLEAKS_ENABLE_SUMMARY`).
- [ ] Tâche 7 : `.github/workflows/codeql.yml` — CodeQL `javascript-typescript`, `push` sur `master` + `pull_request` + `schedule` hebdo. `security-and-quality` query suite.

### Groupe H1 — Logs structurés + redaction PII
- [ ] Tâche 8 : `apps/trust-api` + `apps/money-api` `package.json` — ajouter `nestjs-pino`, `pino`, `pino-http` ; `pino-pretty` en devDep.
- [ ] Tâche 9 : `apps/trust-api/src/common/logging.module.ts` — `LoggerModule.forRoot({ pinoHttp: { redact: { paths: [...], censor: "[redacted]" }, genReqId, transport: dev-only pino-pretty, autoLogging, customProps } })`. Chemins de redaction : `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.passwordHash`, `*.pin`, `*.pinHash`, `*.code`, `*.codeHash`, `*.secret`, `*.apiKey`, `*.keyHash`, `*.token`, `*.signature`, `*.encryptedPrivateKey`, `*.nif`, `*.bankAccountDetails`, `authorization`, `x-partner-key`, `x-partner-signature`, `x-internal-key`.
- [ ] Tâche 10 : idem `apps/money-api/src/common/logging.module.ts` (mêmes chemins + `x-webhook-*`).
- [ ] Tâche 11 : `main.ts` (les deux services) — `app.useLogger(app.get(Logger))` (Logger de `nestjs-pino`), `bufferLogs: true` dans `NestFactory.create`. Importer `LoggingModule` en tête de `AppModule` (avant tout autre).
- [ ] Tâche 12 : migrer les `new Logger(X.name)` existants (`grep` : `invoices.service.ts` + éventuels autres) vers l'injection `PinoLogger`/`Logger` de `nestjs-pino` si ≤ 5 occurrences ; sinon note de suivi dans le plan.

### Groupe B2 — ESLint strict
- [ ] Tâche 13 : mesurer — `eslint.config.js` temporaire avec `recommendedTypeChecked` + rules visées, `pnpm turbo lint` , compter les violations par règle. Consigner le résultat ici.
- [ ] Tâche 14 : `eslint.config.js` définitif — bloc type-checked (`languageOptions.parserOptions.projectService: true`, `tsconfigRootDir`), `@typescript-eslint/no-floating-promises: "error"`, `no-misused-promises: "error"`, `switch-exhaustiveness-check: "error"`, `require-await: "warn"`, `no-explicit-any: "warn"` ; override `**/*.spec.ts` : `no-explicit-any: "off"`, `no-unsafe-*: "off"`.
- [ ] Tâche 15 : corriger les violations `error` restantes (attendu faible ; si `no-floating-promises` en révèle beaucoup, c'est un signal — traiter au cas par cas, jamais un `// eslint-disable` de masse).

### Groupe B1 — Gate de couverture
- [ ] Tâche 16 : `@vitest/coverage-v8` en devDep de `trust-api`, `money-api`, `web`, `db`.
- [ ] Tâche 17 : mesurer — `vitest run --coverage` par package, consigner lines/functions/branches/statements ici.
- [ ] Tâche 18 : `apps/trust-api/vitest.config.ts` + `apps/money-api/vitest.config.ts` — `test.coverage` : `provider: "v8"`, `reporter: ["text", "json-summary", "lcov"]`, `exclude` (dto, `*.module.ts`, `main.ts`, `*.spec.ts`, generated), `thresholds` = valeur mesurée arrondie à l'entier inférieur, plancher 80. `apps/web/vitest.config.ts` : ajouter le même bloc.
- [ ] Tâche 19 : `test` script des packages → `vitest run --coverage`. `ci.yml` : `actions/upload-artifact` du `coverage/` (rétention 7 j).

## Tests à écrire AVANT le code
- [ ] `apps/trust-api/src/common/logging.module.spec.ts` : construire un `pino` avec la config de redaction ; loguer un objet contenant `{ password, pin, nif, authorization, headers:{authorization}, signature, totalTtc }` ; asserter que tous les champs sensibles listés sortent `"[redacted]"` et que les champs non sensibles (`totalTtc`, `invoiceId`) restent intacts.
- [ ] `apps/trust-api/src/common/logging.module.spec.ts` : `genReqId` réutilise l'en-tête `x-request-id` s'il est présent, en génère un (uuid) sinon.
- [ ] idem `apps/money-api/src/common/logging.module.spec.ts`.
- [ ] Pas de test unitaire pour K1/C1 (docs + YAML de CI) — validation : `README` relu, `dependabot.yml`/`codeql.yml` validés par le linter d'Actions (le premier run de CI sur la branche), diagramme Mermaid rendu.
- [ ] B1/B2 : la validation *est* la CI — `pnpm turbo lint` vert avec les nouvelles règles, `pnpm turbo test` vert avec `--coverage` au-dessus des seuils. Ajouter un test de non-régression uniquement si une correction de la Tâche 15 touche un comportement observable.

## Critères de done
- Aucun `[NEEDS CLARIFICATION: ...]` restant
- `pnpm turbo lint typecheck test` vert en local (hors `invoice-numbering.service.integration.spec.ts`, pré-existant)
- Nouvelle CI verte sur la branche : jobs `build` + `security` + `codeql` passent
- Redaction PII : le test de la Tâche « tests » prouve qu'aucun champ sensible listé ne sort en clair
- `README.md` ne contient plus d'affirmation fausse (vérifié ligne à ligne contre `apps/` et `.env.example`)
- Diagramme C4 rendu correctement (Mermaid valide)
- Seuils de couverture = mesure réelle, jamais au-dessus (documenté dans ce plan, Tâche 17)
- `dev-code-reviewer` OK
- `dev-security-reviewer` OK (revue ciblée : exhaustivité des chemins de redaction, pas de secret dans `dependabot.yml`/`codeql.yml`, `pnpm audit` réellement bloquant)
- `dev-resilience-reviewer` OK (H1 : le logger ne doit jamais faire planter une requête ; `autoLogging` et transport dev-only ne cassent pas la prod)

## Risques identifiés & mitigations
- **R1 — B1 casse la CI immédiatement** (couverture réelle < seuil) : mitigation : Tâche 17 mesure avant de figer ; seuil = `floor(mesure)` plancher 80, jamais l'inverse. Le plan documente la valeur.
- **R2 — B2 `no-floating-promises` révèle des dizaines de promesses non attendues** : mitigation : Tâche 13 mesure d'abord. Si volume élevé, c'est un *vrai* signal de fiabilité (webhooks best-effort, `InvoiceEvent` non commités — déjà des bugs de ce type dans l'historique) → traiter au cas par cas, pas de disable de masse. Si trop pour ce lot, `no-floating-promises` passe en `warn` + ticket de suivi dédié.
- **R3 — `nestjs-pino` change le format des logs et casse un test qui asserte sur la sortie console** : mitigation : `grep` des specs qui espionnent `console.*`/`Logger` avant d'installer ; `app.useLogger` n'affecte que le runtime, pas les tests unitaires (qui n'ont pas de vrai Nest bootstrap).
- **R4 — redaction incomplète : un champ sensible non listé fuite** : mitigation : la liste est dérivée du `schema.prisma` (tous les champs `*Hash`, `*Key`, `secret`, `pin`, `nif`, `signature`, `encryptedPrivateKey`, `bankAccountDetails`) + des en-têtes d'auth des `.env.example` ; test dédié ; `dev-security-reviewer` valide l'exhaustivité. Défaut de conception assumé : la redaction par *chemin* pino ne couvre pas un objet sensible loggé sous une clé inattendue — d'où la règle « ne jamais loguer un objet Prisma entier », à inscrire dans `CONTRIBUTING.md`.
- **R5 — `pnpm audit` bloquant rend la CI rouge sur une CVE transitive sans correctif disponible** : mitigation : `pnpm.auditConfig.ignoreCves` avec commentaire justificatif par CVE (même discipline que les `overrides` multer/lodash/js-yaml déjà en place). Jamais un `|| true` qui masque tout.
- **R6 — CodeQL/gitleaks : premier run trouve des secrets historiques dans les `.env.example`** : les valeurs sont des placeholders `EXAMPLE000…` (vérifié) — gitleaks configuré avec un `.gitleaksignore` pour ces chemins si faux positif, jamais un désarmement global.
- **R7 — Node 25 en local vs Node 20 en CI** : divergence de comportement possible des outils. Mitigation : toute mesure (couverture, lint) refaite/vérifiée par la CI (Node 20) avant merge, jamais figée sur la seule mesure locale.
