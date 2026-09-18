import { describe, expect, it } from "vitest";
import {
  CABINET_NAV,
  CABINET_NAV_GROUPS,
  cabinetPageTitle,
  canInviteMembers,
  canRequestMandate,
  canRevokeMandate,
  canManagePractice,
  isCabinetNavActive,
  modeLabel,
  palierLabel,
  practiceRoleLabel,
  visibleCabinetGroups,
} from "./cabinet-nav";

describe("cabinet-nav — droits, miroir des gardes serveur", () => {
  it("seul practice_admin engage le cabinet (révocation, invitations)", () => {
    expect(canRevokeMandate("practice_admin")).toBe(true);
    expect(canInviteMembers("practice_admin")).toBe(true);
  });

  it("un comptable externe consulte mais n'engage pas", () => {
    expect(canRevokeMandate("accountant_external")).toBe(false);
    expect(canInviteMembers("accountant_external")).toBe(false);
  });

  it("un gestionnaire d'affaires non plus", () => {
    expect(canRevokeMandate("business_manager")).toBe(false);
    expect(canInviteMembers("business_manager")).toBe(false);
  });

  // LA RÈGLE (ADR-068/078) : le scope d'accountant_external porte
  // `mandate:request`. DEMANDER un mandat n'engage rien — c'est l'organisation
  // qui accepte, explicitement, et qui révoque quand elle veut. Exiger un
  // practice_admin pour une simple demande suspendait le travail quotidien d'un
  // collaborateur à la disponibilité d'un associé.
  it("tout membre actif peut DEMANDER un mandat", () => {
    expect(canRequestMandate("practice_admin")).toBe(true);
    expect(canRequestMandate("accountant_external")).toBe(true);
    expect(canRequestMandate("business_manager")).toBe(true);
  });

  // Demander et révoquer ne sont pas le même geste : l'un sollicite, l'autre
  // retire un accès déjà consenti.
  it("mais seul un administrateur peut le RÉVOQUER", () => {
    expect(canRevokeMandate("accountant_external")).toBe(false);
    expect(canRequestMandate("accountant_external")).toBe(true);
  });

  // Un rôle inconnu (nouveau rôle backend pas encore recopié ici) ne doit
  // jamais ouvrir un droit par défaut — pas même le plus anodin.
  it("un rôle inconnu n'ouvre aucun droit", () => {
    expect(canRevokeMandate("owner")).toBe(false);
    expect(canRequestMandate("owner")).toBe(false);
    expect(canRequestMandate("")).toBe(false);
    expect(canInviteMembers("")).toBe(false);
  });

  it("affiche le rôle en français, et le laisse brut s'il est inconnu", () => {
    expect(practiceRoleLabel("practice_admin")).toBe("Administrateur du cabinet");
    expect(practiceRoleLabel("role_inconnu")).toBe("role_inconnu");
  });

  // Régression : ces deux fonctions vivaient dans ReglagesForms.tsx ("use
  // client"), inappelables depuis page.tsx (composant serveur) — erreur
  // runtime « Attempted to call ... from the server but ... is on the client ».
  it("affiche le palier partenaire en français, et le laisse brut s'il est inconnu", () => {
    expect(palierLabel("partner_pro")).toBe("Partenaire — Pro");
    expect(palierLabel("palier_inconnu")).toBe("palier_inconnu");
  });

  it("affiche le mode de reversement en français, et le laisse brut s'il est inconnu", () => {
    expect(modeLabel("subscription_deduction")).toBe("Déduction sur l'abonnement");
    expect(modeLabel("mode_inconnu")).toBe("mode_inconnu");
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
    for (const entry of CABINET_NAV) {
      const actives = CABINET_NAV.filter((autre) => isCabinetNavActive(entry.href, autre.href));
      expect(actives).toHaveLength(1);
    }
  });
});

describe("cabinet-nav — groupes visibles selon le rôle", () => {
  it("un administrateur voit tout", () => {
    const entrees = visibleCabinetGroups("practice_admin").flatMap((g) => g.entries);
    expect(entrees).toHaveLength(CABINET_NAV.length);
  });

  // Masquer n'autorise rien — trust-api refuse de toute façon en 403. C'est
  // pour ne pas offrir un bouton qui n'aboutit pas.
  it("un comptable externe ne voit pas les réglages du cabinet", () => {
    const hrefs = visibleCabinetGroups("accountant_external")
      .flatMap((g) => g.entries)
      .map((e) => e.href);
    expect(hrefs).not.toContain("/cabinet/settings");
    expect(hrefs).toContain("/cabinet");
    expect(hrefs).toContain("/cabinet/members");
  });

  it("un rôle inconnu n'ouvre aucune entrée administrative", () => {
    const hrefs = visibleCabinetGroups("owner")
      .flatMap((g) => g.entries)
      .map((e) => e.href);
    expect(hrefs).not.toContain("/cabinet/settings");
  });

  // Un titre de groupe seul, sans rien dessous, ressemble à un écran cassé.
  it("aucun groupe vide n'est rendu", () => {
    for (const role of ["practice_admin", "accountant_external", "business_manager", "inconnu"]) {
      for (const groupe of visibleCabinetGroups(role)) {
        expect(groupe.entries.length).toBeGreaterThan(0);
      }
    }
  });

  it("le palier partenaire et le reversement restent administratifs", () => {
    expect(canManagePractice("practice_admin")).toBe(true);
    expect(canManagePractice("accountant_external")).toBe(false);
    expect(canManagePractice("business_manager")).toBe(false);
  });

  // Chaque entrée doit exister dans un groupe : CABINET_NAV en est l'aplati,
  // pas une seconde liste à maintenir en parallèle.
  it("CABINET_NAV est bien l'aplati des groupes", () => {
    const depuisGroupes = CABINET_NAV_GROUPS.flatMap((g) => g.entries);
    expect(CABINET_NAV).toEqual(depuisGroupes);
  });
});

describe("cabinet-nav — titre de la page", () => {
  // L'entrée la PLUS SPÉCIFIQUE gagne : sans cette règle, /cabinet attrape
  // tout et chaque sous-page s'annonce « Vue d'ensemble ».
  it("chaque route porte le titre de sa propre section", () => {
    expect(cabinetPageTitle("/cabinet")).toBe("Vue d'ensemble");
    expect(cabinetPageTitle("/cabinet/mandates")).toBe("Mandats");
    expect(cabinetPageTitle("/cabinet/members")).toBe("Collaborateurs");
    expect(cabinetPageTitle("/cabinet/settings")).toBe("Paramètres");
  });

  it("une sous-route hérite du titre de sa section", () => {
    expect(cabinetPageTitle("/cabinet/organizations/org-1")).toBe("Entreprises suivies");
  });

  it("une route hors navigation n'invente aucun titre", () => {
    expect(cabinetPageTitle("/cabinet/inconnu")).toBeNull();
  });
});
