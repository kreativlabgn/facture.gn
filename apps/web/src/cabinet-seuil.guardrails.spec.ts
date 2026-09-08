import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// LE SEUIL ENTRE L'ESPACE MARCHAND ET UN CABINET.
//
// Le tableau de bord d'un commerce ne doit contenir AUCUN lien qui mène en un
// clic au tableau de bord d'un cabinet. Un cabinet est une entité juridique
// distincte : d'autres clients, d'autres chiffres, d'autres obligations. Un
// compte peut légitimement appartenir aux deux — c'est le cas d'un comptable
// qui tient aussi son commerce — et trust-api refuse de toute façon tout
// non-membre en 403. Mais un accès légitime qui s'ouvre sans qu'on l'ait
// demandé reste un défaut : personne ne devrait découvrir qu'il a changé
// d'entreprise en lisant un chiffre qui ne lui dit rien.
//
// Le passage se fait donc par /dashboard/espace-cabinet, qui NOMME ce qu'on
// quitte et ce qu'on rejoint, et n'y entre que par une Server Action (un POST),
// jamais par un <Link> — un lien se déclenche au frôlement, une soumission
// demande un geste.
//
// Ce garde est une barrière de RÉGRESSION. Il ne remplace aucune autorisation :
// celles-ci vivent côté trust-api (assertPracticeAdmin) et dans
// pickActivePractice, tous deux testés ailleurs.

const SRC = path.resolve(__dirname);

// L'espace cabinet lui-même a le droit de se pointer du doigt — c'est chez lui.
const HORS_PERIMETRE = [
  path.join(SRC, "app", "cabinet"),
  path.join(SRC, "components", "shell", "CabinetShell.tsx"),
  path.join(SRC, "components", "shell", "CabinetNav.tsx"),
  path.join(SRC, "lib", "cabinet-nav.ts"),
  // Le tunnel de création et la page d'accueil publique orientent vers
  // l'espace cabinet sans qu'aucune session marchande soit en cours.
  path.join(SRC, "app", "(auth)"),
  path.join(SRC, "app", "page.tsx"),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const fichiers = walk(SRC).filter(
  (f) => !f.endsWith(".spec.ts") && !HORS_PERIMETRE.some((hors) => f.startsWith(hors)),
);

describe("Seuil cabinet — aucun saut direct depuis l'espace marchand", () => {
  it('aucun href="/cabinet" hors de l\'espace cabinet lui-même', () => {
    const hits: { file: string; line: number; match: string }[] = [];
    for (const file of fichiers) {
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((text, i) => {
          // href="/cabinet" ou href="/cabinet/..." — la chaîne littérale.
          const m = text.match(/href=["'`]\/cabinet(\/[^"'`]*)?["'`]/);
          if (m) {
            hits.push({ file: path.relative(SRC, file), line: i + 1, match: m[0] });
          }
        });
    }
    expect(
      hits,
      `Lien direct vers l'espace cabinet depuis l'espace marchand — passer par\n/dashboard/espace-cabinet :\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it("le tiroir « Plus » mène au seuil, pas au cabinet", () => {
    const layout = readFileSync(path.join(SRC, "app", "(app)", "layout.tsx"), "utf8");
    expect(layout).toContain("/dashboard/espace-cabinet");
    // Le littéral "/cabinet" seul ne doit plus apparaître comme destination.
    expect(stripComments(layout)).not.toMatch(/cabinetHref=\{[^}]*["'`]\/cabinet["'`]/);
  });

  it("on entre dans le seuil par une Server Action, jamais par un lien", () => {
    const seuil = readFileSync(
      path.join(SRC, "app", "(app)", "dashboard", "espace-cabinet", "page.tsx"),
      "utf8",
    );
    expect(seuil).toContain("entrerDansCabinetAction");
    expect(seuil).toContain('type="submit"');
    // Aucun <Link> vers /cabinet : ce serait exactement le saut qu'on retire.
    expect(stripComments(seuil)).not.toMatch(/href=["'`]\/cabinet/);
  });
});
