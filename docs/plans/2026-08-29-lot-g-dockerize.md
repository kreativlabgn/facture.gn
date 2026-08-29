# Plan : Lot G — Dockerisation des trois apps (Vague 2)

## Contexte projet
- Module : Platform Context (build & delivery ; aucun code métier touché)
- Persona affecté : équipe ops / plateforme (déploiement Kubernetes OVH Gravelines)
- Données sensibles manipulées : aucune dans le diff ; les images NE contiennent
  aucun `.env` (exclus via `.dockerignore`), les secrets sont injectés au runtime
- Impact réglementaire : aucun

## Clarifications
- Q: image « slim » (pnpm deploy / prune) ou « complète » ? → R: complète pour
  l'instant. `pnpm deploy --legacy` recrée `@facture-gn/db` en symlink vers la
  source (cassé hors monorepo) et ne rapatrie pas le client Prisma généré ;
  `inject-workspace-packages=true` change le workflow de dev ; `prune --prod`
  peut réhydrater un mauvais hash de store pour `@prisma/client`. Aucune de ces
  pistes n'est validable sans démon Docker local. Slimming = chantier ultérieur.
- Q: web en `output: standalone` ? → R: non. La trace NFT du middleware échoue de
  façon non déterministe (`middleware.js.nft.json` absent en fin de build,
  reproduit sous Windows). On sert via `next start`.
- Q: publier les images en CI ? → R: non. Le job `docker` build les 3 images
  (`push: false`) — seul moyen de vérifier les Dockerfiles sans Docker local.

## Problème
Aucune des trois apps n'est packagée : le déploiement k8s visé au DAT n'a pas
d'artefact. Il manque des images reproductibles, non-root, avec healthcheck, et
une CI qui casse si un Dockerfile régresse.

## Solution retenue
Un `Dockerfile` multi-stage par app (`base` → `deps` → `build` → `runner`),
buildé depuis la racine du monorepo. `deps` ne copie que les lockfiles +
`package.json` (couche cache). `build` fait `prisma generate` + build de
`packages/db` puis de l'app. `runner` = `node:20-slim`, `USER node`, `HEALTHCHECK`
sur `/health/live` (API) ou `/` (web). `docker-compose.yml` gagne un profil
`full` pour lancer les 3 images + infra. Job CI `docker` (matrice) qui build sans
push.

## Alternatives écartées
- **`pnpm deploy` / `prune --prod`** : voir Clarifications — cassent la
  résolution du client Prisma ou le lien workspace, non validables ici.
- **`output: standalone` (web)** : bug NFT middleware non déterministe.
- **Une seule image "monorepo"** : perd l'isolation par contexte borné et
  gonfle la surface de chaque déploiement.

## Découpage en tâches
- [x] `.dockerignore` (contexte de build minimal, exclut `.env`, specs, `V/`, `docs/`)
- [x] `apps/trust-api/Dockerfile`
- [x] `apps/money-api/Dockerfile`
- [x] `apps/web/Dockerfile`
- [x] `docker-compose.yml` : services `trust-api` / `money-api` / `web` sous `profiles: ["full"]`, `env_file` `required: false`
- [x] `.github/workflows/ci.yml` : job `docker` matriciel, `push: false`, cache gha

## Tests à écrire AVANT le code
Pas de test unitaire (aucun code applicatif). Vérifications :
- [x] `pnpm --filter @facture-gn/web run build` réussit sans `output: standalone`
- [x] `docker compose config` et `docker compose --profile full config` valides
- [ ] Job CI `docker` : build des 3 images vert (validation réelle, 1re exécution
      sur la PR — non reproductible en local faute de démon Docker)

## Critères de done
- `docker compose config` valide (les 2 profils)
- Job CI `docker` ajouté
- Aucun secret ni `.env` dans le contexte de build (vérifié via `.dockerignore`)
- Images non-root, avec healthcheck
- Revue 5 angles OK
- Mémoire mise à jour

## Risques identifiés & mitigations
- **Client Prisma absent au runtime** → mitigation : on embarque `node_modules`
  complet (pas de `deploy`/`prune`), donc le store généré par `prisma generate`
  est copié tel quel.
- **Build web échoue en CI comme en local** → mitigation : `output: standalone`
  retiré ; build validé en local (`next build` vert, 14/14 pages).
- **`next start` ne sait pas charger `next.config.ts`** → vérifié : Next 16
  transpile la config via son SWC bundlé (`transpile-config.js`), le paquet
  `typescript` n'est pas requis.
- **Job CI `docker` révèle un problème non anticipé** → assumé : c'est le rôle du
  job ; correctif en suivi avec le log d'erreur réel plutôt qu'à l'aveugle.
