# Plan : Lot F — Observabilité HTTP (health checks + métriques Prometheus)

## Contexte projet
- Module : transverse — `apps/trust-api` ET `apps/money-api`. Aucun bounded context métier, aucune migration.
- Persona : SRE / exploitation (future), Kubernetes (readiness), l'équipe qui mesure les SLO du DAT.
- Données sensibles : aucune. Les métriques n'exposent que des agrégats (compteurs, histogrammes de latence par route/statut) — jamais de payload, jamais d'identifiant.
- Impact réglementaire : indirect — mesurer la disponibilité 99,9 % et les P95 du DAT (< 200 ms API, < 180 ms orchestrateur) est un prérequis d'exploitation d'une infra de confiance et de l'agrément PDP.

## Périmètre (Vague 2, tranche 1)
Le DAT spécifie « OpenTelemetry → Prometheus + Grafana + Loki ». Lot F livre les **deux endpoints HTTP** dont k8s et Prometheus ont besoin immédiatement : `/health/*` et `/metrics`. Les **traces OpenTelemetry** (SDK + collecteur OTLP) sont une tranche suivante (elles demandent un collecteur déployé) — notées, non construites ici.

## Découpage

### Groupe 1 — Health checks (les 2 services)
- [ ] T1 : `src/health/redis-health.indicator.ts` (**money-api uniquement**) — indicateur terminus custom : `ping` sur la connexion ioredis de la file BullMQ (timeout court), `up`/`down`.
- [ ] T2 : `src/health/health.controller.ts` (les 2) :
  - `@Get("health/live")` `@Public()` — process vivant, aucun I/O (k8s livenessProbe : ne jamais redémarrer un pod juste parce que Postgres est lent).
  - `@Get("health/ready")` `@Public()` `@HealthCheck()` — `PrismaHealthIndicator.pingCheck("database", prisma)` ; money-api ajoute `RedisHealthIndicator`. (k8s readinessProbe : retirer du service si une dépendance est morte.)
- [ ] T3 : `src/health/health.module.ts` (les 2) — `TerminusModule` + le contrôleur (+ l'indicateur redis pour money-api).
- [ ] T4 : `app.module.ts` (les 2) — importe `HealthModule`.

### Groupe 2 — Métriques Prometheus (les 2 services)
- [ ] T5 : `src/metrics/metrics.controller.ts` (les 2) — `@Get("metrics")` `@Public()` → `register.metrics()` (texte Prometheus). Contrôleur explicite (pas celui par défaut de la lib) pour porter `@Public()` — sinon les guards globaux (JwtAuthGuard trust-api / RequireExplicitAuthGuard money-api) le bloquent, comme Swagger (Vague 0).
- [ ] T6 : `src/metrics/http-metrics.interceptor.ts` (les 2) — intercepteur **global** : histogramme `http_request_duration_seconds{method,route,status_code}` (buckets adaptés aux SLO : 0.05 / 0.1 / 0.2 / 0.3 / 0.5 / 1 / 2 / 5). `route` = le pattern (`/invoices/:id`), jamais l'URL concrète (cardinalité). Ignore `/metrics` et `/health*`.
- [ ] T7 : `src/metrics/metrics.module.ts` (les 2) — `PrometheusModule.register({ defaultMetrics: { enabled: true }, controller: MetricsController, pushgateway: undefined })` + `makeHistogramProvider` pour l'histogramme + l'intercepteur en `APP_INTERCEPTOR`. `customMetricPrefix` : `trust_api_` / `money_api_`.
- [ ] T8 : `app.module.ts` (les 2) — importe `MetricsModule`.
- [ ] T9 : **money-api** — `ReconciliationService` incrémente un compteur `money_api_reconciliation_runs_total` et un gauge `money_api_reconciliation_last_summary{outcome}` (via `@InjectMetric`). Petit, donne un signal métier réel sur le worker Lot E.

### Groupe 3 — Journalisation & doc
- [ ] T10 : `logging.config.ts` (les 2) — `autoLogging.ignore` gagne `/metrics` (health déjà exclu en Vague 0).
- [ ] T11 : `docs/slo.md` — les seuils du DAT §12 formalisés en SLO (objectif, fenêtre, requête PromQL de mesure à partir de `http_request_duration_seconds`). Table `dashboards benchmark` : dimension H passe de 2/10 à ~5/10.
- [ ] T12 : `README.md` — section « Observabilité » : `/health/live`, `/health/ready`, `/metrics`, à ne jamais exposer publiquement via l'ingress.

### Groupe 4 — Smoke & tests
- [ ] T13 : `health.controller.spec.ts` (les 2) — `live()` renvoie ok sans I/O ; `ready()` délègue au `HealthCheckService` avec les bons indicateurs.
- [ ] T14 : `redis-health.indicator.spec.ts` (money-api) — `up` si ping ok, `down` (HealthCheckError) si ping rejette/timeout.
- [ ] T15 : `http-metrics.interceptor.spec.ts` (les 2) — observe l'histogramme avec `{method, route, status_code}` corrects sur succès ET sur erreur (le `finalize`/`catchError` doit toujours enregistrer) ; ignore `/metrics` et `/health`.
- [ ] T16 : `metrics.controller.spec.ts` — renvoie du texte Prometheus (`# HELP`).
- [ ] T17 : `app.module.spec.ts` (les 2) — reste vert (nouveau graphe DI avec Terminus + Prometheus).

## Tests AVANT le code
Voir Groupe 4 — chaque fichier de test est écrit RED avant son implémentation.

## Critères de done
- `pnpm turbo lint typecheck test` vert (hors integration.spec) · `app.module.spec.ts` (les 2) vert
- `/health/live` répond 200 sans toucher Postgres/Redis (vérifié : aucun appel I/O dans le handler)
- `/health/ready` répond 503 si Postgres (ou Redis pour money-api) est down (indicateur testé)
- `/metrics` accessible **sans authentification** sur les 2 services (test contrôleur + `@Public()`)
- L'histogramme HTTP enregistre **aussi les requêtes en erreur** (5xx / exception) — testé
- `route` dans les labels = pattern, jamais l'URL concrète (cardinalité bornée) — testé
- `dev-code-reviewer` OK · `dev-security-reviewer` OK (nouvelle surface : 2 endpoints non authentifiés — vérifier qu'ils ne fuitent rien de sensible : pas de version de dépendance dans `/health`, pas de label à cardinalité non bornée, `/metrics` sans donnée métier identifiante)

## Risques & mitigations
- **R1 — `/metrics` ou `/health` bloqués par les guards globaux** : contrôleurs explicites avec `@Public()` (précédent Swagger, Vague 0). Testé.
- **R2 — cardinalité des métriques explose** (`route` = URL concrète avec des UUID) : l'intercepteur lit `context.getHandler()` / le pattern de route Nest (`request.route.path` ou les métadonnées du contrôleur), jamais `request.url`. Test dédié.
- **R3 — l'intercepteur n'enregistre pas les erreurs** (un `throw` court-circuite le `map`) : utiliser `tap({ next, error })` ou `finalize()` sur l'Observable — la mesure est prise dans les deux cas. Test dédié sur une exception.
- **R4 — `PrismaHealthIndicator` (terminus 11) attend un client Prisma précis** : injecter `PRISMA_CLIENT` (le token existant) ; si l'API terminus 11 diffère, écrire un `PrismaHealthIndicator` custom minimal (`SELECT 1`) — même approche que le `RedisHealthIndicator`.
- **R5 — `app.module.spec` (money-api) : Terminus/Prometheus tentent une connexion à la compilation** : Terminus n'ouvre rien à l'instanciation (les checks sont à la demande) ; Prometheus non plus (registre en mémoire). `lazyConnect` Redis (Lot E) déjà en place. Vérifié par le smoke.
- **R6 — duplication trust-api / money-api** : assumée (précédent `logging.config.ts`, `prisma.module.ts`, `app.module.spec.ts`). Les deux HealthModule diffèrent (money ajoute Redis), les MetricsModule diffèrent par le préfixe.

## Suite (hors Lot F)
Traces OpenTelemetry (`@opentelemetry/sdk-node` + auto-instrumentations + export OTLP) — demande un collecteur déployé. Dashboards Grafana + alerting. `/health/ready` étendu (money-api → trust-api joignable).
