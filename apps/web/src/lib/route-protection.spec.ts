import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_PREFIXES, resolveProtectedRouteRedirect } from "./route-protection";

describe("resolveProtectedRouteRedirect", () => {
  it("redirige vers /login pour /dashboard sans session", () => {
    expect(resolveProtectedRouteRedirect("/dashboard", false)).toBe("/login");
  });

  it("redirige vers /login pour une sous-route /cabinet sans session", () => {
    expect(resolveProtectedRouteRedirect("/cabinet/mandates", false)).toBe("/login");
  });

  it("laisse passer /dashboard avec une session active", () => {
    expect(resolveProtectedRouteRedirect("/dashboard", true)).toBeNull();
  });

  it("redirige vers /login pour /onboarding sans session", () => {
    expect(resolveProtectedRouteRedirect("/onboarding", false)).toBe("/login");
  });

  it("laisse passer /onboarding avec une session active", () => {
    expect(resolveProtectedRouteRedirect("/onboarding", true)).toBeNull();
  });

  // /register est le seul écran du tunnel qui doit rester ouvert : c'est là
  // qu'on n'a pas encore de compte.
  it("laisse passer /register sans session", () => {
    expect(resolveProtectedRouteRedirect("/register", false)).toBeNull();
  });

  it("laisse passer /login sans session — pas une route protégée", () => {
    expect(resolveProtectedRouteRedirect("/login", false)).toBeNull();
  });

  it("laisse passer la page d'accueil publique sans session", () => {
    expect(resolveProtectedRouteRedirect("/", false)).toBeNull();
  });
});

// Garde-fou de câblage, pas de logique. resolveProtectedRouteRedirect() peut
// être parfaitement juste et ne JAMAIS s'exécuter : le proxy Next 16 (ex-
// middleware) ne tourne que sur les chemins listés dans son `matcher`. Un
// préfixe ajouté ici sans l'être là donne une page qui se croit gardée et ne
// l'est pas — c'est exactement ce qui est arrivé à /onboarding.
describe("proxy — le matcher couvre tous les préfixes protégés", () => {
  const source = readFileSync(path.resolve(__dirname, "..", "proxy.ts"), "utf8");
  // Sous-chaîne plutôt que regex : le matcher est une liste littérale, la
  // lire ainsi reste franc et évite une expression à maintenir.
  const start = source.indexOf("matcher:");
  const matcher = source.slice(start, source.indexOf("]", start));

  it.each(PROTECTED_PREFIXES)("%s est déclaré dans le matcher", (prefix) => {
    expect(matcher).toContain(`"${prefix}/:path*"`);
  });
});

describe("destinationInterne", () => {
  it("conserve un chemin local et sa query string", async () => {
    const { destinationInterne } = await import("./route-protection");
    expect(destinationInterne("/cabinet?tab=structure")).toBe("/cabinet?tab=structure");
  });

  it("rejette les URLs absolues et protocol-relative", async () => {
    const { destinationInterne } = await import("./route-protection");
    expect(destinationInterne("https://example.com")).toBe("/dashboard");
    expect(destinationInterne("//example.com")).toBe("/dashboard");
  });

  it("rejette la contre-oblique que les navigateurs normalisent en protocol-relative", async () => {
    const { destinationInterne } = await import("./route-protection");
    expect(destinationInterne("/\\example.com")).toBe("/dashboard");
    expect(destinationInterne("/\\/example.com")).toBe("/dashboard");
  });

  it("utilise le repli fourni pour une valeur vide", async () => {
    const { destinationInterne } = await import("./route-protection");
    expect(destinationInterne("", "/onboarding")).toBe("/onboarding");
  });
});