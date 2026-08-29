# SLO — facture.gn

Objectifs de niveau de service, dérivés des exigences non-fonctionnelles du
`../V/DAT-facture-gn.md` §12. Mesurés à partir des métriques exposées par
`/metrics` (Lot F) : `trust_api_http_request_duration_seconds` /
`money_api_http_request_duration_seconds` (histogrammes) et les métriques
Node par défaut.

Un SLO n'existe que s'il est **mesuré** et qu'un **error budget** est suivi. Ce
document est le point de départ ; les dashboards Grafana et l'alerting sont une
tranche suivante.

## SLO

| # | Service Level Objective | Cible | Fenêtre | Source (DAT) |
|---|---|---|---|---|
| 1 | Disponibilité de l'API trust-api (requêtes non-5xx) | ≥ 99,9 % | 30 j glissants | §12 Disponibilité mensuelle |
| 2 | Latence P95 des requêtes API (hors upload PDF, hors USSD) | < 200 ms | 7 j glissants | §12 API P95 Conakry |
| 3 | Latence P95 de l'orchestrateur de paiement (money-api) | < 180 ms | 7 j glissants | §12 / ADR-073 |
| 4 | Émission de facture (`POST /invoices/:id/issue`) P95 | < 2 s | 7 j glissants | §12 Émission facture |
| 5 | Génération de lien de paiement P95 | < 3 s | 7 j glissants | §12 |

> USSD (< 90 s) est un objectif de **session** de bout en bout côté passerelle
> opérateur, non mesurable par une seule requête HTTP — suivi séparé.

## Requêtes de mesure (PromQL)

**SLO 1 — disponibilité (taux d'erreur)**
```promql
1 - (
  sum(rate(trust_api_http_request_duration_seconds_count{status_code=~"5.."}[30d]))
  /
  sum(rate(trust_api_http_request_duration_seconds_count[30d]))
)
```

**SLO 2 — latence P95 API**
```promql
histogram_quantile(0.95,
  sum by (le) (rate(trust_api_http_request_duration_seconds_bucket{route!~"/metrics|/health.*"}[7d]))
)
```

**SLO 3 — latence P95 orchestrateur**
```promql
histogram_quantile(0.95,
  sum by (le) (rate(money_api_http_request_duration_seconds_bucket{route="/payment-links"}[7d]))
)
```

**SLO 4 — émission facture P95**
```promql
histogram_quantile(0.95,
  sum by (le) (rate(trust_api_http_request_duration_seconds_bucket{route="/invoices/:id/issue"}[7d]))
)
```

## Error budget

- SLO 1 (99,9 % / 30 j) → budget d'indisponibilité ≈ **43 min / mois**.
- Règle : si le budget du mois est consommé, priorité à la stabilisation avant
  toute nouvelle fonctionnalité.

## Santé (Kubernetes)

| Endpoint | Rôle | Vérifie |
|---|---|---|
| `GET /health/live` | livenessProbe — ne jamais tuer un pod pour une dépendance lente | le process répond (aucun I/O) |
| `GET /health/ready` | readinessProbe — retirer du service si une dépendance dure est morte | trust-api : Postgres · money-api : Postgres + Redis |

`/health/*` et `/metrics` sont **internes au cluster** — jamais exposés par
l'ingress public.

## Traces distribuées (Lot H)

OpenTelemetry, **opt-in**. Activation via l'environnement :

| Variable | Rôle |
|---|---|
| `OTEL_TRACES_ENABLED` | `true` requis (avec un endpoint) pour instrumenter quoi que ce soit |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | collecteur OTLP/HTTP — le path `/v1/traces` est ajouté |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | override spécifique traces (utilisé tel quel) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `clé1=valeur1,clé2=valeur2` (auth collecteur) |
| `OTEL_TRACES_SAMPLER_ARG` | ratio racine `[0..1]`, défaut `1` — `ParentBasedSampler` |

Instrumentation : HTTP (client + serveur), Express, NestJS, ioredis, pino
(corrélation `trace_id` dans les logs). La propagation W3C `traceparent` fait
suivre la trace de trust-api → money-api → provider sans configuration.

Sécurité : un `RedactingSpanProcessor` efface les attributs sensibles
(`Authorization`, `db.statement`, `*pin*`, `*nif*`, `*signature*`, query strings
d'URL) **avant** l'export — même discipline que la redaction pino.

Robustesse : `BatchSpanProcessor` (export hors chemin critique), init en
try/catch — un collecteur injoignable ne bloque jamais le démarrage ni une
requête. Désactivé (défaut) = zéro surcoût, aucun module patché.

**Non couvert** : spans Prisma (le client DB) — `@prisma/instrumentation` est
bloqué en `5.22.0`, trop en retard sur l'écosystème OTel installé ; à ajouter
lors d'une montée de version de Prisma.

## Reste à faire (hors Lots F/H)

- Collecteur OTLP déployé (Tempo/Jaeger) + validation bout-en-bout des traces.
- Dashboards Grafana + règles d'alerte Prometheus (burn-rate d'error budget).
- Métriques métier : worker de réconciliation (Lot E), file d'attente BullMQ
  (jobs en attente / échoués), certification (signatures/s).
- Sonde `/health/ready` money-api → joignabilité de trust-api.
