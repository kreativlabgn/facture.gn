import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js régénère AGENTS.md/CLAUDE.md à chaque `next dev` sinon — bruit de
  // scaffold sans rapport avec ce repo, désactivé pour garder l'arborescence propre.
  agentRules: false,

  // Accès au serveur de dev depuis un autre appareil du réseau local (un
  // téléphone, pour juger la barre d'onglets et la bottom sheet sur un vrai
  // écran) : Next refuse sinon les requêtes cross-origin vers /_next/*.
  //
  // Piloté par DEV_ORIGIN plutôt qu'écrit en dur : une IP de réseau local ne
  // vaut que pour la machine qui l'a écrite, et n'a rien à faire dans le
  // dépôt. Vide par défaut — donc aucun effet pour qui ne la définit pas.
  //
  //   DEV_ORIGIN=192.168.1.154 pnpm --filter web dev
  //
  // Dev uniquement : Next ignore ce champ dans un build de production.
  allowedDevOrigins: process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : [],

  // Security Audit 2026-08-23, finding #15 — aucun header de sécurité HTTP
  // n'était configuré. X-Frame-Options: DENY sur toutes les routes : les pages
  // publiques /login, /pay/[invoiceId] et la vérification publique de facture
  // n'avaient aucune protection contre le clickjacking (iframe invisible sur un
  // formulaire de connexion ou de paiement). X-Content-Type-Options: nosniff en
  // complément (empêche un navigateur de deviner un type MIME dangereux).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

// PWA offline-first — Phase 1 (App Shell + vérification hors-ligne, ADR-118).
//
// `@serwist/next` compile `src/sw.ts` via son plugin webpack → `public/sw.js`
// (gitignoré). Il ne supporte PAS Turbopack : le script `build` de ce package
// force donc `next build --webpack` (voir package.json + docs/runbooks/pwa-offline.md).
// Désactivé en dev (`next dev` peut rester sur Turbopack, le SW n'y tourne pas).
const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // Le flux public de vérification est un chargement pleine page (scan QR / lien
  // SMS), pas une navigation `next/link` — inutile d'ajouter le surcoût réseau.
  cacheOnNavigation: false,
  reloadOnOnline: true,
  // Actif uniquement pour un vrai build de production (`next build --webpack`).
  // Désactivé en dev, en test et pendant `next typegen` (recommandation
  // @serwist/next pour un projet où le dev tourne sur Turbopack).
  disable: process.env.NODE_ENV !== "production",
  // `[/\.map$/, /^manifest.*\.js$/]` = défauts de @serwist/webpack-plugin (à
  // recopier, un `exclude` explicite les remplace). Ajout : ne PAS précharger le
  // code des routes hors du flux public de vérification (dashboard, cabinet,
  // paiement) — un visiteur qui vérifie un reçu sur une connexion mobile
  // guinéenne (DAT) ne doit pas les télécharger pour rien. Ces chunks sont
  // récupérés à la demande à la navigation, puis mis en cache par la règle
  // runtime `/_next/static/` si l'utilisateur s'y rend réellement.
  exclude: [/\.map$/, /^manifest.*\.js$/, /\/chunks\/app\/(dashboard|cabinet|pay)\//],
});

export default withSerwist(nextConfig);
