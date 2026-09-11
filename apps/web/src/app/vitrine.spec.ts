import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────
// GARDE-FOUS DE LA VITRINE — la landing (`app/page.tsx`), la vitrine des
// comptes de démonstration (`ComptesDemo`) et les écrans `/demo/*`.
//
// Hérité de `(marketing)/landing.spec.ts` : la landing d'autorité qu'il
// surveillait a été retirée au profit de celle de la refonte frontend (#19),
// qui occupe déjà la route `/`. Les contrôles liés à sa structure (ancres de
// menu ↔ sections) sont partis avec elle ; les autres sont conservés :
//
//   1. Un bouton de démonstration qui pointe une route supprimée rend un 404
//      au visiteur le plus qualifié — celui qui a cliqué « voir ».
//   2. Un taux écrit à la main dans une phrase se périme au premier changement
//      de barème. Ce dépôt porte déjà la cicatrice : la plaquette annonçait
//      1,1 % pendant que le code prélevait 1,50 %.
//   3. Aucune fonte d'icônes tierce, sur tout `src` : choix de poids de page
//      sur un forfait data guinéen, pas une préférence de style.
// ─────────────────────────────────────────────────

const SRC = path.resolve(__dirname, "..");

// Le contenu des commentaires bloc est blanchi caractère par caractère plutôt
// que supprimé, pour que les numéros de ligne restent ceux du fichier réel —
// même procédé que `design-system.guardrails.spec.ts`.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function matchAll(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1]);
}

const lire = (...segments: string[]) => stripComments(readFileSync(path.join(SRC, ...segments), "utf8"));

describe("vitrine — les portes de démonstration ouvrent sur quelque chose", () => {
  // Restreint à `/demo` : les autres chemins traversent des groupes de routes
  // (`(auth)/inscription`), que les parenthèses effacent de l'URL — les déduire
  // du href demanderait de réimplémenter le routeur de Next pour un gain nul.
  const PORTES = [
    lire("components", "ComptesDemo.tsx"),
    lire("app", "demo", "page.tsx"),
    lire("app", "demo", "marchand", "page.tsx"),
    lire("app", "demo", "cabinet", "page.tsx"),
  ];
  const liens = new Set(PORTES.flatMap((src) => matchAll(src, /href="(\/demo[a-z/-]*)"/g)));

  it("cite au moins les scénarios annoncés", () => {
    expect(liens.size).toBeGreaterThanOrEqual(3);
  });

  it("chaque lien /demo correspond à une page ou une route servie", () => {
    for (const lien of liens) {
      const base = path.join(SRC, "app", lien.replace(/^\//, ""));
      const servi = existsSync(path.join(base, "page.tsx")) || existsSync(path.join(base, "route.ts"));
      expect(servi, `${lien} ne correspond à aucun fichier de route`).toBe(true);
    }
  });

  it("propose l'export FEC en téléchargement direct", () => {
    // L'argument du segment cabinet est que le fichier se VÉRIFIE. Un bouton
    // qui ne sert plus le fichier retire la seule preuve que la section avance.
    expect(liens.has("/demo/cabinet/fec")).toBe(true);
  });
});

describe("vitrine — aucun chiffre de barème écrit à la main", () => {
  // `1,50 %`, `3.53%`, `2,67 %` — toutes les orthographes d'un taux décimal.
  // Un entier suivi de `%` reste permis : « 100 % » est une tournure de langue,
  // pas un tarif.
  const TAUX_LITTERAL = /\d+[.,]\d+\s*%/;

  const VITRINE = [
    path.join(SRC, "app", "page.tsx"),
    path.join(SRC, "app", "demo", "marchand", "page.tsx"),
    path.join(SRC, "app", "demo", "cabinet", "page.tsx"),
    path.join(SRC, "components", "ComptesDemo.tsx"),
    path.join(SRC, "app", "pay", "[invoiceId]", "page.tsx"),
  ];

  it("laisse lib/plans.ts être la seule source des taux affichés", () => {
    const fautes: string[] = [];
    for (const fichier of VITRINE) {
      stripComments(readFileSync(fichier, "utf8"))
        .split("\n")
        .forEach((ligne, i) => {
          const m = ligne.match(TAUX_LITTERAL);
          if (m) fautes.push(`${path.relative(SRC, fichier)}:${i + 1} → ${m[0]}`);
        });
    }
    expect(fautes).toEqual([]);
  });
});

describe("vitrine — aucune fonte d'icônes tierce", () => {
  // Chaque glyphe de ce dépôt est un <svg> écrit à la main. Une bibliothèque
  // d'icônes ajoute des dizaines de kilo-octets pour une douzaine de tracés, et
  // rend `currentColor` moins direct qu'il ne l'est ici.
  const INTERDITS = /from\s+"(lucide-react|react-icons[^"]*|@heroicons[^"]*|@fortawesome[^"]*)"/;

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("n'importe aucune bibliothèque d'icônes dans src", () => {
    const fautes = walk(SRC)
      .filter((f) => !f.endsWith(".spec.ts"))
      .filter((f) => INTERDITS.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => path.relative(SRC, f));
    expect(fautes).toEqual([]);
  });
});
