import { describe, expect, it } from "vitest";
import {
  CABINET_NAV,
  canInviteMembers,
  canManageMandates,
  isCabinetNavActive,
  practiceRoleLabel,
} from "./cabinet-nav";

describe("cabinet-nav — droits, miroir d'assertPracticeAdmin", () => {
  it("seul practice_admin engage le cabinet (mandats, invitations)", () => {
    expect(canManageMandates("practice_admin")).toBe(true);
    expect(canInviteMembers("practice_admin")).toBe(true);
  });

  it("un comptable externe consulte mais n'engage pas", () => {
    expect(canManageMandates("accountant_external")).toBe(false);
    expect(canInviteMembers("accountant_external")).toBe(false);
  });

  it("un gestionnaire d'affaires non plus", () => {
    expect(canManageMandates("business_manager")).toBe(false);
    expect(canInviteMembers("business_manager")).toBe(false);
  });

  // Un rôle inconnu (nouveau rôle backend pas encore recopié ici) ne doit
  // jamais ouvrir un droit par défaut.
  it("un rôle inconnu n'ouvre aucun droit", () => {
    expect(canManageMandates("owner")).toBe(false);
    expect(canInviteMembers("")).toBe(false);
  });

  it("affiche le rôle en français, et le laisse brut s'il est inconnu", () => {
    expect(practiceRoleLabel("practice_admin")).toBe("Administrateur du cabinet");
    expect(practiceRoleLabel("role_inconnu")).toBe("role_inconnu");
  });
});

describe("cabinet-nav — entrée active", () => {
  it("la racine n'est active que sur elle-même", () => {
    expect(isCabinetNavActive("/cabinet", "/cabinet")).toBe(true);
    expect(isCabinetNavActive("/cabinet/mandates", "/cabinet")).toBe(false);
    expect(isCabinetNavActive("/cabinet/members", "/cabinet")).toBe(false);
  });

  it("une section est active sur elle-même et ses sous-routes", () => {
    expect(isCabinetNavActive("/cabinet/mandates", "/cabinet/mandates")).toBe(true);
    expect(isCabinetNavActive("/cabinet/mandates/demander", "/cabinet/mandates")).toBe(true);
    expect(isCabinetNavActive("/cabinet/members", "/cabinet/mandates")).toBe(false);
  });

  // Le piège du préfixe nu : /cabinet/mandates-archives n'est pas une
  // sous-route de /cabinet/mandates.
  it("ne confond pas un préfixe de chaîne avec une sous-route", () => {
    expect(isCabinetNavActive("/cabinet/mandates-archives", "/cabinet/mandates")).toBe(false);
  });

  it("exactement une entrée active sur chaque route du cabinet", () => {
    for (const pathname of ["/cabinet", "/cabinet/mandates", "/cabinet/members"]) {
      const actives = CABINET_NAV.filter((entry) => isCabinetNavActive(pathname, entry.href));
      expect(actives).toHaveLength(1);
    }
  });
});
