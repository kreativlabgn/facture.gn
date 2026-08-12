import { describe, expect, it } from "vitest";
import { resolveProtectedRouteRedirect } from "./route-protection";

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

  it("laisse passer /login sans session — pas une route protégée", () => {
    expect(resolveProtectedRouteRedirect("/login", false)).toBeNull();
  });

  it("laisse passer la page d'accueil publique sans session", () => {
    expect(resolveProtectedRouteRedirect("/", false)).toBeNull();
  });
});
