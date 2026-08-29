// @ts-check
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/generated/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    // Vague 0 (B2) — règles type-checked ciblées. Mesure préalable (2026-08-29) :
    // no-floating-promises = 2 occurrences dans tout le monorepo (les deux
    // `bootstrap()` de main.ts), no-misused-promises = 0, no-explicit-any hors
    // specs = 1. Le coût (lint plus lent car type-aware) est justifié : plusieurs
    // bugs de l'historique étaient des promesses non attendues (InvoiceEvent non
    // committé, notification best-effort avalée).
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // src : `any` est un warning, pas une erreur (1 seule occurrence, dans
      // roles.guard.ts, laissée telle quelle — la retoucher toucherait un
      // fichier critique pour un gain nul). Les nouveaux `any` sont visibles
      // sans bloquer.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // considerDefaultExhaustiveForUnions : un `default:` compte comme un
      // traitement exhaustif (cf. provider-resolver.service.ts, orange_direct/
      // mtn_direct volontairement non branchés → default null). La garde
      // "cas oublié = never" de roles.guard.ts reste valide.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/require-await": "warn",
    },
  },
  {
    // Tests : `as any` est massivement utilisé pour les mocks Prisma/Nest
    // (~2600 occurrences). Les règles type-checked strictes sur les specs
    // n'ont aucun intérêt de fiabilité et bloqueraient tout.
    files: ["**/*.spec.ts", "**/*.test.ts", "**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
