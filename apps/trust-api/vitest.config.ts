import { defineConfig } from "vitest/config";

// Vague 0 (B1) — gate de couverture. Seuils = mesure du 2026-08-29 arrondie à
// l'entier inférieur puis abaissée de ~1 point (ratchet-floor, jamais une cible
// à atteindre) : la CI casse sur une RÉGRESSION de couverture, pas sur du code
// non encore testé. À remonter dans les vagues suivantes.
//
// Mesure locale (hors invoice-numbering.service.integration.spec.ts qui exige un
// vrai Postgres, absent en local mais présent en CI — la couverture CI est donc
// ≥ cette mesure) : statements 80.8 · branches 93.4 · functions 88.1 · lines 80.8
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.spec.ts",
        "src/**/*.integration.spec.ts",
        "src/**/dto/**",
        "src/**/*.module.ts",
        "src/**/*.interface.ts",
        "src/**/*.tokens.ts",
        "src/**/*.decorator.ts",
        "src/main.ts",
        "src/scripts/**",
      ],
      thresholds: {
        statements: 79,
        branches: 90,
        functions: 85,
        lines: 79,
      },
    },
  },
});
