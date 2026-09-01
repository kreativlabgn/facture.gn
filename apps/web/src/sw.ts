/// <reference lib="webworker" />
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

import {
  isPubliclyCacheableNavigation,
  OFFLINE_FALLBACK_PATH,
  OFFLINE_MAX_AGE_SECONDS,
  OFFLINE_PAGES_CACHE,
  OFFLINE_PAGES_MAX_ENTRIES,
  OFFLINE_SHELL_CACHE,
} from "@/lib/offline-cache-policy";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// PWA offline-first — Phase 1 (App Shell + vérification hors-ligne, ADR-118).
//
// Liste de stratégies VOLONTAIREMENT restrictive : on n'utilise PAS le
// `defaultCache` de `@serwist/next` — il met en cache TOUTES les navigations
// same-origin, y compris `/dashboard` authentifié (données par utilisateur) et
// `/pay` (lien de paiement vivant). Ici, seules les navigations publiques
// explicitement autorisées par `isPubliclyCacheableNavigation` entrent en cache,
// et un filet `NetworkOnly` final garantit que rien d'autre n'y arrive jamais.
const runtimeCaching: RuntimeCaching[] = [
  // 1. Assets immuables produits par le build (hashés) — aucune donnée sensible.
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: OFFLINE_SHELL_CACHE,
      plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: OFFLINE_MAX_AGE_SECONDS })],
    }),
  },
  // 2. Navigations PUBLIQUES uniquement : accueil, /login, page de vérification
  //    /{certificationId}. NetworkFirst → le réseau prime toujours s'il répond ;
  //    le cache ne sert que hors-ligne, expiré après 48 h.
  {
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin && request.mode === "navigate" && isPubliclyCacheableNavigation(url.pathname),
    handler: new NetworkFirst({
      cacheName: OFFLINE_PAGES_CACHE,
      networkTimeoutSeconds: 3,
      plugins: [
        new ExpirationPlugin({
          maxEntries: OFFLINE_PAGES_MAX_ENTRIES,
          maxAgeSeconds: OFFLINE_MAX_AGE_SECONDS,
        }),
      ],
    }),
  },
  // 3. Filet EXPLICITE — tout le reste (`/dashboard`, `/cabinet`, `/pay`,
  //    `/api`, RSC, `/_next/data`, cross-origin…) n'est JAMAIS mis en cache.
  {
    matcher: () => true,
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  // Page servie quand une navigation hors-ligne ne correspond à rien en cache.
  // `/~offline` est précachée (voir `additionalPrecacheEntries` dans next.config).
  fallbacks: {
    entries: [
      {
        url: OFFLINE_FALLBACK_PATH,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
