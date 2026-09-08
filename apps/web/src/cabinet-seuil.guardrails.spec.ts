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
  path.join(SRC, "components", "shell", "CabinetSidebar.tsx"),
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

// ─────────────────────────────────────────────────────────────────────────────
// L'AUTRE SENS DU SEUIL — et c'est celui qui manquait.
//
// L'entrée dans le cabinet était tenue (bloc ci-dessus) ; la sortie ne l'était
// pas : la barre latérale portait « Retour à mon commerce », et l'écran « Aucun
// cabinet » un bouton vers /dashboard. Une porte à sens unique n'étanche rien —
// le compte qui possède le même numéro pour son commerce et pour son cabinet
// repassait de l'un à l'autre en un clic, dans le sens où le contexte change
// justement sans prévenir.
//
// Changer d'univers exige désormais de FERMER SA SESSION : le cookie est
// détruit, on repasse par le hub d'aiguillage. Ces deux règles vont ensemble —
// la seconde interdit l'impasse que la première créerait seule.
// ─────────────────────────────────────────────────────────────────────────────

// Les fichiers qui composent l'espace cabinet, vus depuis l'intérieur.
const ESPACE_CABINET = [
  path.join(SRC, "app", "cabinet"),
  path.join(SRC, "components", "shell", "CabinetShell.tsx"),
  path.join(SRC, "components", "shell", "CabinetSidebar.tsx"),
  path.join(SRC, "components", "shell", "CabinetNav.tsx"),
];

const fichiersCabinet = walk(SRC).filter(
  (f) => !f.endsWith(".spec.ts") && ESPACE_CABINET.some((dedans) => f.startsWith(dedans)),
);

describe("Seuil cabinet — aucune sortie latérale vers l'espace marchand", () => {
  it("aucune destination /dashboard depuis l'espace cabinet", () => {
    // `href="/dashboard…"` comme `redirect("/dashboard…")` : les deux mènent au
    // même endroit, et une Server Action qui redirige est la façon la plus
    // discrète de recâbler le raccourci qu'on vient de retirer.
    const hits: { file: string; line: number; match: string }[] = [];
    for (const file of fichiersCabinet) {
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((text, i) => {
          const m = text.match(/(?:href=|redirect\()\s*["'`]\/dashboard(\/[^"'`]*)?["'`]/);
          if (m) {
            hits.push({ file: path.relative(SRC, file), line: i + 1, match: m[0] });
          }
        });
    }
    expect(
      hits,
      `Sortie directe du cabinet vers l'espace marchand — la sortie est la\nfermeture de session (logoutAction) :\n${JSON.stringify(hits, null, 2)}`,
    ).toEqual([]);
  });

  it("la barre latérale offre bien la fermeture de session", () => {
    // Contrepartie de la règle ci-dessus : interdire la sortie latérale sans
    // vérifier qu'il en reste UNE ferait de l'espace cabinet un piège.
    const barre = readFileSync(path.join(SRC, "components", "shell", "CabinetSidebar.tsx"), "utf8");
    expect(barre).toContain("logoutAction");
    expect(stripComments(barre)).toMatch(/<form\s+action=\{logoutAction\}>/);
  });

  it("l'écran « Aucun cabinet » n'est pas une impasse", () => {
    // Ce layout ne rend PAS la barre latérale — sans cette assertion, retirer
    // le lien vers /dashboard y laissait un écran dont on ne peut plus sortir.
    const layout = readFileSync(path.join(SRC, "app", "cabinet", "layout.tsx"), "utf8");
    expect(stripComments(layout)).toMatch(/<form\s+action=\{logoutAction\}>/);
  });
});
