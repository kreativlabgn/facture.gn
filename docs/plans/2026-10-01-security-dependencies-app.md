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
      93,38 % de couverture), `turbo build` (4/4), **démarrage réel des 3 services rejoué** le
      02/10/2026 sur `.env` copiés depuis le clone principal, DB/Redis partagés
      (`facturegn-postgres-1`/`facturegn-redis-1`) : `trust-api` `/health/live` et `/health/ready`
      → 200 ; `web` (Next.js 16.3.6) → 200 sur `/`, titre correct ; `money-api` DB `up`, `/health/
      ready` → 503 sur la sonde Redis (`Cannot read properties of undefined (reading 'ping')`) —
      **bug préexistant sur `app`, identique au fichier du clone principal, déjà diagnostiqué et
      corrigé dans la PR #29 (non fusionnée)** : pas une régression de ce correctif.

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

---

## Compléments du 2026-10-15 — la PR ne passerait toujours pas la CI

Revérification complète de la branche le 2026-10-15 (Node 22, Postgres 16, Redis 7, checkout
vierge, étapes de `ci.yml` dans l'ordre). Le code de la PR est sain, mais trois jobs
resteraient rouges ; aucun des trois n'est causé par la PR.

### Constats (mesurés avant tout changement)
1. **`audit-ci` de nouveau rouge — 6 avis publiés après la PR** (18/09 → 07/10) :

   | Avis | Gravité | Paquet (version) | Chemin | Exposition en exécution |
   |---|---|---|---|---|
   | GHSA-cjq9-62q9-8jv4 — SSRF dans l'optimisation d'images | haute | `next` 16.3.6 → corrigé en 16.3.8 | `apps/web > next` | oui — l'optimiseur d'images de Next est actif par défaut (`next.config.ts` ne le désactive pas) |
   | GHSA-jqcg-44mw-7w3h — usurpation d'IP via un sous-réseau de confiance IPv4 mappé IPv6 | critique | `proxy-addr` 2.0.7 → 2.0.8 | `@nestjs/platform-express > express` | non atteignable aujourd'hui (aucun `trust proxy` configuré), mais Express est le serveur HTTP des deux API |
   | GHSA-68fv-2mgg-jv7q — déni de service par offsets de sections | haute | `source-map-js` 1.2.1 → 1.2.2 | `@nestjs/cli > webpack > … > postcss`, `@vitest/coverage-v8 > magicast` | non — outillage de build et de test |
   | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr — pollution de prototype menant à une exécution de code | critique ×2 | `tinypool` 1.1.1 — **corrigé seulement en 2.1.2** | `vitest > tinypool` | non — pool de workers du lanceur de tests |
   | GHSA-vfj7-8cjw-p6xm — épuisement de pile par motifs imbriqués | haute | `braces` 3.0.3 — **aucune version corrigée** | `@nestjs/cli > chokidar > braces` | non — surveillance de fichiers de `nest start --watch` |

2. **`typecheck` rouge sur un checkout vierge** (donc en CI) : 14 × TS2307 « Cannot find module
   '@facture-gn/db' » dans `money-api` et `trust-api`. La PR #17 a fait dépendre `lint` et
   `typecheck` de `^typecheck` au lieu de `^build` ; or `@facture-gn/db` n'expose que `dist/`
   (`main`/`types`), qui n'existe qu'après son build. En local le défaut est invisible dès qu'un
   `dist/` traîne d'un build précédent. Reproduit à l'identique sur `app` (`9afdbe3`). Le lint,
   lui, passe sans `dist/` mais **change de résultat** : 42 avertissements sans, 5 avec (37
   `require-await` et apparentés parasites, sur des types non résolus) — un lint type-checked
   doit voir les vrais types.

3. **gitleaks rouge sur l'historique complet** : 1 alerte `generic-api-key`, valeur de test
   `OCR_STT_TOKEN` de `apps/trust-api/src/common/secrets.spec.ts` (ligne 146) introduite par
   `781688d` (branche de la PR #28) et remplacée par `deadbeef…` dans `6efccbf`. La valeur
   n'apparaît dans aucun autre fichier ni commit (`git log --all -S`). Comme `ci.yml` récupère
   l'historique complet (`fetch-depth: 0`, toutes les branches), cette alerte rend le job
   `security` rouge **sur toutes les PR**, et le restera dans l'historique d'`app` une fois la #28
   fusionnée. Les deux commits propres à cette PR sont sains.

### Clarifications
- Q : pourquoi des exceptions pour `tinypool` et `braces` plutôt qu'une correction ? →
  R : `braces` n'a **aucune** version corrigée publiée. `tinypool` n'est corrigé qu'en 2.x,
  alors que vitest 2.1.9 déclare `tinypool ^1` : forcer une majeure sous vitest, c'est changer
  le moteur d'exécution des tests sans garantie de compatibilité — même raisonnement que
  « Monter vitest en 3.x » ci-dessus. La montée de vitest reste le vrai correctif (chantier à
  part). Les deux paquets sont **présents sur disque** dans les images de production (le
  Dockerfile copie tout `node_modules`, l'allègement étant reporté) mais **jamais chargés** :
  les services démarrent par `node dist/main.js`, qui n'importe ni vitest ni `@nestjs/cli`.
- Q : `next` passe de 16.3.6 à 16.3.8 — même convention ? → R : oui : épinglage exact dans
  `apps/web/package.json` (avec `eslint-config-next`), surcharge en caret (`^16.3.8`).
- Q : les surcharges restent-elles dupliquées dans `package.json` et `pnpm-workspace.yaml` ? →
  R : oui, pour rester textuellement identiques à la PR #28 sur les lignes existantes ; les
  nouvelles lignes sont ajoutées aux deux endroits.
- Q : pourquoi `.gitleaksignore` plutôt que l'`[allowlist]` de `.gitleaks.toml` ? → R : une
  entrée `commits` dans l'allowlist globale exempterait **tout** le commit `781688d` (des
  dizaines de fichiers) ; l'empreinte `.gitleaksignore` (commit, fichier, règle, ligne) n'exempte
  que cette alerte. gitleaks la lit à la racine par défaut, sans changer `ci.yml`.

### Solution retenue
4. `apps/web/package.json` : `next` et `eslint-config-next` 16.3.6 → 16.3.8 ; surcharge
   `next@<16.3.8: ^16.3.8`.
5. Surcharges `proxy-addr@<2.0.8: ^2.0.8` et `source-map-js@>=1.0.0 <1.2.2: ^1.2.2` (caret :
   même ligne majeure), dans `pnpm-workspace.yaml` et `package.json`.
6. `.audit-ci.jsonc` : exceptions justifiées pour GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr
   (`tinypool`) et GHSA-vfj7-8cjw-p6xm (`braces`).
7. `turbo.json` : `lint` et `typecheck` dépendent de `^build`. Coût réel : `apps/web` n'a
   aucune dépendance interne (rien à construire) ; pour les API, seul `@facture-gn/db` est
   construit (`tsc`, quelques secondes, mis en cache par turbo).
8. `.gitleaksignore` : l'empreinte de l'alerte de `781688d`, commentée.
9. `pnpm-lock.yaml` régénéré, puis vérifié en mode gelé.

### Alternatives écartées
- **Surcharger `tinypool` en `^2.1.2`** : écarté — majeure imposée sous vitest 2.1.9 (voir
  clarifications).
- **Ajouter une étape `pnpm --filter db build` dans `ci.yml`** : écarté — la CI passerait mais
  `pnpm turbo typecheck` resterait faux pour tout contributeur sur un clone neuf ; c'est le
  graphe de tâches qui est faux, pas la CI.
- **Réécrire l'historique pour retirer la valeur de test** : écarté — branches partagées, et la
  valeur est un jeton de test factice.

### Découpage
- [x] Tâche 4 : ce complément de plan
- [x] Tâche 5 : versions et surcharges (`apps/web/package.json`, `package.json`,
      `pnpm-workspace.yaml`), exceptions `.audit-ci.jsonc`, lockfile régénéré — le lockfile
      ne change que `next` (et `@next/*`), `eslint-config-next`, `proxy-addr`, `source-map-js` ;
      `audit-ci` : « Passed pnpm security audit »
- [x] Tâche 6 : `turbo.json` — `turbo typecheck` vert après `rm -rf packages/db/dist` (5/5,
      0 × TS2307) ; lint identique avec ou sans `dist/` préexistant (0 erreur, 5 avertissements)
- [x] Tâche 7 : `.gitleaksignore` (le fichier existait déjà, même format) — `gitleaks git .`
      sur l'historique complet : 493 commits, aucune alerte
- [x] Tâche 8 (découverte en revalidation) : `moneroo-stub.provider.spec.ts` a échoué une fois
      (« expected 29 to be greater than or equal to 30 ») sur 6 passes complètes de `turbo test`
      le 2026-10-15, sans rapport avec cette PR. C'est le jumeau du test Djomy déjà stabilisé par
      la PR #21 (477e302) : le test exige un écart `Date.now()` d'au moins le délai exact, ce que
      Node ne garantit pas (non reproduit isolément : 0/25 sous charge CPU). Même correctif que
      la #21 — délai simulé 50 ms, assertion ≥ 40 ms ; le test échoue toujours si le stub ne
      temporise pas. Aucun test désactivé.
- [ ] Tâche 9 : revalidation complète sur checkout vierge (voir ci-dessous)

### Tests (rouge puis vert)
- ROUGE mesuré le 2026-10-15 : `audit-ci` (6 avis non tolérés) ; `pnpm turbo typecheck` sur
  checkout vierge (14 × TS2307) ; `gitleaks git .` sur l'historique complet (1 alerte).
- VERT attendu : les trois passent ; puis les étapes de `ci.yml` dans l'ordre sur une base vierge
  (`db:generate`, `db:migrate:deploy`, `turbo lint`, `turbo typecheck`, `turbo test`), `turbo
  build`, specs d'intégration de `trust-api` contre Postgres, démarrage réel des 3 services.

### Critères de done
- `audit-ci`, gitleaks (historique complet) et `pnpm install --frozen-lockfile` verts.
- Les étapes de `ci.yml` passent **dans l'ordre sur un checkout sans `packages/db/dist`**.
- Lint identique avec ou sans `dist/` préexistant.
- `next build` vert en 16.3.8 ; web, trust-api et money-api démarrent et répondent.

### Risques et limites
- Risque : `next` 16.3.6 → 16.3.8 (patch) — même mitigation que ci-dessus (build, 427 tests web,
  démarrage réel).
- Risque : `proxy-addr` 2.0.8 sous Express — correctif de niveau patch ; mitigation : suites
  money-api et trust-api, démarrage réel des deux API.
- Limite : les exceptions `tinypool` et `braces` restent des dettes ; à lever avec la montée de
  vitest et une version corrigée de `braces`.
