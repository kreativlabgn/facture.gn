import { describe, expect, it } from "vitest";
import { buildInvoiceDocDefinition, type InvoiceRenderInput } from "./document-renderer";
import { formatGnf } from "./money-format";

// ADR-108 — BANC D'ESSAI DES DEUX RÉGIMES DE SAISIE.
//
// Les deux factures décrites ici portent EXACTEMENT les mêmes montants scellés :
// 1 000 000 GNF HT, 180 000 GNF de TVA, 1 180 000 GNF TTC. Seule change la
// manière dont leurs lignes ont été saisies — TTC pour la PWA, HT pour Odoo via
// la passerelle PDP. C'est précisément ce qui rend le test utile : tout écart
// observé entre les deux rendus vient du régime, et de rien d'autre.
//
// Ce que le banc VÉRIFIE, au fond : qu'un lecteur puisse refaire l'addition du
// tableau de tête et retomber sur le sous-total affiché. C'est ça, le
// « micro-écart visuel » de l'ADR — pas une erreur de calcul, mais un tableau
// dont les lignes ne se somment pas en ce que leur en-tête annonce.

const CENTIMES_HT = BigInt(100_000_000); // 1 000 000 GNF
const CENTIMES_TVA = BigInt(18_000_000); //   180 000 GNF
const CENTIMES_TTC = BigInt(118_000_000); // 1 180 000 GNF

function base(): Omit<InvoiceRenderInput, "lines"> {
  return {
    organization: { name: "Entreprise Camara & Fils", nif: "123456789", rccm: "GN-KAL-2024-B-001" },
    customer: { name: "SOGUIPAH SA", nif: "987654321" },
    number: "FG-2026-000042",
    issuedAt: new Date("2026-09-09T10:00:00.000Z"),
    certificationId: "GN-12345678-2026-ABC123",
    status: "issued",
    discountPct: 0,
    totalHt: CENTIMES_HT,
    totalTva: CENTIMES_TVA,
    totalTtc: CENTIMES_TTC,
    legalMentions: ["TVA au taux normal de 18 %."],
    verificationUrl: "https://facture.gn/verify/GN-12345678-2026-ABC123",
    qrDataUrl: "data:image/png;base64,AAAA",
    untdidTypeCode: "380",
    b2gReferences: [],
  };
}

/** Facture Odoo entrée par la passerelle PDP : 2 × 500 000 GNF HORS TAXES.
 *  Σ lignes = 1 000 000 GNF = le total HT scellé. */
function factureOdoo(): InvoiceRenderInput {
  return {
    ...base(),
    lines: [
      {
        description: "Prestation de conseil",
        quantity: 2,
        unitPrice: BigInt(50_000_000),
        saisieRegime: "HT_FIRST",
      },
    ],
  };
}

/** Facture PWA : 2 × 590 000 GNF TTC. Σ lignes = 1 180 000 GNF = le total TTC
 *  scellé. Mêmes totaux généraux que la facture Odoo ci-dessus. */
function facturePwa(): InvoiceRenderInput {
  return {
    ...base(),
    lines: [
      {
        description: "Prestation de conseil",
        quantity: 2,
        unitPrice: BigInt(59_000_000),
        saisieRegime: "TTC_FIRST",
      },
    ],
  };
}

// pdfmake imbrique content/columns/table/stack sans schéma stable : on aplatit
// pour interroger le document par ce qu'il AFFICHE, jamais par un chemin
// d'indices qui se casserait au moindre remaniement de mise en page.
function textesDe(doc: unknown): string[] {
  const trouves: string[] = [];
  const visiter = (noeud: unknown): void => {
    if (Array.isArray(noeud)) {
      noeud.forEach(visiter);
      return;
    }
    if (noeud === null || typeof noeud !== "object") {
      return;
    }
    for (const [cle, valeur] of Object.entries(noeud as Record<string, unknown>)) {
      if (cle === "text" && typeof valeur === "string") {
        trouves.push(valeur);
      } else {
        visiter(valeur);
      }
    }
  };
  visiter(doc);
  return trouves;
}

/** La ligne du récapitulatif qui suit un libellé donné — c'est le couple
 *  (libellé, montant) qu'un lecteur voit, pas leurs positions absolues. */
function montantApres(textes: string[], libelle: string): string | undefined {
  const index = textes.indexOf(libelle);
  return index === -1 ? undefined : textes[index + 1];
}

/** Une ligne du TABLEAU, repérée par sa désignation : les trois cellules qui la
 *  suivent sont quantité, prix unitaire, montant — dans cet ordre. */
function ligneDuTableau(
  textes: string[],
  description: string,
): { quantite?: string; prixUnitaire?: string; montant?: string } {
  const index = textes.indexOf(description);
  if (index === -1) {
    return {};
  }
  return {
    quantite: textes[index + 1],
    prixUnitaire: textes[index + 2],
    montant: textes[index + 3],
  };
}

describe("ADR-108 — rendu d'une facture HT_FIRST (Odoo / passerelle PDP)", () => {
  const textes = textesDe(buildInvoiceDocDefinition(factureOdoo()));

  it("intitule les colonnes en HT, jamais en TTC", () => {
    expect(textes).toContain("P.U. HT");
    expect(textes).toContain("Montant HT");
    expect(textes).not.toContain("P.U. TTC");
    expect(textes).not.toContain("Montant TTC");
  });

  // LE TEST CENTRAL DE L'ADR. Avant le correctif, le sous-total valait bien
  // 1 000 000 GNF — mais s'annonçait « Sous-total TTC » alors que le total TTC
  // affiché douze lignes plus bas valait 1 180 000. Deux montants contradictoires
  // sous la même étiquette : le micro-écart visuel.
  it("somme les lignes en un sous-total HT que le lecteur peut refaire de tête", () => {
    expect(textes).toContain("Sous-total HT");
    expect(montantApres(textes, "Sous-total HT")).toBe(formatGnf(CENTIMES_HT));
    expect(textes).not.toContain("Sous-total TTC");

    // 2 × 500 000 = 1 000 000 : l'addition du tableau retombe exactement sur le
    // sous-total annoncé. C'est ce que « refaire de tête » veut dire, et c'est
    // ce qui était impossible avant l'ADR-108.
    const ligne = ligneDuTableau(textes, "Prestation de conseil");
    expect(ligne.quantite).toBe("2");
    expect(ligne.prixUnitaire).toBe(formatGnf(BigInt(50_000_000)));
    expect(ligne.montant).toBe(formatGnf(BigInt(2) * BigInt(50_000_000)));
    expect(ligne.montant).toBe(montantApres(textes, "Sous-total HT"));
  });

  it("isole la TVA au lieu de la dérouler à rebours", () => {
    expect(textes).toContain("TVA");
    expect(montantApres(textes, "TVA")).toBe(formatGnf(CENTIMES_TVA));
    // « dont HT » / « dont TVA » est la lecture inverse, réservée au régime TTC.
    expect(textes).not.toContain("dont HT");
    expect(textes).not.toContain("dont TVA");
  });

  it("clôt sur le total TTC scellé, inchangé", () => {
    expect(montantApres(textes, "Total TTC")).toBe(formatGnf(CENTIMES_TTC));
  });
});

describe("ADR-108 — rendu d'une facture TTC_FIRST (PWA), non régressé", () => {
  const textes = textesDe(buildInvoiceDocDefinition(facturePwa()));

  it("conserve les intitulés TTC historiques", () => {
    expect(textes).toContain("P.U. TTC");
    expect(textes).toContain("Montant TTC");
    expect(textes).toContain("Sous-total TTC");
  });

  it("somme les lignes en un sous-total TTC, comme avant l'ADR-108", () => {
    const ligne = ligneDuTableau(textes, "Prestation de conseil");
    expect(ligne.quantite).toBe("2");
    expect(ligne.prixUnitaire).toBe(formatGnf(BigInt(59_000_000)));
    expect(ligne.montant).toBe(formatGnf(BigInt(2) * BigInt(59_000_000)));
    expect(ligne.montant).toBe(montantApres(textes, "Sous-total TTC"));
  });

  it("conserve l'extraction à rebours du HT et de la TVA", () => {
    expect(montantApres(textes, "Sous-total TTC")).toBe(formatGnf(CENTIMES_TTC));
    expect(montantApres(textes, "Total TTC")).toBe(formatGnf(CENTIMES_TTC));
    expect(montantApres(textes, "dont HT")).toBe(formatGnf(CENTIMES_HT));
    expect(montantApres(textes, "dont TVA")).toBe(formatGnf(CENTIMES_TVA));
    expect(textes).not.toContain("Sous-total HT");
  });
});

// ── L'invariant qui vaut plus que les deux jeux pris séparément ──────────────
describe("ADR-108 — les totaux scellés ne bougent pas d'un régime à l'autre", () => {
  const odoo = textesDe(buildInvoiceDocDefinition(factureOdoo()));
  const pwa = textesDe(buildInvoiceDocDefinition(facturePwa()));

  // Une facture certifiée est signée sur ses totaux (Ed25519). Si un jour ce
  // rendu se mettait à recalculer au lieu d'afficher, c'est ce test qui
  // tomberait — avant qu'un PDF ne contredise la signature qu'il porte.
  it("affiche le même Total TTC des deux côtés", () => {
    expect(montantApres(odoo, "Total TTC")).toBe(formatGnf(CENTIMES_TTC));
    expect(montantApres(pwa, "Total TTC")).toBe(formatGnf(CENTIMES_TTC));
  });

  it("affiche la même TVA des deux côtés, sous deux libellés distincts", () => {
    expect(montantApres(odoo, "TVA")).toBe(formatGnf(CENTIMES_TVA));
    expect(montantApres(pwa, "dont TVA")).toBe(formatGnf(CENTIMES_TVA));
  });

  it("affiche le même HT des deux côtés, sous deux libellés distincts", () => {
    expect(montantApres(odoo, "Sous-total HT")).toBe(formatGnf(CENTIMES_HT));
    expect(montantApres(pwa, "dont HT")).toBe(formatGnf(CENTIMES_HT));
  });

  // Les deux documents ne diffèrent QUE par le récapitulatif et les en-têtes :
  // même numéro, même certification, même client. Le régime de saisie ne fuit
  // nulle part ailleurs dans le PDF.
  it("ne modifie rien hors du tableau et de son récapitulatif", () => {
    for (const attendu of [
      "FACTURE",
      "N° FG-2026-000042",
      "SOGUIPAH SA",
      "Réf. de certification : GN-12345678-2026-ABC123",
      "Prestation de conseil",
    ]) {
      expect(odoo).toContain(attendu);
      expect(pwa).toContain(attendu);
    }
  });
});

describe("ADR-108 — cas limites du régime de tableau", () => {
  // Aucun en-tête ne peut annoncer deux unités à la fois. Plutôt que de mentir
  // sur la moitié des lignes, on n'affirme rien.
  it("retombe sur des libellés neutres si les lignes divergent", () => {
    const mixte = textesDe(
      buildInvoiceDocDefinition({
        ...base(),
        lines: [
          { description: "Ligne PWA", quantity: 1, unitPrice: BigInt(59_000_000), saisieRegime: "TTC_FIRST" },
          { description: "Ligne ERP", quantity: 1, unitPrice: BigInt(50_000_000), saisieRegime: "HT_FIRST" },
        ],
      }),
    );

    expect(mixte).toContain("P.U.");
    expect(mixte).toContain("Montant");
    expect(mixte).not.toContain("P.U. HT");
    expect(mixte).not.toContain("P.U. TTC");
    // Le récapitulatif garde le déroulé historique : un tableau mixte n'est pas
    // une facture HT.
    expect(mixte).toContain("Sous-total TTC");
  });

  // Une remise globale se lit dans l'unité du régime. Comparer une somme de
  // lignes HT au total TTC afficherait un écart qui n'est pas une remise —
  // ici, un « - 180 000 GNF » sorti de nulle part.
  it("n'invente pas de remise sur une facture HT sans remise", () => {
    const textes = textesDe(buildInvoiceDocDefinition({ ...factureOdoo(), discountPct: 0 }));
    expect(textes.some((t) => t.startsWith("- "))).toBe(false);
    expect(textes.some((t) => t.startsWith("Remise"))).toBe(false);
  });

  it("chiffre une remise HT sur le total HT, pas sur le TTC", () => {
    // 2 × 500 000 = 1 000 000 brut, 900 000 net après 10 % : la remise vaut
    // 100 000 GNF, jamais l'écart au TTC.
    const textes = textesDe(
      buildInvoiceDocDefinition({
        ...factureOdoo(),
        discountPct: 10,
        totalHt: BigInt(90_000_000),
        totalTva: BigInt(16_200_000),
        totalTtc: BigInt(106_200_000),
      }),
    );

    expect(textes).toContain("Remise (10 %)");
    expect(montantApres(textes, "Remise (10 %)")).toBe(`- ${formatGnf(BigInt(10_000_000))}`);
  });
});
