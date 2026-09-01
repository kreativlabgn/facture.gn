import { describe, expect, it } from "vitest";

import {
  isPubliclyCacheableNavigation,
  isSensitiveRoute,
  OFFLINE_MAX_AGE_SECONDS,
} from "./offline-cache-policy";

describe("isSensitiveRoute", () => {
  it("est vrai pour toute route authentifiée ou de paiement", () => {
    for (const p of [
      "/dashboard",
      "/dashboard/invoices/new",
      "/cabinet",
      "/cabinet/mandates",
      "/pay/inv-1",
      "/api/anything",
      "/_next/data/build/dashboard.json",
    ]) {
      expect(isSensitiveRoute(p)).toBe(true);
    }
  });

  it("est faux pour les routes publiques", () => {
    for (const p of ["/", "/login", "/GN-12345678-2026-ABCDEF"]) {
      expect(isSensitiveRoute(p)).toBe(false);
    }
  });

  it("ne confond pas un préfixe partiel (/payments-info) avec /pay", () => {
    expect(isSensitiveRoute("/payments-info")).toBe(false);
  });
});

describe("isPubliclyCacheableNavigation", () => {
  it("autorise l'accueil et la page de connexion", () => {
    expect(isPubliclyCacheableNavigation("/")).toBe(true);
    expect(isPubliclyCacheableNavigation("/login")).toBe(true);
  });

  it("autorise la page de vérification (identifiant de certification, segment unique)", () => {
    expect(isPubliclyCacheableNavigation("/GN-12345678-2026-ABCDEF")).toBe(true);
  });

  it("ignore la query string — seul le pathname compte", () => {
    expect(isPubliclyCacheableNavigation("/GN-12345678-2026-ABCDEF?src=sms")).toBe(true);
  });

  it("tolère une barre oblique finale", () => {
    expect(isPubliclyCacheableNavigation("/GN-12345678-2026-ABCDEF/")).toBe(true);
  });

  it("refuse toute route sensible", () => {
    for (const p of [
      "/dashboard",
      "/dashboard/invoices/new",
      "/cabinet/mandates",
      "/pay/inv-1",
      "/api/verify",
    ]) {
      expect(isPubliclyCacheableNavigation(p)).toBe(false);
    }
  });

  it("refuse un chemin à plusieurs segments qui n'est pas un identifiant", () => {
    expect(isPubliclyCacheableNavigation("/GN-12345678-2026-ABCDEF/edit")).toBe(false);
  });

  it("ne traite pas les fichiers réservés comme un identifiant de certification", () => {
    for (const p of ["/manifest.webmanifest", "/sw.js", "/favicon.ico", "/offline.html"]) {
      expect(isPubliclyCacheableNavigation(p)).toBe(false);
    }
  });

  it("INVARIANT : une route sensible n'est jamais cachable", () => {
    const paths = [
      "/",
      "/login",
      "/GN-1",
      "/dashboard",
      "/dashboard/x",
      "/cabinet/y",
      "/pay/z",
      "/api/a",
      "/_next/data/b.json",
      "/random/deep/path",
    ];
    for (const p of paths) {
      expect(isSensitiveRoute(p) && isPubliclyCacheableNavigation(p)).toBe(false);
    }
  });
});

describe("constantes", () => {
  it("expiration du cache de pages = 48 h", () => {
    expect(OFFLINE_MAX_AGE_SECONDS).toBe(48 * 60 * 60);
  });
});
