import { describe, expect, it } from "vitest";
import { hasPermission, permissionsFor, roleLabel, shellVariantFor } from "./permissions";

// Ces tests verrouillent le MIROIR des @Roles() de trust-api. Ils échouent
// exprès si quelqu'un élargit une permission à l'aveugle : chaque assertion
// nomme le controller qu'elle recopie, la corriger demande d'aller vérifier
// là-bas d'abord.
describe("permissions — miroir des @Roles() de trust-api", () => {
  it("owner et admin ont tout ce que la coquille sait afficher", () => {
    for (const role of ["owner", "admin"]) {
      expect(permissionsFor(role)).toEqual([
        "invoices:read",
        "invoices:create",
        "customers:read",
        "customers:create",
        "customers:merge",
        "products:read",
        "organization:read",
        "organization:trust_score",
        "payments:record",
      ]);
    }
  });

  // products.controller.ts : TOUT le controller est owner/admin, lecture
  // comprise (cost_price, territoire business_manager d'ADR-084).
  it("le catalogue produit reste fermé au-delà d'owner/admin", () => {
    expect(hasPermission("accountant_internal", "products:read")).toBe(false);
    expect(hasPermission("cashier", "products:read")).toBe(false);
    expect(hasPermission("field_agent", "products:read")).toBe(false);
  });

  // customers.controller.ts, E4/ADR-038 : "admin/owner uniquement, jamais
  // cashier ni field_agent" — la fusion est irréversible.
  it("la fusion de clients n'est ouverte qu'à owner/admin", () => {
    expect(hasPermission("cashier", "customers:read")).toBe(true);
    expect(hasPermission("cashier", "customers:merge")).toBe(false);
    expect(hasPermission("field_agent", "customers:merge")).toBe(false);
  });

  // invoices.controller.ts : delivery_driver n'est dans AUCUNE route facture.
  // C'est ce qui rend son cas particulier (voir NavGate).
  it("delivery_driver n'a que l'encaissement", () => {
    expect(permissionsFor("delivery_driver")).toEqual(["payments:record"]);
  });

  // viewer (F3, DAT §3.5) et tax_controller_readonly (F14, ADR-104) : lecture
  // stricte des factures, rien d'autre.
  it("les rôles en lecture seule ne peuvent ni émettre ni voir les clients", () => {
    for (const role of ["viewer", "tax_controller_readonly"]) {
      expect(permissionsFor(role)).toEqual(["invoices:read"]);
    }
  });

  // Un rôle ajouté côté trust-api mais pas encore connu ici doit se comporter
  // comme « aucune permission » — jamais comme « toutes ».
  it("un rôle inconnu n'obtient rien", () => {
    expect(permissionsFor("role_inexistant")).toEqual([]);
    expect(hasPermission("role_inexistant", "invoices:read")).toBe(false);
  });
});

describe("permissions — variante de coquille", () => {
  it("le terrain passe en lite, le bureau reste en coquille complète", () => {
    expect(shellVariantFor("field_agent")).toBe("lite");
    expect(shellVariantFor("delivery_driver")).toBe("lite");
    // Un caissier a presque les droits d'un agent terrain et garde pourtant la
    // coquille complète : la variante tient au contexte d'usage, pas aux droits.
    expect(shellVariantFor("cashier")).toBe("full");
    expect(shellVariantFor("owner")).toBe("full");
  });
});

describe("permissions — libellés", () => {
  it("traduit les rôles connus et laisse passer les autres tels quels", () => {
    expect(roleLabel("field_agent")).toBe("Agent terrain");
    expect(roleLabel("role_inexistant")).toBe("role_inexistant");
  });
});
