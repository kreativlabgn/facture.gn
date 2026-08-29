import { defineConfig } from "vitest/config";

// Vague 0 (B1) — gate de couverture. Seuils = mesure du 2026-08-29 arrondie à
// l'entier inférieur puis abaissée de ~1 point (ratchet-floor, jamais une cible
// à atteindre) : la CI casse sur une RÉGRESSION de couverture, pas sur du code
// non encore testé. À remonter dans les vagues suivantes.
//
// Mesure locale (hors invoice-numbering.service.integration.spec.ts qui exige un
// vrai Postgres — la couverture CI est ≥ cette mesure). Le smoke test
// app.module.spec.ts compile tout l'AppModule : il instancie chaque provider
// (les statements montent à ~92 %) et fait apparaître dans le rapport toutes les
// fonctions de tous les fichiers, y compris non testées (functions ~81 %). Ne
// jamais supprimer ce spec pour "remonter" la couverture de fonctions — c'est
// la seule garde contre un graphe DI cassé.
// Mesure du 2026-08-29 : statements 92.5 · branches 94.2 · functions 81.4 · lines 92.5
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
        statements: 90,
        branches: 92,
        functions: 79,
        lines: 90,
      },
    },
  },
});
