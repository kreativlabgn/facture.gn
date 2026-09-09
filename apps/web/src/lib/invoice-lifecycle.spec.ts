import { describe, expect, it } from "vitest";
import { etapesDuCycle, type FactureCycleDeVie } from "./invoice-lifecycle";

// Facture émise ordinaire : rien de déposé, rien d'approuvé, pas de litige,
// pas encore encaissée. C'est le cas de départ dont chaque test ne change
// qu'une chose — sans ça, un test qui passe ne dirait pas laquelle.
const EMISE: FactureCycleDeVie = {
  status: "issued",
  disputeStatus: "none",
  validatedByAdministration: false,
  etaxStatus: null,
  etaxReceiptNumber: null,
};

function cles(facture: FactureCycleDeVie): string[] {
  return etapesDuCycle(facture).map((etape) => etape.cle);
}

describe("etapesDuCycle — les quatre statuts interopérables", () => {
  it("une facture émise sans rien d'autre ne porte aucune étape", () => {
    expect(cles(EMISE)).toEqual([]);
  });

  // « Déposée » veut dire que la DGI a ACQUITTÉ, pas que la file a avalé la
  // facture. Le reçu est la preuve ; sans lui, il n'y a qu'une intention.
  it("« Déposée » exige un acquittement DGI, jamais une simple mise en file", () => {
    expect(cles({ ...EMISE, etaxStatus: "pending" })).toEqual([]);
    expect(cles({ ...EMISE, etaxStatus: "failed" })).toEqual([]);
    expect(cles({ ...EMISE, etaxStatus: "transmitted", etaxReceiptNumber: "DGI-2026-0001" })).toEqual([
      "deposee",
    ]);
  });

  // Un statut « transmitted » sans reçu est une incohérence de données : le
  // processeur écrit les deux ensemble. On ne l'annonce pas comme un dépôt —
  // le reçu est ce que le commerçant devra produire en cas de contrôle.
  it("ne déclare jamais « Déposée » sans numéro de reçu", () => {
    expect(cles({ ...EMISE, etaxStatus: "transmitted", etaxReceiptNumber: null })).toEqual([]);
  });

  it("« Approuvée » suit validatedByAdministration", () => {
    expect(cles({ ...EMISE, validatedByAdministration: true })).toEqual(["approuvee"]);
  });

  it("« Litige » suit dispute_status = disputed, jamais resolved", () => {
    expect(cles({ ...EMISE, disputeStatus: "disputed" })).toEqual(["litige"]);
    expect(cles({ ...EMISE, disputeStatus: "resolved" })).toEqual([]);
  });

  it("« Encaissée » ne vaut que pour une facture soldée, jamais partiellement payée", () => {
    expect(cles({ ...EMISE, status: "paid" })).toEqual(["encaissee"]);
    expect(cles({ ...EMISE, status: "partially_paid" })).toEqual([]);
  });

  // LE cas qui interdit un badge unique : les quatre axes sont orthogonaux.
  // Une facture peut être déposée, approuvée, encaissée ET contestée — c'est
  // même la situation qui appelle le plus une décision du commerçant.
  it("cumule les étapes, dans l'ordre du parcours légal", () => {
    expect(
      cles({
        status: "paid",
        disputeStatus: "disputed",
        validatedByAdministration: true,
        etaxStatus: "transmitted",
        etaxReceiptNumber: "DGI-2026-0001",
      }),
    ).toEqual(["deposee", "approuvee", "litige", "encaissee"]);
  });

  // Une facture annulée n'est ni encaissée ni approuvée aux yeux du lecteur :
  // afficher « Approuvée » sur un document annulé serait un contresens.
  it("une facture annulée ne porte plus aucune étape", () => {
    expect(
      cles({
        status: "voided",
        disputeStatus: "disputed",
        validatedByAdministration: true,
        etaxStatus: "transmitted",
        etaxReceiptNumber: "DGI-2026-0001",
      }),
    ).toEqual([]);
  });

  // Un brouillon n'est encore rien : ni déposé, ni approuvé. Le protéger ici
  // évite qu'une colonne écrite par erreur en amont ne s'affiche.
  it("un brouillon ne porte aucune étape", () => {
    expect(cles({ ...EMISE, status: "draft", validatedByAdministration: true })).toEqual([]);
  });

  it("chaque étape porte un libellé et une explication non vides", () => {
    const etapes = etapesDuCycle({
      status: "paid",
      disputeStatus: "disputed",
      validatedByAdministration: true,
      etaxStatus: "transmitted",
      etaxReceiptNumber: "DGI-2026-0001",
    });

    expect(etapes).toHaveLength(4);
    for (const etape of etapes) {
      expect(etape.label.length).toBeGreaterThan(0);
      expect(etape.aide.length).toBeGreaterThan(0);
    }
  });

  // Le litige est le seul qui appelle une action : il ouvre l'avoir
  // rectificatif. C'est ce drapeau que l'écran de détail lit pour proposer le
  // module — jamais une comparaison de chaîne recopiée dans le JSX.
  it("seul le litige est marqué comme appelant une action", () => {
    const etapes = etapesDuCycle({
      status: "paid",
      disputeStatus: "disputed",
      validatedByAdministration: true,
      etaxStatus: "transmitted",
      etaxReceiptNumber: "DGI-2026-0001",
    });

    expect(etapes.filter((etape) => etape.appelleUneAction).map((etape) => etape.cle)).toEqual(["litige"]);
  });
});
