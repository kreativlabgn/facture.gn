# Plan : Lot H — Traces OpenTelemetry (Vague 2)

## Contexte projet
- Module : Platform Context (observabilité) — trust-api + money-api
- Persona affecté : équipe ops / SRE
- Données sensibles manipulées : les attributs de span NE DOIVENT PAS porter
  PIN / NIF / signatures / tokens / en-têtes d'auth (même discipline que la
  redaction pino, Vague 0)
- Impact réglementaire : aucun

## Clarifications
- Q: `@opentelemetry/auto-instrumentations-node` (méga-paquet, ~40 instrus) ou
  jeu ciblé ? → R: jeu ciblé (http, express, nestjs-core, ioredis, pino) +
  `@prisma/instrumentation` — surface supply-chain réduite.
- Q: activé par défaut ? → R: non. `OTEL_TRACES_ENABLED=true` **et**
  `OTEL_EXPORTER_OTLP_ENDPOINT` requis, sinon no-op total (aucun exporter, aucun
  patch). Un endpoint injoignable ne doit jamais bloquer le boot ni le runtime.
- Q: tracing Prisma ? → R: **écarté de ce lot**. `@prisma/instrumentation` est
  bloqué à `5.22.0` (lockstep Prisma) — 2 majeures derrière l'écosystème OTel
  2.x installé ici, et exige un `previewFeatures`. HTTP + nest + express +
  ioredis donnent déjà la trace bout-en-bout inter-services. Les spans DB
  suivront quand Prisma sera monté de version. Noté dans « Reste ».
- Non vérifiable en local (pas de collecteur OTLP) — validation réelle reportée
  à un environnement avec collecteur. Décision utilisateur : on assume.

## Problème
Lot F a ajouté métriques + logs structurés, mais aucune trace distribuée. On ne
peut pas suivre une requête à travers trust-api → money-api → provider (bascule
Djomy/Moneroo, webhook → confirm). DAT §12 exige OpenTelemetry.

## Solution retenue
Un module `src/observability/` par app (convention repo : pas de package partagé
pour du code d'app). `buildTracingConfig(env, serviceName)` pur → `{enabled,
endpoint, headers, serviceName}` ou `{enabled:false}`. `startTracing(serviceName)`
construit un `NodeSDK` (exporter OTLP/HTTP, `BatchSpanProcessor`, resource
`service.name`), l'enveloppe dans un `SpanProcessor` de redaction qui supprime
les attributs sensibles, `.start()`, hook `SIGTERM`/`beforeExit` → `shutdown()`.
Tout en try/catch : ne lève jamais. `main.ts` importe le bootstrap en 2e ligne
(après `reflect-metadata`, avant `AppModule`) pour que les patchs
d'instrumentation précèdent le chargement d'express/nest.

## Alternatives écartées
- **`auto-instrumentations-node`** : trop de surface, patche des libs absentes.
- **`--require` via NODE_OPTIONS dans le Dockerfile** : découple mais rend
  l'activation invisible depuis le code ; `import` en tête de `main.ts` suffit
  pour http/express/nest/prisma (chargés via AppModule, donc après).
- **Sampling adaptatif** : `ParentBasedSampler(TraceIdRatioBased)` piloté par
  `OTEL_TRACES_SAMPLER_ARG` (défaut 1.0) — pas de logique custom.

## Découpage en tâches
- [ ] deps : `@opentelemetry/{sdk-node,resources,semantic-conventions,exporter-trace-otlp-http,instrumentation-http,instrumentation-express,instrumentation-nestjs-core,instrumentation-ioredis,instrumentation-pino}` + `@prisma/instrumentation` dans les 2 apps
- [ ] `packages/db/prisma/schema.prisma` : `previewFeatures = ["tracing"]` + `db:generate` + `build`
- [ ] `src/observability/tracing-config.ts` (les 2) — `buildTracingConfig` pur
- [ ] `src/observability/redacting-span-processor.ts` (les 2) — supprime attributs sensibles
- [ ] `src/observability/tracing.ts` (les 2) — `startTracing()` / `stopTracing()`
- [ ] `main.ts` (les 2) — `import "./observability/tracing";` + `startTracing("<service>")` avant `NestFactory`
- [ ] `.env.example` (les 2) — variables OTEL_*
- [ ] `docs/slo.md` ou `README` — section traces + variables
- [ ] recalibrage seuils couverture si nécessaire

## Tests à écrire AVANT le code
- [ ] `buildTracingConfig` : `{enabled:false}` si flag absent ; `{enabled:false}` si endpoint absent ; `{enabled:true, endpoint, serviceName}` si les deux ; parse `OTEL_EXPORTER_OTLP_HEADERS="k1=v1,k2=v2"` → objet ; ratio de sampling par défaut 1
- [ ] `RedactingSpanProcessor` : un span avec attribut `db.statement` contenant un PIN / `http.request.header.authorization` / `pin` / `nif` → valeur remplacée par `[redacted]` ; attribut anodin (`http.method`) conservé ; délègue `onStart`/`onEnd`/`forceFlush`/`shutdown` au processor enveloppé
- [ ] `startTracing` : retourne `null` si désactivé, ne patche rien ; ne lève pas si l'endpoint est syntaxiquement invalide
- [ ] smoke DI (`app.module.spec`) toujours vert avec l'import tracing en tête de main (main n'est pas importé par le spec — vérifier juste non-régression)

## Critères de done
- Tests verts (unit + smoke DI les 2 apps)
- `startTracing` no-op vérifié quand désactivé (défaut CI)
- Aucun attribut sensible dans les spans (test dédié)
- lint + typecheck clean
- audit-ci OK (10 nouveaux paquets `@opentelemetry/*` — tous first-party OTel)
- Revue 5 angles + sécurité OK
- Mémoire à jour

## Risques identifiés & mitigations
- **Instrumentation patche trop tard** (après chargement d'express) → mitigation :
  import en 2e ligne de `main.ts`, avant `AppModule` ; les specs vitest
  n'importent jamais `main.ts` donc pas d'effet de bord en test.
- **Endpoint OTLP injoignable** → `BatchSpanProcessor` bufferise et jette
  silencieusement après échec ; `startTracing` en try/catch ; jamais dans le
  chemin de réponse HTTP.
- **`previewFeatures = ["tracing"]` change le client Prisma** → additif (aucune
  API retirée) ; `db:generate` + `build` refaits ; suite trust-api complète
  re-vérifiée.
- **Fuite PII via `db.statement`** (Prisma met les requêtes paramétrées, pas les
  valeurs, mais prudence) → `RedactingSpanProcessor` + `OTEL_*` désactivé par
  défaut.
- **Surcoût perf** → `BatchSpanProcessor` (export hors chemin critique) +
  sampling configurable ; désactivé = zéro surcoût.
