import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js régénère AGENTS.md/CLAUDE.md à chaque `next dev` sinon — bruit de
  // scaffold sans rapport avec ce repo, désactivé pour garder l'arborescence propre.
  agentRules: false,

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

export default nextConfig;
