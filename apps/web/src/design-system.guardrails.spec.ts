import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Garde-fous du Design System facture.gn — appliqués à TOUT `apps/web/src`.
// Tourne dans le job `build` de la CI (`pnpm turbo test`). Complète la revue
// manuelle (checklist Chantier B) pour les règles vérifiables statiquement.
//
// Règles couvertes :
//   R-01  — aucun dégradé, sur aucun support.
//   R-11  — jamais de texte clair sur fond Or de Guinée (contraste 1.8:1).
//   Tokens — aucune couleur hex en dur : tout passe par globals.css @theme.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = path.resolve(__dirname);

// Fichiers où une couleur hex littérale est légitime (APIs qui exigent une
// chaîne couleur, pas une classe Tailwind). À garder MINIMAL et justifié.
const HEX_ALLOWLIST = new Set<string>([
  path.join(SRC, "app", "layout.tsx"), // viewport.themeColor — API Next.js, exige un hex
]);

// Le noir et le blanc purs ne sont pas des couleurs de MARQUE — tolérés dans
// les icônes SVG (stroke/fill) où `currentColor` n'est pas toujours pratique.
const NON_BRAND_HEX = /^#(?:fff|ffffff|000|000000)$/i;

// Retire les commentaires ligne (// …) et bloc (/* … */) avant de scanner —
// une doc qui MENTIONNE un hex n'est pas une violation.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

const files = walk(SRC).filter((f) => !f.endsWith(".spec.ts") && !f.endsWith(".guardrails.spec.ts"));

function scan(re: RegExp): { file: string; line: number; match: string }[] {
  const hits: { file: string; line: number; match: string }[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      const m = text.match(re);
      if (m) hits.push({ file: path.relative(SRC, file), line: i + 1, match: m[0].trim().slice(0, 80) });
    });
  }
  return hits;
}

describe("Design System — R-01 : aucun dégradé", () => {
  it("aucune utilitaire ou valeur de dégradé Tailwind/CSS", () => {
    const hits = scan(
      /\b(bg|text|border)-gradient-|\bbg-\[(?:linear|radial|conic)-gradient|(?:linear|radial|conic)-gradient\(|\b(?:from|via|to)-\[?#|\s(?:from|via|to)-(?:navy|or|good|bad|green|amber|blue|red|grey|surface|white|black)\b/,
    );
    expect(hits, `Dégradé(s) détecté(s) :\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe("Design System — couleurs par token uniquement", () => {
  it("aucune valeur hex arbitraire dans une classe Tailwind (-[#…])", () => {
    const hits = scan(/-\[#[0-9a-fA-F]{3,8}\]/);
    expect(hits, `Hex arbitraire en classe :\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  it("aucune couleur hex de marque en dur hors globals.css (noir/blanc SVG tolérés)", () => {
    const hits: { file: string; line: number; match: string }[] = [];
    for (const file of files) {
      if (file.endsWith("globals.css") || HEX_ALLOWLIST.has(file)) continue;
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((text, i) => {
          for (const m of text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []) {
            if (!NON_BRAND_HEX.test(m)) {
              hits.push({ file: path.relative(SRC, file), line: i + 1, match: `${m} — ${text.trim().slice(0, 70)}` });
            }
          }
        });
    }
    expect(hits, `Hex de marque en dur (utiliser un token) :\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe("Design System — R-11 : jamais de texte clair sur Or de Guinée", () => {
  // Heuristique même-élément : une classe qui pose un fond Or ET une couleur de
  // texte claire. Le cas inter-éléments (parent bg-or, enfant text-white) reste
  // en revue manuelle — impossible à trancher au grep sans faux positifs.
  it("aucun className ne combine un fond Or et un texte clair", () => {
    const LIGHT_TEXT = /text-(?:white|grey|surface|navy-(?:50|100|200|400)|good-bg|bad-bg)\b/;
    const OR_BG = /bg-(?:or|amber|amber-bg|\[#[fF][bB]{2}500\])\b/;
    const hits: { file: string; line: number; match: string }[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((text, i) => {
          // on regarde le contenu entre guillemets sur la ligne (className="…")
          for (const quoted of text.match(/["'`][^"'`]*["'`]/g) ?? []) {
            if (OR_BG.test(quoted) && LIGHT_TEXT.test(quoted)) {
              hits.push({ file: path.relative(SRC, file), line: i + 1, match: quoted.slice(0, 90) });
            }
          }
        });
    }
    expect(hits, `Texte clair sur Or (utiliser text-navy-950) :\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});
