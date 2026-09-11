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
        "invoices:issue",
        "invoices:void",
        "invoices:relance",
        "invoices:financing",
        "invoices:credit_note",
        "customers:read",
        "customers:create",
        "customers:merge",
        "products:read",
        "organization:read",
        "organization:trust_score",
        "organization:branches",
        "organization:members",
        "organization:api_keys",
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

  // financing.controller.ts, K4/ADR-088 : les deux routes sont
  // @Roles("owner","admin"). cashier peut émettre et relancer — il ne cède
  // jamais une créance, geste irréversible qui engage un montant réel.
  it("l'arbitrage de financement n'est ouvert qu'à owner/admin", () => {
    expect(hasPermission("owner", "invoices:financing")).toBe(true);
    expect(hasPermission("admin", "invoices:financing")).toBe(true);
    expect(hasPermission("cashier", "invoices:financing")).toBe(false);
    expect(hasPermission("accountant_internal", "invoices:financing")).toBe(false);
    expect(hasPermission("viewer", "invoices:financing")).toBe(false);
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

  // credit-notes.controller.ts — @Roles("owner","admin","cashier") : "portée
  // monétaire similaire, action du staff au comptoir". Le trio d'issue(), pas
  // celui, plus étroit, de void() : un avoir ne casse pas la séquence légale,
  // il la prolonge par un second document.
  it("l'avoir rectificatif suit le trio de l'émission, jamais celui de l'annulation", () => {
    expect(hasPermission("cashier", "invoices:credit_note")).toBe(true);
    expect(hasPermission("cashier", "invoices:void")).toBe(false);
    expect(hasPermission("accountant_internal", "invoices:credit_note")).toBe(false);
    expect(hasPermission("field_agent", "invoices:credit_note")).toBe(false);
  });

  // branches.controller.ts — trio ÉLARGI, comme POST /invoices : voir et créer
  // une succursale est une action de structuration, pas un acte financier.
  it("les succursales suivent le trio élargi des factures", () => {
    for (const role of ["accountant_internal", "cashier", "field_agent"]) {
      expect(hasPermission(role, "organization:branches")).toBe(true);
    }
    expect(hasPermission("viewer", "organization:branches")).toBe(false);
  });

  // organizations.controller.ts — GET/POST :id/members et .../revoke sont tous
  // @Roles("owner","admin") : donner ou retirer un accès est une élévation de
  // privilège. La garde owner-only sur les rôles admin/approver/owner est
  // appliquée EN PLUS côté service, invisible d'ici.
  it("la gestion d'équipe reste fermée au-delà d'owner/admin", () => {
    expect(hasPermission("cashier", "organization:members")).toBe(false);
    expect(hasPermission("accountant_internal", "organization:members")).toBe(false);
  });

  // api-keys.controller.ts — @Roles("owner","admin","developer_api"). C'est la
  // SEULE permission de developer_api dans toute la coquille : sans elle, ce
  // rôle n'a aucun écran, alors que le palier Pro le débloque explicitement.
  it("les clés API sont la seule surface de developer_api", () => {
    expect(permissionsFor("developer_api")).toEqual(["organization:api_keys"]);
    expect(hasPermission("cashier", "organization:api_keys")).toBe(false);
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
