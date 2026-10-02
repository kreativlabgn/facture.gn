# Plan : correctif de sécurité des dépendances sur `app` (Next.js critique, multer, sharp, outillage)

## Contexte projet
- Module : chaîne d'approvisionnement — `package.json` racine, `pnpm-workspace.yaml`,
  `apps/web/package.json`, `pnpm-lock.yaml`
- Persona : toute l'équipe ; CI (job `security`) ; futur déploiement de `apps/web` et des API
- Données sensibles : aucune manipulée ; il s'agit de la surface d'attaque des dépendances
- Impact réglementaire : Loi L/2016/037/AN — mesures de sécurité raisonnables sur un service
  qui traitera des données personnelles (MSISDN, NIF)

## Contexte
Mesuré le 2026-10-01 sur `app` (`9afdbe3`) : `pnpm exec audit-ci --config .audit-ci.jsonc`
échoue sur **12 avis non tolérés** ; au total 28 avis de gravité critique ou haute
(`pnpm audit`). Les non tolérés, par famille :

| Famille | Avis | Chemin | Exposition en exécution |
|---|---|---|---|
| **Next.js** (critique) | GHSA-vcvr-r3jv-pc5j (RCE dans `next/og`), GHSA-2xp9-vwfh-vxw4, GHSA-p293-qw3h-jr36 | `apps/web > next` (16.3.0) | oui — framework du web |
| sharp | GHSA-rgj7-g3m4-5g8c | `next > sharp` | oui — via Next |
| multer | GHSA-535w-7cp7-47q4, GHSA-qfvm-cv95-jqjf, GHSA-wc9g-mqfw-jrwm | `money-api > @nestjs/platform-express` | non aujourd'hui (aucun endpoint d'upload) |
| `@grpc/grpc-js` | GHSA-m9gg-hp2v-232j | `money-api > @nestjs/terminus` | transitif |
| brace-expansion, fast-uri, js-yaml | GHSA-6j4f…, GHSA-qhr7…, GHSA-qw65…, GHSA-2883… | eslint, typescript-eslint, `@nestjs/cli` | non — outillage de build et de lint |

Les correctifs existent déjà dans la PR #28 (Phases 4 & 5, commits `5c0a5ec` et `6efccbf`) mais
cette PR est volumineuse et ouverte ; en attendant, la branche par défaut reste vulnérable et son
audit rouge. On les **isole** ici, vers `app`.

## Clarifications
- Q : pourquoi ne pas simplement faire un cherry-pick de `5c0a5ec` / `6efccbf` ? → R : `5c0a5ec`
  embarque aussi deux documents de la Phase 4/5 sans rapport, et les deux commits touchent un
  `pnpm-lock.yaml` qui diverge de celui de `app` : le lockfile est donc **régénéré** ici, pas
  copié.
- Q : même contenu de configuration que la #28 ? → R : **oui, volontairement à l'identique**
  (bloc `overrides` de `pnpm-workspace.yaml` et de `package.json`, versions de `next` et
  `eslint-config-next`). Git traite des modifications identiques des deux côtés comme sans
  conflit : seul le lockfile devra être régénéré au moment de fusionner `app` dans la #28.
- Q : les avis `vitest` (critique), `vite`, `nanoid`, `glob`, `picomatch`, `browserslist`, `tmp`
  restent-ils ? → R : oui. Ils sont **déjà tolérés et justifiés** dans `.audit-ci.jsonc` (outils de
  développement, mode UI de vitest jamais lancé) ; les lever demanderait des montées de version
  majeures (vitest 2 → 3), hors périmètre d'un correctif de sécurité.
- Q : `next` en caret ou exact ? → R : `apps/web/package.json` garde l'épinglage **exact** de la
  convention (`16.3.6`) ; l'override est en caret (`^16.3.6`) pour rester sur la ligne 16.x.

## Problème (3 lignes)
La branche par défaut embarque un framework web avec une exécution de code à distance
documentée (même si `next/og` n'est pas utilisé), et son audit de dépendances est rouge, donc
la CI de sécurité — quand elle tournera — bloquera toute PR. Le correctif existe mais est
prisonnier d'une PR de 18 commits.

## Solution retenue
1. `apps/web/package.json` : `next` et `eslint-config-next` 16.3.0 → 16.3.6 (même ligne de
   version, correctif de niveau patch).
2. `pnpm-workspace.yaml` et `package.json` : surcharges `multer`, `lodash`, `js-yaml`, `next`,
   `sharp`, `brace-expansion` (une par ligne majeure), `fast-uri`, `@grpc/grpc-js`, avec
   commentaire de justification — texte identique à la PR #28.
3. `pnpm-lock.yaml` régénéré (`pnpm install --no-frozen-lockfile`), puis vérifié en mode gelé.

## Alternatives écartées
- **Attendre la fusion de la PR #28** : écarté — délai indéterminé (revue de 18 commits, deux
  décisions de conception ouvertes) pour un correctif de sécurité de niveau patch.
- **Tolérer les avis dans `.audit-ci.jsonc`** : écarté pour Next et sharp (exposition en
  exécution) ; les tolérances du dépôt sont réservées à l'outillage de développement.
- **Monter vitest en 3.x pour lever l'avis critique d'outillage** : écarté ici (changement
  majeur de l'outil de test, risque de régression sans rapport avec ce correctif).
- **Un `>=` sans borne pour `next`** : écarté — risque de sauter à une version majeure ; caret.

## Découpage
- [x] Tâche 1 : `apps/web/package.json`, `package.json`, `pnpm-workspace.yaml`
- [x] Tâche 2 : `pnpm-lock.yaml` régénéré ; `pnpm install --frozen-lockfile` cohérent
- [x] Tâche 3 : revalidation — audit-ci (vert), `turbo lint typecheck test` (13/13, trust-api
      93,38 % de couverture), `turbo build` (4/4). Démarrage réel non rejoué dans ce worktree
      (pas de `.env` local) — couvert par le smoke test DI `app.module.spec.ts` et par `next
      build` ; à confirmer en conditions réelles avant fusion si jugé nécessaire.

## Tests (critère « rouge puis vert »)
- ROUGE (mesuré avant tout changement) : `audit-ci` échoue sur 12 avis non tolérés.
- VERT attendu : `audit-ci` passe ; aucune régression de `turbo lint typecheck test` ni du
  `next build` ; la page d'accueil du web et `/health/ready` des deux API répondent.

## Critères de done
- `audit-ci` passe sur la branche ; `pnpm install --frozen-lockfile` est cohérent.
- `turbo lint typecheck test` verts, `next build` vert, trois services démarrent.
- Texte de configuration identique à la PR #28 (vérifié par diff) hors lockfile.
- Aucun avis critique ou haut d'exécution ne subsiste hors outillage déjà toléré.

## Risques et limites
- Risque 1 : `next` 16.3.0 → 16.3.6 peut changer un comportement de rendu ou de build.
  Mitigation : `next build`, suite de tests web (427), démarrage réel et requête sur une page.
- Risque 2 : conflit de lockfile à la fusion avec la #28. Mitigation : prévu, résolu par
  régénération (`pnpm install`) ; le reste de la configuration est identique donc sans conflit.
- Limite : de nouveaux avis peuvent être publiés à tout moment ; ce correctif lève ceux connus
  le 2026-10-01. Le job `security` de la CI (dès qu'elle tourne) et Dependabot prennent le relais.
