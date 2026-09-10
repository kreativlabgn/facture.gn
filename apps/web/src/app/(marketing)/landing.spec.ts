import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// GARDE-FOUS DE LA VITRINE — la landing et les écrans de démonstration.
//
// Ces contrôles ne jugent pas le discours : ils vérifient les trois choses
// qu'une relecture humaine rate systématiquement parce qu'elles ne se voient
// pas à l'écran de celui qui vient d'écrire la page.
//
//   1. Un lien de navigation dont la section a disparu ne casse RIEN de
//      visible : le clic ne fait rien, la page ne bouge pas, et personne ne
//      s'en aperçoit avant un client. C'est la panne annoncée par le
//      commentaire de `layout.tsx`, laissée sans filet jusqu'ici.
//   2. Un bouton de démonstration qui pointe une route supprimée rend un 404
//      au visiteur le plus qualifié de la page — celui qui a cliqué « voir ».
//   3. Un taux écrit à la main dans une phrase se périme au premier changement
//      de barème. Ce dépôt porte déjà la cicatrice : la plaquette annonçait
//      1,1 % pendant que le code prélevait 1,50 %.
//
// Le dernier contrôle (aucune fonte d'icônes tierce) porte sur tout `src` : la
// contrainte est un choix de poids de page sur un forfait data guinéen, pas une
// préférence de style — elle doit tenir partout, pas seulement en vitrine.
// ─────────────────────────────────────────────────────────────────────────────

const MARKETING = __dirname;
const SRC = path.resolve(MARKETING, "..", "..");

const layout = readFileSync(path.join(MARKETING, "layout.tsx"), "utf8");
const page = readFileSync(path.join(MARKETING, "page.tsx"), "utf8");

// Une doc qui MENTIONNE un taux ou une ancre n'est pas une violation. Le
// contenu des commentaires bloc est blanchi caractère par caractère plutôt que
// supprimé, pour que les numéros de ligne restent ceux du fichier réel — même
// procédé que `design-system.guardrails.spec.ts`.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function matchAll(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1]);
}

// Les QUATRE espaces étanches, plus les deux services publics de la page. Un
// espace retiré doit casser ce test, pas se découvrir en réunion : la
// segmentation est une promesse commerciale, pas une mise en page.
const ESPACES = ["pme", "cabinets", "grands-comptes", "developpeurs"];
const SERVICES = ["verify", "faq"];

describe("vitrine — la navigation ne pointe que des sections qui existent", () => {
  const ancresNav = matchAll(layout, /href:\s*"#([a-z-]+)"/g);
  const sectionsPage = new Set(matchAll(page, /\bid="([a-z-]+)"/g));

  it("déclare au moins une entrée de navigation", () => {
    // Sans ce contrôle, un NAV vidé par accident rendrait les deux `it`
    // suivants verts sur zéro élément — le pire des faux positifs.
    expect(ancresNav.length).toBeGreaterThanOrEqual(ESPACES.length);
  });

  it("chaque ancre du menu correspond à une section de la landing", () => {
    const mortes = ancresNav.filter((ancre) => !sectionsPage.has(ancre));
    expect(mortes).toEqual([]);
  });

  it("expose les quatre espaces étanches et les services publics", () => {
    for (const id of [...ESPACES, ...SERVICES]) {
      expect(sectionsPage.has(id), `section #${id} absente de la landing`).toBe(true);
    }
  });

  it("mène à chaque espace depuis le menu — un espace sans entrée est invisible", () => {
    for (const id of ESPACES) {
      expect(ancresNav, `#${id} n'est atteignable par aucune entrée de menu`).toContain(id);
    }
  });
});

describe("vitrine — les portes de démonstration ouvrent sur quelque chose", () => {
  // Restreint à `/demo` : les autres chemins de la page traversent des groupes
  // de routes (`(auth)/inscription`), que les parenthèses effacent de l'URL —
  // les déduire du href demanderait de réimplémenter le routeur de Next pour
  // un gain nul.
  const liens = new Set(matchAll(stripComments(page), /href="(\/demo[a-z/-]*)"/g));

  it("cite au moins les trois scénarios annoncés", () => {
    expect(liens.size).toBeGreaterThanOrEqual(3);
  });

  it("chaque lien /demo correspond à une page ou une route servie", () => {
    for (const lien of liens) {
      const base = path.join(SRC, "app", lien.replace(/^\//, ""));
      const servi = existsSync(path.join(base, "page.tsx")) || existsSync(path.join(base, "route.ts"));
      expect(servi, `${lien} ne correspond à aucun fichier de route`).toBe(true);
    }
  });

  it("propose l'export FEC en téléchargement direct depuis la landing", () => {
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
    path.join(MARKETING, "page.tsx"),
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
