import { describe, expect, it } from "vitest";
import { pickActiveOrganization } from "./active-organization";
import type { OrganizationSummary } from "./trust-api";

const org = (id: string, name: string, role = "owner"): OrganizationSummary => ({
  id,
  name,
  role,
  commercialTier: "starter",
});

describe("active-organization — choix de l'organisation active", () => {
  it("retient l'organisation demandée quand elle appartient à l'utilisateur", () => {
    const organizations = [org("a", "Alpha"), org("b", "Beta")];
    expect(pickActiveOrganization(organizations, "b")?.name).toBe("Beta");
  });

  // Le cœur de la règle : le cookie n'est jamais une autorisation. Un
  // identifiant absent de la liste réelle du porteur du JWT est ignoré, pas
  // utilisé — falsifier le cookie ne donne accès à rien.
  it("ignore un identifiant absent de la liste du porteur du jeton", () => {
    const organizations = [org("a", "Alpha"), org("b", "Beta")];
    expect(pickActiveOrganization(organizations, "organisation-d-un-autre")?.name).toBe("Alpha");
  });

  it("retombe sur la première organisation sans préférence enregistrée", () => {
    expect(pickActiveOrganization([org("a", "Alpha"), org("b", "Beta")], null)?.name).toBe("Alpha");
  });

  it("rend null quand le compte n'est rattaché à aucune organisation", () => {
    expect(pickActiveOrganization([], null)).toBeNull();
    expect(pickActiveOrganization([], "a")).toBeNull();
  });
});
