import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESPACES, ESPACE_PAR_DEFAUT, LIBELLE_MENU } from "./espaces";
import { PROTECTED_PREFIXES, destinationInterne } from "./route-protection";

// ─────────────────────────────────────────────────────────────────────────────
// Garde-fous des portes d'entrée publiques. Ils attrapent la régression qui a
// motivé lib/espaces.ts : une carte de la landing qui envoie un visiteur SANS
// compte vers une route PROTÉGÉE, donc vers /login?returnTo=… — un formulaire
// de connexion pour quelqu'un qui venait s'inscrire. Personne ne le voit en
// relecture : le href a l'air légitime, c'est le proxy qui le détourne.
// ─────────────────────────────────────────────────────────────────────────────

const APP = path.resolve(__dirname, "..", "app");

// Un chemin d'URL → le page.tsx qui le sert, en traversant les groupes de
// routes « (auth) », « (entree) », « (coquille) »… qui ne changent pas l'URL,
// à n'importe quel niveau. Suffisant pour des chemins statiques ; aucune porte
// publique n'a de segment dynamique.
function pageExiste(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);

  function chercher(dossier: string, reste: string[]): boolean {
    if (reste.length === 0) {
      return existsSync(path.join(dossier, "page.tsx"));
    }
    if (!existsSync(dossier)) {
      return false;
    }
    const [segment, ...suite] = reste;
    const groupes = readdirSync(dossier).filter((d) => d.startsWith("(") && d.endsWith(")"));
    return (
      chercher(path.join(dossier, segment), suite) ||
      groupes.some((groupe) => chercher(path.join(dossier, groupe), reste))
    );
  }

  return chercher(APP, segments);
}

function estProtegee(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function decomposer(href: string): { pathname: string; returnTo: string | null } {
  const url = new URL(href, "https://facture.gn");
  return { pathname: url.pathname, returnTo: url.searchParams.get("returnTo") };
}

const ACTIONS = ESPACES.flatMap((espace) =>
  [espace.connexion, espace.creation].filter((a): a is NonNullable<typeof a> => a !== null).map((a) => ({
    espace: espace.id,
    ...a,
    ...decomposer(a.href),
  })),
);

describe("espaces — chaque porte publique ouvre sur un écran qui existe", () => {
  it.each(ACTIONS)("$espace · « $label » → $pathname", ({ pathname }) => {
    expect(pageExiste(pathname), `${pathname} n'a pas de page.tsx`).toBe(true);
  });

  it("aucune porte publique ne vise une route protégée — c'est la boucle vers /login", () => {
    const fautives = ACTIONS.filter((a) => estProtegee(a.pathname)).map((a) => `${a.espace} → ${a.pathname}`);
    expect(fautives).toEqual([]);
  });

  // Le returnTo, lui, DOIT pouvoir viser une route protégée : c'est la
  // destination après authentification (/cabinet, /nouveau-cabinet). Mais il
  // doit exister, et rester interne (destinationInterne le laisse passer tel
  // quel — sinon la Server Action retomberait sur /dashboard en silence, et le
  // cabinet atterrirait dans l'espace PME).
  it("chaque returnTo est interne et sert un écran existant", () => {
    for (const { returnTo } of ACTIONS.filter((a) => a.returnTo !== null)) {
      expect(destinationInterne(returnTo!, "/__fallback__")).toBe(returnTo);
      expect(pageExiste(returnTo!), `${returnTo} n'a pas de page.tsx`).toBe(true);
    }
  });
});

describe("espaces — cohérence des trois profils", () => {
  it("les professionnels ont deux actions, l'acheteur une seule (aucun compte à créer)", () => {
    const parId = Object.fromEntries(ESPACES.map((e) => [e.id, e]));
    expect(parId.marchand.creation).not.toBeNull();
    expect(parId.cabinet.creation).not.toBeNull();
    expect(parId.acheteur.creation).toBeNull();
  });

  it("le cabinet et le marchand partagent le formulaire de compte, mais pas la destination", () => {
    const parId = Object.fromEntries(ESPACES.map((e) => [e.id, e]));
    expect(decomposer(parId.marchand.creation!.href).pathname).toBe("/register");
    expect(decomposer(parId.cabinet.creation!.href).pathname).toBe("/register");
    expect(decomposer(parId.cabinet.creation!.href).returnTo).toBe("/nouveau-cabinet");
    expect(decomposer(parId.cabinet.connexion.href).returnTo).toBe("/cabinet");
  });

  it("un seul espace porte l'accent, et c'est le profil par défaut", () => {
    expect(ESPACES.filter((e) => e.accent).map((e) => e.id)).toEqual([ESPACE_PAR_DEFAUT.id]);
    expect(ESPACE_PAR_DEFAUT.id).toBe("marchand");
  });

  it("le menu du header nomme chaque profil", () => {
    for (const espace of ESPACES) {
      expect(LIBELLE_MENU[espace.id]).toBeTruthy();
    }
  });
});

describe("landing — plus aucun lien direct vers le hub ni vers les routes d'orientation protégées", () => {
  const landing = readFileSync(path.join(APP, "page.tsx"), "utf8");

  it("ne pointe plus vers /inscription, /espace-marchand ni /espace-cabinet", () => {
    expect(landing).not.toMatch(/href="\/inscription"/);
    expect(landing).not.toMatch(/\/espace-(?:marchand|cabinet)/);
  });
});
