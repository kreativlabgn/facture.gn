import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js régénère AGENTS.md/CLAUDE.md à chaque `next dev` sinon — bruit de
  // scaffold sans rapport avec ce repo, désactivé pour garder l'arborescence propre.
  agentRules: false,
};

export default nextConfig;
