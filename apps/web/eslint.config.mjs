import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Design System facture.gn — garde-fous au lint (complète
  // src/design-system.guardrails.spec.ts, qui couvre aussi les cas hors JSX).
  // Cible les valeurs littérales dans `className="…"` / `className={`…`}`.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(?:bg|text|border|ring|from|via|to)-gradient|(?:linear|radial|conic)-gradient\\(|-\\[#[0-9a-fA-F]{3,8}\\]/]",
          message:
            "Design System : dégradé (R-01) ou couleur hex arbitraire interdits en className. Utiliser un token (globals.css @theme : navy-*, or, good, bad, grey, surface…).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.cooked=/(?:bg|text|border|ring|from|via|to)-gradient|(?:linear|radial|conic)-gradient\\(|-\\[#[0-9a-fA-F]{3,8}\\]/]",
          message:
            "Design System : dégradé (R-01) ou couleur hex arbitraire interdits en className. Utiliser un token (globals.css @theme).",
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Service worker généré au build par @serwist/next (PWA offline-first,
    // ADR-118) — bundle minifié, gitignoré, jamais édité à la main.
    "public/sw.js",
    "public/sw.js.map",
    "public/swe-worker-*.js",
  ]),
]);

export default eslintConfig;
