import { defineConfig } from "vitest/config";

// Vague 0 (B1) — voir apps/trust-api/vitest.config.ts pour la logique de seuil
// (ratchet-floor, jamais une cible).
//
// Mesure locale du 2026-08-29 (avec les exclusions ci-dessous, logging.config
// inclus) : statements 95.8 · branches 94.9 · functions 81.0 · lines 95.8
// (branches < 95 à cause des branches env-only de logging.config — transport /
// niveau de log de prod, non testables utilement)
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/dto/**",
        "src/**/*.module.ts",
        "src/**/*.interface.ts",
        "src/**/*.tokens.ts",
        "src/**/*.decorator.ts",
        "src/main.ts",
      ],
      thresholds: {
        statements: 92,
        branches: 90,
        functions: 80,
        lines: 92,
      },
    },
  },
});
