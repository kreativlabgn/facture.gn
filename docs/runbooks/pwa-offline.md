# Runbook — PWA offline-first (Phase 1, ADR-118)

Service worker de `apps/web` : App Shell + vérification de facture hors-ligne, en
**lecture seule**. Aucune mutation, aucun moteur de synchronisation dans cette
phase.

## Build

- `pnpm --filter @facture-gn/web build` → `next build --webpack` → génère
  `apps/web/public/sw.js` (+ `.map`). **Gitignorés** — jamais commités, jamais
  édités à la main.
- **Turbopack non supporté** par `@serwist/next` : le `--webpack` est
  obligatoire. Le `Dockerfile` de `apps/web` lance `pnpm build`, donc il en
  hérite. `next dev` peut rester sur Turbopack (SW désactivé en dev via
  `disable: NODE_ENV === "development"`).
- Source du SW : `apps/web/src/sw.ts`. Politique de cache partagée et testée :
  `apps/web/src/lib/offline-cache-policy.ts`.

## Ce qui est mis en cache

| Ressource | Stratégie | Cache | Expiration |
|---|---|---|---|
| `/_next/static/**` (JS, CSS, polices) | CacheFirst | `facturegn-shell-v1` | 48 h |
| Navigation vers `/`, `/login`, `/{certificationId}` | NetworkFirst (timeout réseau 3 s) | `facturegn-pages-v1` | 48 h, 60 entrées max |
| `offline.html`, `manifest.webmanifest` | Précache | (précache Serwist) | par révision de build |

## Ce qui n'est JAMAIS mis en cache

- `/dashboard/**`, `/cabinet/**` (routes authentifiées — données par utilisateur)
- `/pay/**` (lien de paiement vivant)
- `/api/**`, RSC (`RSC: 1`), `/_next/data/**`
- toute origine tierce
- le **code** des routes `dashboard` / `cabinet` (exclu du précache — récupéré à
  la demande à la navigation, puis mis en cache runtime uniquement si
  l'utilisateur s'y rend)

Filet : une règle `NetworkOnly` finale attrape tout ce qui n'a pas matché une
règle explicite. Invariant verrouillé par `offline-cache-policy.spec.ts` :
`isSensitiveRoute(p) ⟹ !isPubliclyCacheableNavigation(p)`.

## Comportement hors-ligne attendu

1. Une page de vérification **déjà consultée** (< 48 h) → servie depuis le cache.
2. Une page de vérification **jamais consultée** → `offline.html` (« Vous êtes
   hors connexion »).
3. `/dashboard`, `/pay` → échec réseau normal (jamais de version en cache).
4. Bannière `OfflineBanner` en tête de page dès que le navigateur signale
   `offline`.

## Inspecter / déboguer

- DevTools → **Application** → **Service Workers** : statut, `skipWaiting`,
  `Update on reload`.
- **Application → Cache Storage** : `facturegn-shell-v1`, `facturegn-pages-v1`,
  et le précache Serwist (`serwist-precache-*`).
- **Application → Manifest** : `id`, `scope`, `theme_color`. Pas d'icônes en
  Phase 1 (fast-follow) → l'installation propose une icône générée par défaut.

## Purger le cache d'un client

- Le SW se met à jour tout seul à chaque déploiement (`skipWaiting: true` +
  `clientsClaim: true` + `reloadOnOnline: true`) : le nouveau `sw.js` a un hash
  différent, l'ancien précache est nettoyé (`cleanupOutdatedCaches: true`).
- Purge forcée côté utilisateur : DevTools → Application → **Clear site data**.
- Purge programmée (incident) : bumper les noms de cache dans
  `offline-cache-policy.ts` (`facturegn-shell-v1` → `-v2`, idem pages) — l'ancien
  cache devient orphelin et est supprimé au prochain `activate`.

## Points de vigilance

- `sw.js` contient du code mort de `initializeGoogleAnalytics` (bundle Serwist).
  Non exécuté (`offlineAnalyticsConfig` non défini), aucune route GA/GTM
  enregistrée — vérifiable dans `sw.js` : la fonction n'est jamais appelée.
- Le tout premier chargement **hors-ligne** de `/` (jamais visitée en ligne
  auparavant) sert `offline.html` et non l'accueil : `/` n'est pas précaché en
  dur en Phase 1 (fast-follow).
- `next build --webpack` : surveiller les notes de version Next — si le mode
  webpack est retiré, basculer sur le configurator mode `@serwist/next/config`.
