import { afterEach, describe, expect, it, vi } from "vitest";

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

// DEV_ORIGIN — l'origine autorisée en dev a d'abord été écrite en dur (l'IP de
// réseau local d'un poste). Ces deux cas empêchent qu'elle y revienne : le
// défaut doit rester vide, et la variable doit être réellement lue.
describe("next.config — allowedDevOrigins", () => {
  const original = process.env.DEV_ORIGIN;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DEV_ORIGIN;
    } else {
      process.env.DEV_ORIGIN = original;
    }
    vi.resetModules();
  });

  async function loadAllowedDevOrigins(): Promise<unknown> {
    vi.resetModules();
    const loaded = (await import("./next.config")).default;
    return (loaded as { allowedDevOrigins?: unknown }).allowedDevOrigins;
  }

  it("vide sans DEV_ORIGIN — aucune IP de poste dans le dépôt", async () => {
    delete process.env.DEV_ORIGIN;
    expect(await loadAllowedDevOrigins()).toEqual([]);
  });

  it("reprend DEV_ORIGIN quand elle est définie", async () => {
    process.env.DEV_ORIGIN = "192.168.1.154";
    expect(await loadAllowedDevOrigins()).toEqual(["192.168.1.154"]);
  });
});
