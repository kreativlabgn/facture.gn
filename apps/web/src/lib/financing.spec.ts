import { describe, expect, it } from "vitest";
import {
  DISBURSEMENT_METHODS,
  doitInterrogerLesRails,
  etatArbitrage,
  netVerseALaPme,
} from "./financing";

// Ces tests verrouillent les règles d'AFFICHAGE de l'arbitrage des rails
// (ADR-088/089). Aucun n'a besoin du réseau : trust-api reste seul juge de
// l'autorisation et de l'éligibilité, et c'est justement ce que ces cas
// figent — l'écran ne recopie ni l'une ni l'autre, il les CONSOMME.

function facture(
  overrides: {
    status?: string;
    disputeStatus?: string;
    financedByPartnerId?: string | null;
  } = {},
) {
  return {
    status: overrides.status ?? "issued",
    disputeStatus: overrides.disputeStatus ?? "none",
    financedByPartnerId: overrides.financedByPartnerId ?? null,
  };
}

describe("doitInterrogerLesRails — ne payer l'aller-retour que s'il peut servir", () => {
  // financing.controller.ts : les deux routes sont @Roles("owner","admin").
  // Les appeler pour un autre rôle ne rapporterait qu'un 403.
  it("n'interroge jamais la route pour un rôle qui n'y a pas droit", () => {
    for (const role of ["cashier", "accountant_internal", "field_agent", "viewer"]) {
      expect(doitInterrogerLesRails(role, facture())).toBe(false);
    }
  });

  it("interroge la route pour owner/admin sur une facture vivante", () => {
    for (const role of ["owner", "admin"]) {
      expect(doitInterrogerLesRails(role, facture({ status: "issued" }))).toBe(true);
    }
  });

  it("n'interroge pas la route sur une facture payée ou annulée jamais financée", () => {
    expect(doitInterrogerLesRails("owner", facture({ status: "paid" }))).toBe(false);
    expect(doitInterrogerLesRails("owner", facture({ status: "voided" }))).toBe(false);
  });

  // Le nom du cessionnaire ne vient QUE de cette route : y renoncer sur une
  // facture soldée reviendrait à afficher un uuid à la place d'« Ecobank » le
  // jour où le Trésor règle — exactement quand la question « à qui va
  // l'argent ? » se pose.
  it("interroge la route sur une facture cédée, même payée ou annulée", () => {
    expect(doitInterrogerLesRails("owner", facture({ status: "paid", financedByPartnerId: "p-1" }))).toBe(true);
    expect(doitInterrogerLesRails("owner", facture({ status: "voided", financedByPartnerId: "p-1" }))).toBe(true);
  });
});

describe("etatArbitrage — ce que l'écran rend, et ce qu'il ne rend pas", () => {
  it("masque tout pour un rôle sans droit de financement, même une facture finançable", () => {
    for (const role of ["cashier", "accountant_internal", "viewer"]) {
      expect(etatArbitrage({ role, invoice: facture(), financeable: true })).toBe("masque");
    }
  });

  it("ouvre l'arbitrage quand trust-api dit la facture finançable", () => {
    expect(etatArbitrage({ role: "owner", invoice: facture(), financeable: true })).toBe("ouvert");
    expect(etatArbitrage({ role: "admin", invoice: facture(), financeable: true })).toBe("ouvert");
  });

  // Le verdict n'est jamais reconstitué côté web : sans réponse de trust-api,
  // on ne PROPOSE pas — on ne devine pas non plus dans l'autre sens.
  it("masque l'arbitrage quand le verdict d'éligibilité manque ou est négatif", () => {
    expect(etatArbitrage({ role: "owner", invoice: facture(), financeable: false })).toBe("masque");
    expect(etatArbitrage({ role: "owner", invoice: facture(), financeable: null })).toBe("masque");
  });

  it("masque l'arbitrage sur une facture payée ou annulée jamais financée", () => {
    expect(etatArbitrage({ role: "owner", invoice: facture({ status: "paid" }), financeable: true })).toBe(
      "masque",
    );
    expect(etatArbitrage({ role: "owner", invoice: facture({ status: "voided" }), financeable: true })).toBe(
      "masque",
    );
  });

  // K5, ADR-089 — L'INVARIANT ANTI-DOUBLE-FINANCEMENT VU DE L'ÉCRAN.
  // Dès que financedByPartnerId est renseigné, le formulaire ne doit plus
  // exister dans l'arbre rendu, quel que soit le reste de l'état.
  it("bascule sur la confirmation dès qu'une cession existe, quoi que dise l'éligibilité", () => {
    for (const financeable of [true, false, null]) {
      expect(
        etatArbitrage({ role: "owner", invoice: facture({ financedByPartnerId: "p-1" }), financeable }),
      ).toBe("cedee");
    }
  });

  // « Badge de confirmation PERMANENT » au sens propre : une créance cédée puis
  // réglée par le Trésor reste une créance qui appartient à un tiers. Effacer
  // cette ligne le jour du paiement retirerait au commerçant la seule
  // information qui dit où va l'argent.
  it("garde la confirmation de cession sur une facture payée ou annulée", () => {
    expect(
      etatArbitrage({
        role: "owner",
        invoice: facture({ status: "paid", financedByPartnerId: "p-1" }),
        financeable: false,
      }),
    ).toBe("cedee");
    expect(
      etatArbitrage({
        role: "owner",
        invoice: facture({ status: "voided", financedByPartnerId: "p-1" }),
        financeable: false,
      }),
    ).toBe("cedee");
  });
});

describe("Rail A — ce que la PME reçoit (ADR-089)", () => {
  // Le pendant côté PME des deux tests de lib/daf.spec.ts. La fonction est
  // partagée, mais l'invariant se joue ici : c'est cet écran qui ANNONCE
  // « 100 % du total certifié » avant que le commerçant ne signe.
  it("verse 100 % du total certifié — aucun frais déduit du marchand", () => {
    expect(netVerseALaPme({ totalTtc: "125000000" })).toBe("125000000");
  });

  it("ne dépend d'aucun autre champ que le total certifié", () => {
    expect(netVerseALaPme({ totalTtc: "1" })).toBe("1");
    expect(netVerseALaPme({ totalTtc: "0" })).toBe("0");
  });
});

describe("Modes de versement — miroir du DTO de trust-api", () => {
  // choose-financing.dto.ts : z.enum(["payment_link_payout", "bank_transfer"]).
  // Une option affichée hors de cette énumération produirait un 400 de schéma,
  // que le commerçant lirait comme une panne.
  it("ne propose que les valeurs acceptées par chooseFinancingSchema", () => {
    expect(DISBURSEMENT_METHODS.map((methode) => methode.value)).toEqual([
      "payment_link_payout",
      "bank_transfer",
    ]);
  });

  it("donne un libellé et une aide à chaque mode", () => {
    for (const methode of DISBURSEMENT_METHODS) {
      expect(methode.label.length).toBeGreaterThan(0);
      expect(methode.aide.length).toBeGreaterThan(0);
    }
  });

  // ── ADR-121 — le litige ferme l'arbitrage à l'écran ──────────────────────

  it("masque l'arbitrage sur une facture contestée, bien qu'elle soit émise et déclarée finançable", () => {
    // Le cas qui rendait le correctif nécessaire : `status` vaut "issued", donc
    // le Set des statuts morts ne l'attrape pas. Seul `disputeStatus` le dit.
    expect(
      etatArbitrage({
        role: "owner",
        invoice: facture({ status: "issued", disputeStatus: "disputed" }),
        financeable: true,
      }),
    ).toBe("masque");
  });

  it("rouvre l'arbitrage une fois le litige résolu", () => {
    expect(
      etatArbitrage({
        role: "owner",
        invoice: facture({ disputeStatus: "resolved" }),
        financeable: true,
      }),
    ).toBe("ouvert");
  });

  it("continue de nommer le cessionnaire d'une créance cédée PUIS contestée (K5 prime)", () => {
    // La cession prime les états morts, litige compris : effacer cette ligne le
    // jour où le client conteste retirerait au commerçant, au pire moment, la
    // seule information qui dit à qui va l'argent.
    expect(
      etatArbitrage({
        role: "owner",
        invoice: facture({ disputeStatus: "disputed", financedByPartnerId: "partner-1" }),
        financeable: false,
      }),
    ).toBe("cedee");
  });

  it("n'interroge pas les rails pour une facture contestée jamais cédée", () => {
    expect(
      doitInterrogerLesRails("owner", facture({ disputeStatus: "disputed" })),
    ).toBe(false);
  });

  it("interroge encore les rails d'une facture contestée DÉJÀ cédée — le nom du cessionnaire n'a pas d'autre source", () => {
    expect(
      doitInterrogerLesRails(
        "owner",
        facture({ disputeStatus: "disputed", financedByPartnerId: "partner-1" }),
      ),
    ).toBe(true);
  });
});
