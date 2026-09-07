import { describe, expect, it } from "vitest";
import { activeHref, canEmit, hasAnyShellScreen, isMoreActive, isTabActive, visibleMoreEntries, visibleTabs } from "./nav";

const labels = (entries: readonly { label: string }[]) => entries.map((entry) => entry.label);

describe("nav — onglets visibles par rôle", () => {
  it("coquille complète pour owner", () => {
    expect(labels(visibleTabs("owner"))).toEqual(["Accueil", "Factures", "Clients"]);
    expect(labels(visibleMoreEntries("owner"))).toEqual(["Produits", "Simulateur USSD", "Crédits", "Paramètres"]);
    expect(canEmit("owner")).toBe(true);
  });

  // field_agent garde invoices:read : l'onglet Factures est masqué par la
  // variante lite, pas par un manque de droit — l'accueil lui sert la liste.
  it("variante lite : field_agent perd l'onglet Factures, pas le droit", () => {
    expect(labels(visibleTabs("field_agent"))).toEqual(["Accueil", "Clients"]);
    expect(canEmit("field_agent")).toBe(true);
    // products:read et organization:read sont owner/admin — le tiroir est vide.
    expect(visibleMoreEntries("field_agent")).toEqual([]);
  });

  it("un caissier garde l'onglet Factures mais pas le tiroir", () => {
    expect(labels(visibleTabs("cashier"))).toEqual(["Accueil", "Factures", "Clients"]);
    expect(visibleMoreEntries("cashier")).toEqual([]);
  });

  it("un rôle en lecture seule ne voit ni Clients ni action d'émission", () => {
    expect(labels(visibleTabs("viewer"))).toEqual(["Accueil", "Factures"]);
    expect(canEmit("viewer")).toBe(false);
  });

  // Le cas que NavGate rattrape : aucune permission d'écran, donc aucune
  // coquille à afficher — plutôt qu'une barre vide dont chaque lien ferait 403.
  it("delivery_driver n'a aucun écran de coquille", () => {
    expect(visibleTabs("delivery_driver")).toEqual([]);
    expect(canEmit("delivery_driver")).toBe(false);
    expect(visibleMoreEntries("delivery_driver")).toEqual([]);
    expect(hasAnyShellScreen("delivery_driver")).toBe(false);
    expect(hasAnyShellScreen("owner")).toBe(true);
    expect(hasAnyShellScreen("viewer")).toBe(true);
  });
});

describe("nav — onglet actif", () => {
  // La règle du plus long préfixe, et ce qu'elle évite : /dashboard n'attrape
  // pas tout le reste, et /dashboard/invoices/new ne colore pas « Factures ».
  it("attribue chaque chemin à l'entrée la plus spécifique", () => {
    expect(activeHref("/dashboard")).toBe("/dashboard");
    expect(activeHref("/dashboard/invoices")).toBe("/dashboard/invoices");
    expect(activeHref("/dashboard/invoices/new")).toBe("/dashboard/invoices/new");
    expect(activeHref("/dashboard/customers/abc-123")).toBe("/dashboard/customers");
    expect(activeHref("/cabinet")).toBeNull();
  });

  it("n'allume pas Factures pendant l'émission", () => {
    expect(isTabActive("/dashboard/invoices/new", "/dashboard/invoices")).toBe(false);
    expect(isTabActive("/dashboard/invoices/new", "/dashboard")).toBe(false);
    expect(isTabActive("/dashboard/invoices", "/dashboard/invoices")).toBe(true);
  });

  it("allume « Plus » quand on est sur un écran du tiroir", () => {
    expect(isMoreActive("/dashboard/products", "owner")).toBe(true);
    expect(isMoreActive("/dashboard/settings/fec", "owner")).toBe(true);
    expect(isMoreActive("/dashboard/customers", "owner")).toBe(false);
    // Même chemin, rôle sans accès au tiroir : rien à allumer.
    expect(isMoreActive("/dashboard/products", "cashier")).toBe(false);
  });
});
