# Runbook — Gestion des secrets (C5)

## Principe

Aucun secret réel dans le dépôt (garde CI : `gitleaks`). Les `.env.example`
contiennent des **gabarits** volontairement invalides (`EXAMPLE0000…`). Au
démarrage, `assertSecretsValid` (`apps/*/src/common/secrets.ts`, appelé dans
`main.ts` avant NestFactory) vérifie **tous** les secrets d'un coup :

- présence (selon `required` / `requiredInProduction`) ;
- format (hex 64, PEM, URL postgres/redis/http…) ;
- **détection de gabarit** — valeur type `.env.example`, caractères répétés,
  `changeme`, `placeholder`… → **erreur en production**, avertissement en dev.

Un démarrage avec un secret manquant ou factice échoue avec la liste complète
des problèmes.

## Inventaire

Source de vérité : la constante `TRUST_API_SECRETS` / `MONEY_API_SECRETS` dans
`apps/*/src/common/secrets.ts` (nom, obligatoire, format, usage). Ne pas
maintenir de seconde liste ici — s'y référer.

Familles :

| Famille | Secrets | Génération |
|---|---|---|
| Connexion données | `DATABASE_URL`, `REDIS_URL` | fournies par l'infra |
| JWT (ADR-011) | `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | paire RS256, voir README |
| Certification (ADR-026) | `CERTIFICATION_PRIVATE_KEY`, `CERTIFICATION_MASTER_KEY` | `openssl rand -hex 32` |
| Secrets inter-service | `MONEY_API_INTERNAL_KEY`, `DGI_VERIFICATION_INTERNAL_KEY`, `COMMERCIAL_AGENT_GRANT_INTERNAL_KEY`, `COMMISSION_BYPASS_REVIEW_INTERNAL_KEY`, `DATA_RIGHTS_INTERNAL_KEY`, `CREDITS_INTERNAL_KEY` | `openssl rand -hex 32`, **une valeur distincte par secret** |
| Webhooks partenaires | `APIP_WEBHOOK_SECRET`, `DJOMY_WEBHOOK_STUB_SECRET`, `MONEROO_WEBHOOK_STUB_SECRET` | `openssl rand -hex 32` |

`MONEY_API_INTERNAL_KEY` doit être **identique** entre trust-api et money-api
(secret partagé) — une seule génération.

Chaque clé `*_INTERNAL_KEY` a un garde qui **plante au démarrage** si la variable
manque (fail-fast voulu) : une clé oubliée dans l'outillage = un premier
déploiement qui ne démarre pas. La cohérence entre l'inventaire
(`apps/trust-api/src/common/secrets.ts`), `.env.example`, `fly.toml`,
`scripts/setup-staging-secrets.ps1` et ce tableau est **vérifiée par un test**
(`apps/trust-api/src/common/secrets-inventory.spec.ts`) : ajouter une clé
interne, c'est l'ajouter à ces cinq endroits.

## Cible : HashiCorp Vault (DAT §infra)

`assertSecretsValid` ne lit que `process.env` — l'intégration Vault se fait **en
amont** du process, sans toucher le code applicatif :

1. **Vault Agent injector** (sidecar Kubernetes) : le template Vault écrit les
   secrets dans un fichier `env` que l'entrypoint `source` avant de lancer
   `node dist/main.js`. Zéro SDK dans l'image.
2. ou **`vault agent` + `exec`** : `vault agent -config=… -exec "node dist/main.js"`
   injecte les variables et relance le process à la rotation.
3. ou, transition, **secrets Kubernetes** (chiffrés at-rest, `sealed-secrets` /
   SOPS) montés en variables d'environnement.

Politique Vault : un rôle par service (`trust-api`, `money-api`), lecture seule
sur son propre chemin (`secret/data/facture-gn/trust-api/*`).

## Rotation

| Secret | Procédure |
|---|---|
| `MONEY_API_INTERNAL_KEY` | supporter 2 valeurs le temps du rollout : accepter `ancienne` OU `nouvelle` dans les guards pendant une fenêtre, puis retirer l'ancienne. (Évolution du code des guards — non fait à ce jour, mono-valeur.) |
| `JWT_PRIVATE_KEY` | publier la nouvelle clé publique, signer avec la nouvelle privée, garder l'ancienne publique le temps d'expiration des tokens (TTL). |
| `CERTIFICATION_MASTER_KEY` | **délicat** — rechiffrer toutes les `OrganizationSigningKey.encryptedPrivateKey` (déchiffrer ancienne → chiffrer nouvelle) en une migration de données. Voir `envelope-encryption.ts`. |
| `CERTIFICATION_PRIVATE_KEY` (légataire) | **ne jamais faire tourner** — sert uniquement à vérifier des factures signées avant les clés par organisation (ADR-026). |
| Webhooks | régénérer + communiquer au partenaire, fenêtre de double-acceptation côté guard si le partenaire le permet. |

## Incident — secret potentiellement exposé

1. Révoquer / faire tourner immédiatement (voir table ci-dessus).
2. Pour un secret de signature : `POST /organizations/:id/signing-key/revoke`
   (A4, ADR-025) par organisation concernée.
3. Auditer les accès sur la fenêtre d'exposition (journaux + `audit-log`).
4. `gitleaks` sur l'historique complet pour confirmer que le secret n'a jamais
   été commité.
