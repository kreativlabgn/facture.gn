# Plan : Lot J — Validation des secrets au démarrage (C5, Vague 2)

## Contexte projet
- Module : Platform Context (config / sécurité) — trust-api + money-api
- Persona affecté : ops (déploiement) ; indirectement toutes les PME (un secret
  faible = compromission)
- Données sensibles : tous les secrets (JWT, clés Ed25519, secrets inter-service,
  webhooks partenaires)
- Impact réglementaire : Loi L/2016/037/AN, agrément PDP (posture secrets)

## Clarifications
- Q: intégrer un SDK Vault ? → R: non. `assertSecretsValid` ne lit que
  `process.env` ; l'injection Vault se fait en amont du process (Vault Agent
  sidecar / `vault agent -exec`), documentée dans le runbook. Zéro dépendance
  nouvelle.
- Q: où brancher la validation ? → R: dans `main.ts` (`bootstrap()`), fonction
  PURE hors du graphe DI → aucun impact sur `app.module.spec.ts` ni sur les
  ~1300 tests. La CI ne lance jamais `main.ts`.
- Q: strictness ? → R: gabarit (`EXAMPLE0000…`, caractères répétés, `changeme`)
  = **erreur en production**, avertissement en dev. Format toujours vérifié.
  `requiredInProduction` sans `required` = un fallback dev existe mais est
  inacceptable en prod.

## Problème
~14 fichiers lisent `process.env` ad hoc. Le fail-fast existant est dispersé
(un secret manquant à la fois) et ne détecte pas une valeur recopiée telle
quelle depuis `.env.example` : `MONEY_API_INTERNAL_KEY = "EXAMPLE0000…"` des deux
côtés « fonctionne » comme secret partagé — trivialement devinable.

## Solution retenue
`apps/{trust-api,money-api}/src/common/secrets.ts` (dupliqué, convention repo) :
- `SecretSpec` (name, required, requiredInProduction, format, purpose) ;
- `validateSecrets(env, specs, { production })` → `string[]` (tous les problèmes) ;
- `assertSecretsValid(...)` → lève une erreur agrégée pointant vers le runbook ;
- `TRUST_API_SECRETS` / `MONEY_API_SECRETS` = inventaire (source de vérité,
  reprise par le runbook).
Appelé en 1re ligne de `bootstrap()`. `docs/runbooks/secrets-management.md` :
inventaire par famille, cible Vault, rotation, incident.

## Alternatives écartées
- **Module NestJS `ConfigModule` + schéma Zod** : brancherait la validation dans
  le graphe DI → casse `app.module.spec.ts` (qui injecte des env factices).
- **SDK Vault dans l'image** : surface supply-chain + couplage ; l'injection
  amont (fichier env / exec) est le pattern k8s standard.
- **Détection de gabarit par comparaison au contenu de `.env.example`** : lecture
  de fichier au runtime, fragile ; un jeu de motifs (`EXAMPLE0+`, char répété,
  `changeme`) suffit.

## Découpage
- [x] `secrets.ts` (les 2) — validateur pur + specs
- [x] `main.ts` (les 2) — `assertSecretsValid(process.env, SPECS, { production })`
- [x] `secrets.spec.ts` (les 2)
- [x] `docs/runbooks/secrets-management.md`

## Tests AVANT le code
- [x] env complet bien formé → `[]`
- [x] secret requis manquant → problème
- [x] `requiredInProduction` : exigé seulement si `production`
- [x] gabarit : erreur en prod, avertissement (console.warn) en dev
- [x] gabarit à caractères répétés + littéral `example000…`
- [x] mauvais format (url, hex, pem) → problème
- [x] agrégation de plusieurs problèmes
- [x] `assertSecretsValid` lève avec la liste + pointe le runbook ; ne lève pas si OK

## Critères de done
- Tests verts (unit + suites complètes sans régression)
- `main.ts` hors couverture ; `secrets.ts` couvert
- lint + typecheck clean
- gitleaks OK (fixture PEM de test = `-----BEGIN TEST KEY-----`, jamais
  `PRIVATE KEY` → ne déclenche pas la règle `private-key`)
- Runbook écrit
- Mémoire à jour

## Risques & mitigations
- **Validation trop stricte casse `pnpm dev`** → gabarit = avertissement en dev,
  pas erreur ; seuls présence + format sont bloquants (déjà le cas via les
  fail-fast existants).
- **`app.module.spec.ts`** → non concerné (validation dans `main.ts`, jamais
  importé par les specs).
- **Faux positif gitleaks sur la fixture PEM** → header `TEST KEY`, pas
  `PRIVATE KEY`.
