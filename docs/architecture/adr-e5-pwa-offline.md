# ADR-118 (provisoire) — PWA offline-first, Phase 1 : App Shell + vérification hors-ligne

> **Provisoire** : rédigé dans `code/` car `V/Registre-ADR-facture-gn.md` est
> momentanément indisponible (migration de charte en cours dans un autre
> contexte). À porter tel quel dans `V/`, Partie 28+, quand `V/` est propre.
> Numéro **118** (113 = rétention, 114 = rotation de clé, 115 = ancrage Merkle,
> 116 = droits des personnes, 117 = rapprochement bancaire).

## Contexte

`apps/web` (Next.js 16, App Router) est aujourd'hui **100 % rendu serveur** :
chaque page est un Server Component qui `fetch` `trust-api` côté serveur
(`TRUST_API_URL` server-only), les mutations sont des Server Actions. Aucun
service worker, aucune couche data client, `manifest.webmanifest` minimal. La
cible DAT (« Frontend web : Offline-first, Workbox, App Shell » ; « Autonomie PWA
48h ») n'a **aucune fondation**.

Sur une connexion mobile guinéenne intermittente, un acheteur qui ouvre un lien
de vérification (`/[certificationId]`, public, sans auth) voit un onglet blanc ou
une erreur : rien n'est mis en cache, l'app ne s'ouvre même pas hors-ligne.

L'offline-first complet (émission de factures hors-ligne, file de synchronisation
CRDT « LWW par champ sauf montants append-only et statut monotone », 48 h
d'autonomie) est un chantier de plusieurs lots. Cet ADR ne couvre que la
**Phase 1**.

## Décision

### Périmètre Phase 1 — lecture seule

1. **Service worker Serwist** (`@serwist/next` + `serwist`) compilé à partir de
   `apps/web/src/sw.ts` vers `public/sw.js` (gitignoré). Enregistrement
   automatique (`register: true` par défaut de `@serwist/next`).
2. **Précache de l'App Shell** : assets `/_next/static/**` du build (JS, CSS,
   polices self-hostées par `next/font`), `manifest.webmanifest`, `offline.html`.
   **Exclus du précache** : le code des routes authentifiées
   (`/chunks/app/(dashboard|cabinet)/**`) — un visiteur qui ne fait que vérifier
   un reçu ne doit pas télécharger le dashboard sur une connexion coûteuse
   (récupéré à la demande à la navigation, puis mis en cache runtime).
3. **Cache runtime restrictif**, défini par une **fonction pure testée**
   `apps/web/src/lib/offline-cache-policy.ts` :
   - `/_next/static/**` → `CacheFirst` (assets immuables hashés).
   - Navigations vers `/`, `/login`, `/{certificationId}` → `NetworkFirst`
     (`networkTimeoutSeconds: 3`, expiration **48 h**, 60 entrées max).
   - **Tout le reste** (`/dashboard`, `/cabinet`, `/pay`, `/api`, RSC,
     `/_next/data`, cross-origin) → `NetworkOnly` explicite. Aucun catch-all
     `NetworkFirst` : rien n'entre en cache par accident.
4. **Fallback** : `offline.html` (fichier **100 % statique**, aucune dépendance
   JS ni police distante) servi quand une navigation hors-ligne ne correspond à
   rien en cache.
5. **`OfflineBanner`** (client, `useSyncExternalStore` sur `online`/`offline`,
   `getServerSnapshot` = « en ligne » → pas de mismatch d'hydratation) monté dans
   `layout.tsx`. `manifest.webmanifest` gagne `id` / `scope` / `description`.

### On n'utilise PAS `defaultCache` de `@serwist/next`

`defaultCache` met en cache **toutes** les navigations same-origin (règle
`PAGES_CACHE_NAME.html`), y compris `/dashboard` authentifié (données par
utilisateur) et `/pay` (lien de paiement vivant). Inacceptable. La liste de
stratégies est écrite à la main, restrictive, et son cœur (`isSensitiveRoute` /
`isPubliclyCacheableNavigation`) est verrouillé par
`offline-cache-policy.spec.ts` (invariant : une route sensible n'est jamais
cachable).

### `next build --webpack`

`@serwist/next` (mode webpack) **ne supporte pas Turbopack**, défaut de Next 16.
Le script `build` de `apps/web` force donc `next build --webpack` (option
documentée par l'avertissement de Serwist lui-même). `next dev` peut rester sur
Turbopack — le SW y est désactivé (`disable: NODE_ENV === "development"`).

## Alternatives écartées

- **`next-pwa`** — non maintenu pour l'App Router, incompatible Next 16.
- **Workbox « à la main » (`workbox-build` + `public/sw.js`)** — fidèle à la
  lettre de la DAT mais tout le glue-code (injection du manifeste de précache,
  versioning, `skipWaiting`) est à réécrire ; Serwist le fournit et reste du
  Workbox dessous.
- **Service worker vanilla sans lib** — zéro dépendance, mais stratégies de
  cache / expiration / nettoyage / invalidation au déploiement = un projet en soi
  pour un premier lot.
- **`StaleWhileRevalidate` sur la vérification** — sert d'abord une valeur
  potentiellement périmée (facture annulée affichée « valide »). `NetworkFirst`
  ne sert le cache que si le réseau échoue.
- **Mettre `/dashboard` en cache (lecture offline du tableau de bord)** — données
  par utilisateur, risque de fuite inter-session dans le cache partagé du SW,
  invalidation non triviale. Lot dédié.
- **Configurator mode `@serwist/next/config` (compatible Turbopack)** — ajoute
  `@serwist/cli` + une étape de build séparée. `next build --webpack` est moins
  invasif (un flag, aucune étape nouvelle).
- **Page fallback en Server Component réutilisant `SiteHeader`** — un fichier
  statique `public/offline.html` est plus robuste : aucun runtime React, aucune
  police à charger, précaché avec une révision calculée par le plugin.

## Conséquences

- Nouvelles dépendances : `serwist` (runtime SW) + `@serwist/next` (dev/build).
  Versions **épinglées**. `audit-ci` : la seule vulnérabilité introduite est
  `esbuild` **moderate** (serveur de dev esbuild, jamais lancé ici ; gate
  `moderate: false` → non bloquant).
- `apps/web` : `build` → `next build --webpack` ; `typecheck` → 2 passes
  (`tsconfig.json` + `tsconfig.sw.json`, le SW tourne en contexte WebWorker) ;
  `public/sw.js*` gitignorés et exclus d'ESLint.
- `TRUST_API_URL` reste server-only — le service worker ne `fetch` **jamais**
  `trust-api` directement.
- `sw.js` embarque du code mort de `initializeGoogleAnalytics` (Serwist) — non
  exécuté (`offlineAnalyticsConfig` non défini), aucune route GA/GTM enregistrée.

## Fast-follows (Phase 2+)

- **Icônes PWA + prompt d'installation** (nécessite des assets design).
- **Précache de `/` et `/login`** en dur (aujourd'hui : runtime `NetworkFirst`
  seulement — le tout premier chargement hors-ligne de la racine sert
  `offline.html`).
- **File d'émission de factures hors-ligne** (IndexedDB + `Idempotency-Key` +
  rejeu) — passera par son propre `dev-architect`.
- **Sync Engine CRDT** (LWW par champ, montants append-only, statut monotone) —
  le vrai morceau d'architecture Money Context.
- **Cache lecture du dashboard** — lot dédié, modèle d'isolation par session à
  concevoir.
- **`/pay/*` reste NON caché** — invariant permanent (lien de paiement vivant).
