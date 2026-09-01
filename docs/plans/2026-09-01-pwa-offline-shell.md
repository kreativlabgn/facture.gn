# Plan : PWA offline-first — Phase 1 (App Shell + vérification hors-ligne)

## Contexte projet
- **Module** : `apps/web` (Next.js 16, App Router). Aujourd'hui **100 % SSR** :
  chaque page est un Server Component qui `fetch` `trust-api` côté serveur
  (`TRUST_API_URL` server-only, jamais exposée au navigateur) ; les mutations
  sont des Server Actions. **Aucun** service worker, **aucune** couche data
  client, `manifest.webmanifest` minimal (pas d'icônes).
- **Persona affecté** : l'**acheteur / client** qui vérifie un reçu (`/[certificationId]`,
  public, sans auth) et le visiteur de la page d'accueil — souvent sur une
  connexion mobile guinéenne intermittente (DAT §Frontend « Offline-first,
  Workbox, App Shell » ; DAT §Objectifs « Autonomie PWA 48h »).
- **Données sensibles manipulées** : la page de vérification affiche des
  métadonnées de facture (numéro, montant TTC, NIF émetteur, statut d'intégrité)
  — **publiques par nature** (c'est le but de `/verify`). Le service worker ne
  doit **JAMAIS** mettre en cache une route authentifiée (`/dashboard/*`,
  `/cabinet/*`) ni la page de paiement (`/pay/*`, lien de paiement vivant).
- **Impact réglementaire** : aucun direct. Note LBC/FT indirecte — une
  vérification servie hors-ligne peut être **périmée** (facture entre-temps
  annulée / clé révoquée) : l'UI doit le dire, et le réseau doit toujours primer
  quand il est disponible.

## Clarifications
- Q (périmètre lot 1) → R : **App Shell + vérification offline en lecture seule**.
  Service worker + précache du shell + page fallback hors-ligne + bannière
  « hors connexion » + cache runtime de `/` et `/[certificationId]`. **Aucune
  mutation, aucun moteur de sync CRDT, aucun cache de `/dashboard`** — lots
  ultérieurs.
- Q (outillage SW) → R : **Serwist** (`@serwist/next` + `serwist`) — successeur
  maintenu de `next-pwa`, wrappe Workbox (cohérent DAT « Workbox »), support App
  Router de première classe. À passer au crible `audit-ci` (précédent : toute
  dépendance nouvelle est justifiée — cf. E1/OpenTimestamps abandonné).
- Q (cache des pages authentifiées) → R : **jamais**. Denylist stricte
  `/dashboard`, `/cabinet`, `/pay`, `/api`, `/_next/data` — testée par une
  fonction pure.
- Q (icônes PWA / installabilité) → R : **hors lot 1** (nécessite des assets
  design). Le lot ajoute `id` / `scope` / `description` au manifeste ; les
  icônes + le prompt d'installation sont un fast-follow.
- Q (fraîcheur de la vérification offline) → R : stratégie **NetworkFirst** (le
  réseau gagne toujours s'il répond) + expiration **48 h** + bannière indiquant
  que l'affichage peut dater. Aligné DAT (« vérification offline via verify-gn.js »)
  et sur `error.tsx` / `NotFound` déjà en place.

## Problème (3 lignes)
Un acheteur qui scanne / ouvre un lien de vérification dans une zone à réseau
intermittent voit un onglet blanc ou une erreur : la page est 100 % SSR, rien
n'est mis en cache, l'app ne s'ouvre même pas hors-ligne. La cible DAT
(« offline-first, 48 h, App Shell ») n'a aucune fondation.

## Solution retenue (5 lignes)
Introduire un **service worker Serwist** : (1) **précache** de l'App Shell (JS/CSS
du build, fonts, page d'accueil, page fallback `/~offline`) ; (2) **cache runtime
NetworkFirst** des navigations vers `/` et `/[certificationId]` (expiration 48 h,
~60 entrées max) ; (3) **exclusion stricte** de toute route sensible
(`/dashboard`, `/cabinet`, `/pay`, `/api`) via une **fonction pure testée**
`offlineCachePolicy` ; (4) une **bannière client** `OfflineBanner` (écoute
`online`/`offline`) et une **page fallback** `/~offline` cohérentes avec la
charte. Le moteur de sync CRDT et le cache du dashboard sont explicitement
différés.

## Alternatives écartées
- **`next-pwa`** — non maintenu pour l'App Router (dernier commit significatif
  mi-2023), incompatible Next 16. Serwist est son successeur désigné.
- **Workbox « à la main » (`workbox-build` + `public/sw.js`)** — fidèle à la
  lettre de la DAT mais tout le glue-code (injection du manifeste de précache au
  build, versioning, `skipWaiting`/`clientsClaim`) est à réécrire et à tester ;
  Serwist le fournit et reste du Workbox dessous.
- **Service worker vanilla sans lib** — zéro dépendance mais les stratégies de
  cache, l'expiration, le nettoyage des vieux caches et l'invalidation au déploiement
  sont un projet en soi, mal amorti pour un premier lot.
- **Cache runtime `StaleWhileRevalidate` sur la vérification** — écarté : sert
  d'abord une valeur potentiellement périmée (facture annulée affichée « valide »
  une fraction de seconde). `NetworkFirst` ne sert le cache que si le réseau
  échoue réellement.
- **Mettre en cache `/dashboard` en lecture (option 3 du brainstorm)** — écarté
  de ce lot : données par utilisateur, risque de fuite inter-session dans le
  cache partagé du SW, invalidation non triviale. Lot dédié.

## Découpage en tâches bite-sized

### Groupe A — Politique de cache pure (testable / livrable seule)
- [ ] [P] A1 : `apps/web/src/lib/offline-cache-policy.ts` :
  - `OFFLINE_SHELL_CACHE`, `OFFLINE_PAGES_CACHE`, `OFFLINE_PAGES_MAX_ENTRIES = 60`,
    `OFFLINE_MAX_AGE_SECONDS = 172_800` (48 h), `OFFLINE_FALLBACK_PATH = "/~offline"`.
  - `isPubliclyCacheableNavigation(pathname: string): boolean` — `true` pour `/`,
    `/login`, et la forme `/{certificationId}` (segment unique, pas un préfixe
    réservé). `false` sinon.
  - `isSensitiveRoute(pathname: string): boolean` — `true` pour tout ce qui
    commence par `/dashboard`, `/cabinet`, `/pay`, `/api`, `/_next/data`.
  - Invariant : `isSensitiveRoute(p) === true ⟹ isPubliclyCacheableNavigation(p) === false`
    (jamais les deux). Réservés connus (`RESERVED_TOP_SEGMENTS = ["dashboard",
    "cabinet", "pay", "login", "api", "_next", "manifest.webmanifest", "sw.js",
    "favicon.ico"]`) exclus de la forme `/{certificationId}`.
- [ ] [P] A2 : `apps/web/src/lib/offline-cache-policy.spec.ts` (voir « Tests »).

### Groupe B — Service worker Serwist (dépend de A)
- [ ] B1 : `pnpm --filter @facture-gn/web add serwist && pnpm --filter @facture-gn/web add -D @serwist/next` ;
  puis `pnpm audit --prod` + le `audit-ci` du repo → **zéro HIGH/CRITICAL**, sinon
  on s'arrête et on rouvre la question d'outillage.
- [ ] B2 : `apps/web/src/sw.ts` — entrée Serwist :
  - `import { defaultCache } from "@serwist/next/worker"` ; `Serwist({ precacheEntries: self.__SW_MANIFEST, skipWaiting: true, clientsClaim: true, navigationPreload: true })`.
  - `runtimeCaching` : règle `NetworkFirst` sur `({ request, url }) => request.mode === "navigate" && isPubliclyCacheableNavigation(url.pathname)` →
    cache `OFFLINE_PAGES_CACHE`, `ExpirationPlugin({ maxEntries: OFFLINE_PAGES_MAX_ENTRIES, maxAgeSeconds: OFFLINE_MAX_AGE_SECONDS })`,
    `networkTimeoutSeconds: 3`.
  - `fallbacks` : navigation non résolue (offline + non cachée) → `OFFLINE_FALLBACK_PATH`.
  - **Aucune** règle qui matche `isSensitiveRoute` — vérifié par revue + commentaire explicite.
- [ ] B3 : `apps/web/next.config.ts` — envelopper l'export dans
  `withSerwist({ swSrc: "src/sw.ts", swDest: "public/sw.js", cacheOnNavigation: true, reloadOnOnline: true, disable: process.env.NODE_ENV === "development" })`.
  **Conserver** `agentRules: false` et `async headers()` existants (X-Frame-Options,
  X-Content-Type-Options).
- [ ] B4 : `apps/web/tsconfig.sw.json` (ou `compilerOptions.lib` ciblé) —
  `lib: ["webworker", "esnext"]`, `types: ["@serwist/next/typings"]` pour `src/sw.ts`
  uniquement ; inclure dans le `tsc --noEmit` du projet sans casser le reste.
- [ ] B5 : `apps/web/.gitignore` — ajouter `public/sw*.js` et
  `public/swe-worker-*.js` (générés au build, jamais commités).

### Groupe C — App Shell offline UX
- [ ] [P] C1 : `apps/web/src/app/~offline/page.tsx` — page **statique** (pas de
  fetch), charte (`SiteHeader`, `rounded-2xl`, `font-display`), message « Vous
  êtes hors connexion. La dernière vérification consultée reste accessible ;
  reconnectez-vous pour une vérification à jour. » + lien `/`. `export const dynamic = "force-static"`.
- [ ] [P] C2 : `apps/web/src/components/OfflineBanner.tsx` — `"use client"`,
  `useSyncExternalStore` sur `navigator.onLine` + events `online`/`offline`,
  bannière discrète (bande `bg-navy-950/…`, texte court, `role="status"`,
  `aria-live="polite"`), rien à l'hydratation si en ligne. Aucune dépendance.
- [ ] C3 : `apps/web/src/app/layout.tsx` — monter `<OfflineBanner />` en tête de
  `<body>` (au-dessus de `{children}`), et ajouter le `<meta name="theme-color">`
  si absent. `@serwist/next` enregistre le SW automatiquement (`register: true`
  par défaut) — **pas** de composant d'enregistrement manuel sauf si vérifié
  nécessaire.
- [ ] C4 : `apps/web/public/manifest.webmanifest` — ajouter `"id": "/"`,
  `"scope": "/"`, `"description": "…"`. **Pas d'icônes** (fast-follow).

### Groupe D — Docs
- [ ] D1 : ce plan.
- [ ] D2 : `docs/architecture/adr-e5-pwa-offline.md` (**ADR-118 provisoire**, `V/`
  sale) : Serwist vs next-pwa/Workbox-main, périmètre lecture seule, routes
  sensibles jamais cachées, NetworkFirst + 48 h, sync CRDT + cache dashboard
  différés, fast-follows (icônes/install, précache de la police, `/pay` jamais).
- [ ] D3 : `docs/runbooks/pwa-offline.md` — noms de caches, ce qui est / n'est
  pas caché, comment inspecter le SW (DevTools → Application), comment forcer une
  purge (bump de version Serwist / `caches.delete`), comportement au déploiement
  (`skipWaiting`).
- [ ] D4 : `apps/web/README.md` — section « PWA / offline » (build génère
  `public/sw.js`, désactivé en dev).

## Tests à écrire AVANT le code

### Groupe A — `offline-cache-policy.spec.ts`
- [ ] `isPubliclyCacheableNavigation("/")` → `true` ; `"/login"` → `true`.
- [ ] `isPubliclyCacheableNavigation("/GN-12345678-2026-ABCDEF")` → `true`
  (forme identifiant de certification) ; avec query `?x=1` → `true`
  (le pathname seul compte).
- [ ] `isPubliclyCacheableNavigation("/dashboard")` / `"/dashboard/invoices/new"` /
  `"/cabinet/mandates"` / `"/pay/inv-1"` / `"/api/whatever"` → `false`.
- [ ] `isPubliclyCacheableNavigation("/GN-…/edit")` (segment multiple) → `false`.
- [ ] `isSensitiveRoute` : `true` pour `/dashboard*`, `/cabinet*`, `/pay*`,
  `/api*`, `/_next/data/…` ; `false` pour `/`, `/login`, `/{certificationId}`.
- [ ] **Invariant croisé** : pour un échantillon de chemins,
  `isSensitiveRoute(p) && isPubliclyCacheableNavigation(p)` n'est **jamais** vrai.
- [ ] `/manifest.webmanifest`, `/sw.js`, `/favicon.ico` → non traités comme un
  identifiant de certification (`isPubliclyCacheableNavigation` → `false`).

### Groupe B/C
- [ ] `next.config` : test d'intégrité (`apps/web/src/lib/next-config.spec.ts` ou
  équivalent) — l'objet config final expose toujours `headers` renvoyant
  `X-Frame-Options: DENY` + `X-Content-Type-Options: nosniff` après enveloppe
  Serwist (non-régression du finding sécurité #15).
- [ ] `pnpm --filter @facture-gn/web build` réussit et génère `public/sw.js`
  (vérif manuelle documentée dans le runbook + assert d'existence de fichier
  dans un test si praticable).
- [ ] `OfflineBanner` : rendu en `environment: "node"` limité — au minimum un
  test de la logique pure d'état si extraite (`isOnline()` initial). Composant
  visuel : couvert par la revue `dev-frontend-quality`, pas un test unitaire
  (cohérent avec l'absence de tests de composants dans `apps/web`).

## Critères de done
- Aucun `[NEEDS CLARIFICATION]` (aucun dans ce document).
- `pnpm --filter @facture-gn/web test` vert ; `typecheck` + `lint` propres
  (y compris `src/sw.ts`).
- `pnpm --filter @facture-gn/web build` réussit, `public/sw.js` généré et
  **gitignoré**.
- `audit-ci` / `pnpm audit` : zéro HIGH/CRITICAL introduit par Serwist.
- **Aucune route sensible cachable** — prouvé par `offline-cache-policy.spec.ts`
  et relu dans `sw.ts`.
- Aucune donnée sensible loggée ; aucun secret ; `TRUST_API_URL` toujours
  server-only (le SW ne fetch jamais `trust-api` directement).
- `next.config` conserve les headers de sécurité (test de non-régression).
- `dev-code-reviewer` OK ; `dev-frontend-quality` OK (UI : bannière + page
  offline) ; `dev-security-reviewer` OK (cache d'un contenu servi au public +
  denylist des routes authentifiées).
- `V/` non modifié (ADR-118 reste dans `code/docs/`).

## Risques identifiés & mitigations
- **R1 — le SW met en cache une page authentifiée `/dashboard` → données d'un
  utilisateur servies à un autre / après déconnexion.** → `isSensitiveRoute`
  testé, denylist stricte dans `sw.ts`, `NetworkFirst` uniquement sur la
  allowlist publique, aucune règle runtime générique « toutes les navigations ».
- **R2 — vérification périmée servie hors-ligne (facture annulée affichée
  « valide »).** → `NetworkFirst` (réseau prioritaire), expiration 48 h,
  `OfflineBanner` + texte de `/~offline` avertissent que l'affichage peut dater.
  Comportement déjà admis par la DAT pour la vérification offline.
- **R3 — `next build` casse en CI / Docker (Serwist au build).** → `disable` en
  dev, build testé localement + le `Dockerfile` `apps/web` (Lot G) rejoué ;
  `public/sw.js` gitignoré donc jamais de conflit de fichier généré.
- **R4 — surface d'attaque supply-chain (nouvelles dépendances).** → `audit-ci`
  obligatoire, versions **épinglées** (pas de `^`), périmètre Serwist =
  build-time + runtime SW connu, ADR-118 justifie le choix.
- **R5 — SW « collant » : ancien App Shell servi après un déploiement.** →
  `skipWaiting: true` + `clientsClaim: true` + `reloadOnOnline: true` ;
  documenté dans le runbook (purge manuelle = bump de révision Serwist).
- **R6 — `/~offline` ou l'App Shell référence une police Google non précachée →
  fallback moche hors-ligne.** → inclure les fonts `next/font` dans le précache
  (elles sont self-hostées par `next/font/google` dans `/_next/static`, donc
  capturées par `self.__SW_MANIFEST`) ; vérifié en test manuel offline, noté au
  runbook.
- **R7 — double montage / hydration mismatch de `OfflineBanner`.** →
  `useSyncExternalStore` avec un `getServerSnapshot` renvoyant « en ligne »
  (pas de bannière au SSR), pas de lecture de `navigator` au module scope.

## Séquence de revue
Groupes A→D livrés puis : `dev-code-reviewer` + `dev-security-reviewer`
(sous-agent — mise en cache de contenu public + denylist authentifiée) +
`dev-frontend-quality` (sous-agent — `OfflineBanner`, `/~offline`, cohérence
charte) en parallèle. `dev-architect` **non requis** : pas de nouvelle brique
back-end, périmètre volontairement réduit à l'App Shell ; le vrai morceau
d'architecture (Sync Engine CRDT) fera l'objet de son propre `dev-architect` au
lot suivant. `dev-domain-model-reviewer` non requis (aucun type de domaine
introduit — que des constantes de cache et des prédicats de route).
