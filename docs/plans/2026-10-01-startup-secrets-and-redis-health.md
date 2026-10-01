# Plan : démarrage de trust-api (`CREDITS_INTERNAL_KEY`) et sonde Redis de money-api (`/health/ready`)

## Contexte projet
- Module : Platform Context — `apps/trust-api` (secrets, déploiement), `apps/money-api` (observabilité)
- Persona : ops / développeur qui démarre ou déploie le projet pour la première fois (staging Fly, démo)
- Données sensibles : secrets inter-services (jamais loggés ; aucun secret réel dans le dépôt)
- Impact réglementaire : aucun direct ; la sonde de disponibilité conditionne la bascule de trafic

## Contexte
Deux défauts constatés le 2026-10-01 lors d'une installation locale complète, tous deux
confirmés dans le code de `app` :

**1. `CREDITS_INTERNAL_KEY` n'est déclarée nulle part où un opérateur la chercherait.**
`CreditsInternalAuthGuard` lève une exception dans son constructeur si la variable manque
(fail-fast voulu, identique aux cinq autres gardes de clé interne) : trust-api ne démarre
pas. Or la clé est déclarée dans `common/secrets.ts` (`requiredInProduction: true`) mais
**absente** de `apps/trust-api/.env.example`, de `scripts/setup-staging-secrets.ps1`, de
`apps/trust-api/fly.toml` (liste des secrets) et de `docs/runbooks/secrets-management.md` —
alors que les cinq autres clés internes y figurent toutes. Conséquence : un premier
déploiement suivant les outils du dépôt démarre un trust-api qui plante au boot. Le README
annonce « 5 secrets inter-services » : il y en a 6.

**2. `GET /health/ready` de money-api renvoie 503 même quand Redis est sain.**
`RedisHealthIndicator` lit `queue.client`, propriété retirée de BullMQ 6 : le client brut est
désormais `queue.backend.connection.client`. Le code passait par un double cast
`as unknown as QueueWithClient` — qui désactive le compilateur — et son spec fabrique un faux
`{ client: Promise.resolve(…) }` : ni `tsc` ni les tests n'ont vu la régression. Le `fly.toml`
de money-api ne sonde que `/health/live` et renvoie la vérification de `/health/ready` à un
contrôle manuel post-déploiement ; la sonde de disponibilité visée par le DAT (readinessProbe
k8s) et ce contrôle manuel sont, eux, faux.

## Clarifications
- Q : faut-il rendre le démarrage de trust-api tolérant à l'absence de la clé (dégradation) ?
  → R : **non**. Le fail-fast est la convention du dépôt (CLAUDE.md : « un secret manquant fait
  échouer le démarrage ») et la clé « crée de la valeur monétaire » (commentaire du garde). On
  corrige la **documentation et l'outillage**, pas le garde.
- Q : `secrets.ts` dit `required: false` pour ces clés alors que les gardes plantent au boot ?
  → R : incohérence **systémique** (les six clés), hors périmètre ; consignée comme point ouvert
  dans la PR. Seule `CREDITS_INTERNAL_KEY` provoque un échec, parce qu'elle est la seule absente
  de `.env.example`.
- Q : le même défaut existe-t-il côté trust-api ? → R : non, trust-api n'a pas d'indicateur Redis.
- Q : base de la branche ? → R : `app` (code cible), indépendante de la PR #28 (Phase 4/5).

## Problème (3 lignes)
Un déploiement ou une installation neuve plante au démarrage de trust-api sans que rien ne
l'annonce, et la sonde de disponibilité de money-api ment. Les deux régressions sont passées
inaperçues parce que **rien ne vérifie la cohérence** entre l'inventaire des secrets et
l'outillage, ni la forme réelle de l'API BullMQ.

## Solution retenue
1. **Documenter et outiller `CREDITS_INTERNAL_KEY`** : `.env.example` (placeholder `EXAMPLE0…`
   + commentaire de périmètre de confiance), `setup-staging-secrets.ps1` (`New-HexSecret`),
   `fly.toml` trust-api, runbook `secrets-management.md`, README (6 secrets).
2. **Garde de cohérence (test)** : toute clé `*_INTERNAL_KEY` déclarée dans `TRUST_API_SECRETS`
   doit figurer dans `.env.example`, `fly.toml` et `setup-staging-secrets.ps1`. Échoue avec le nom
   de la clé et du fichier manquants : l'oubli de ce type ne peut plus se reproduire.
3. **Sonde Redis** : accès **typé** `(queue.backend as RedisQueueBackend).connection.client`
   (plus de cast `as unknown as`) — un futur changement de BullMQ casse `tsc`, pas la production.
   Le délai de 2 s couvre désormais **l'obtention du client ET le PING** (aujourd'hui, `await
   client` est hors délai : Redis injoignable au démarrage ferait pendre `/health/ready`).
4. **Tests contre la forme réelle de BullMQ** : le spec unitaire utilise la forme
   `backend.connection.client` ; un test d'intégration (Redis réel, gate par sonde comme les
   specs Postgres) instancie une vraie `Queue` et vérifie `up` ; et `down` + borné dans le temps
   pour un Redis injoignable.

## Alternatives écartées
- **Rendre `CreditsInternalAuthGuard` tolérant** : écarté, voir Clarifications.
- **Passer `required: true` pour les six clés internes dans `secrets.ts`** : écarté ici — changer
  la sémantique de `validateSecrets` pour tout l'inventaire dépasse ce correctif ; point ouvert.
- **Vérifier Redis par `queue.waitUntilReady()`** : écarté — résout immédiatement une fois la
  connexion établie, donc n'attraperait pas une panne ultérieure ; un vrai PING est nécessaire.
- **Nouvelle connexion ioredis dédiée au health check** : écarté (déjà écarté par le Lot F :
  une seule connexion, celle de la file).
- **Supprimer la sonde Redis de `/health/ready`** : écarté — Redis est une dépendance dure de
  money-api (`RECONCILIATION_ENABLED`, `MONEY_API_SECRETS.REDIS_URL requiredInProduction`).

## Découpage
- [ ] Tâche 1 : `apps/trust-api/src/common/secrets-inventory.spec.ts` (RED) → `.env.example`,
      `setup-staging-secrets.ps1`, `fly.toml`, runbook, README (GREEN)
- [ ] Tâche 2 : `apps/money-api/src/health/redis-health.indicator.spec.ts` (forme réelle, délai
      élargi — RED) + `redis-health.indicator.integration.spec.ts` (RED) →
      `redis-health.indicator.ts` (GREEN)
- [ ] Tâche 3 : revalidation — lint, typecheck, tests (avec Redis et Postgres joignables),
      démarrage réel de trust-api et de money-api, `GET /health/ready` sur Redis sain puis coupé

## Tests à écrire AVANT le code
- Test 1 (cohérence) : pour chaque `*_INTERNAL_KEY` de `TRUST_API_SECRETS` : présente dans
  `.env.example`, dans `fly.toml`, dans `setup-staging-secrets.ps1`.
- Test 2 (sonde, unitaire) : `up` quand le PING de `backend.connection.client` répond ; `down`
  quand il rejette ; `down` quand il dépasse le délai ; **`down` quand l'obtention du client ne se
  résout jamais** (couverture du trou actuel).
- Test 3 (sonde, intégration Redis réel) : une vraie `Queue` BullMQ + `RedisHealthIndicator` →
  `up` ; une `Queue` pointée sur un port fermé → `down` en moins de ~3 s.

## Critères de done
- Tests 1 à 3 rouges avant le code, verts après.
- `GET /health/ready` de money-api renvoie 200 sur Redis sain et 503 sur Redis coupé, mesuré sur
  les services réellement démarrés.
- trust-api démarre avec un `.env` copié de `.env.example` sans erreur de secret manquant.
- lint, typecheck, suites trust-api et money-api vertes (intégration incluse, base et Redis
  joignables) ; audit-ci, gitleaks propres.

## Risques et limites
- Risque 1 : `RedisQueueBackend` est un type de BullMQ 6 ; une future version pourrait le
  renommer. Mitigation voulue : le build casse (c'est le but du typage), et le test d'intégration
  le confirme en CI quand elle fonctionnera.
- Risque 2 : le test de cohérence lit des fichiers du dépôt (`fs`) : il suppose leur emplacement.
  Mitigation : chemins relatifs à la racine du dépôt, message d'échec explicite.
- Limite : le test d'intégration Redis ne tourne que si `REDIS_URL` est joignable (comme les specs
  Postgres) ; il s'exécutera en CI (service `redis:7` déjà déclaré) dès que la CI fonctionnera.
