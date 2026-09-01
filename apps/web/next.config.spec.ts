import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

// PWA offline-first (ADR-118) — `@serwist/next` enveloppe la config. Non-régression
// du finding sécurité #15 : les en-têtes anti-clickjacking / anti-sniff doivent
// survivre à l'enveloppe (Serwist ne fait que `{ ...nextConfig, webpack }`, mais
// on le verrouille ici).
describe("next.config (après enveloppe Serwist)", () => {
  it("conserve les en-têtes de sécurité X-Frame-Options / X-Content-Type-Options", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const rules = await nextConfig.headers!();
    const keys = rules.flatMap((rule) => rule.headers.map((h) => `${h.key}: ${h.value}`));
    expect(keys).toContain("X-Frame-Options: DENY");
    expect(keys).toContain("X-Content-Type-Options: nosniff");
  });

  it("n'active pas la génération de règles AGENTS.md/CLAUDE.md", () => {
    expect((nextConfig as { agentRules?: boolean }).agentRules).toBe(false);
  });
});
