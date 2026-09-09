import { describe, expect, it } from "vitest";
import { createPdpInvoiceSchema } from "./create-pdp-invoice.dto";

const B2B_VALIDE = {
  clientUniqueId: "INV/2026/00042",
  transactionType: "b2b",
  totalHT: "1000000",
  totalVAT: "180000",
  issueDate: "2026-09-09T10:00:00.000Z",
  lines: [{ description: "Prestation de conseil", quantity: 2, unitPrice: "500000" }],
};

const B2C_VALIDE = {
  clientUniqueId: "TICKET-2026-09-09-0001",
  transactionType: "b2c",
  totalHT: "15000",
  totalVAT: "2700",
  issueDate: "2026-09-09T10:00:00.000Z",
};

describe("createPdpInvoiceSchema (ADR-107)", () => {
  it("accepte un document b2b complet et convertit les montants en centimes", () => {
    const parsed = createPdpInvoiceSchema.parse(B2B_VALIDE);

    expect(parsed.totalHT).toBe(BigInt(100_000_000));
    expect(parsed.totalVAT).toBe(BigInt(18_000_000));
    expect(parsed.lines?.[0].unitPrice).toBe(BigInt(50_000_000));
  });

  it("accepte un document b2c sans lignes (micro-vente de caisse)", () => {
    expect(createPdpInvoiceSchema.safeParse(B2C_VALIDE).success).toBe(true);
  });

  it("coerce issueDate en Date", () => {
    expect(createPdpInvoiceSchema.parse(B2B_VALIDE).issueDate).toBeInstanceOf(Date);
  });

  // LA garantie d'étanchéité du chemin public. L'organisation vient de la clé
  // API vérifiée par le garde, jamais du corps : un organizationId accepté ici
  // rouvrirait exactement l'IDOR que le garde ferme, et permettrait à un
  // connecteur d'une PME de déposer au nom d'une autre.
  it("ignore un organizationId glissé dans le corps — il ne peut jamais atteindre le service", () => {
    const parsed = createPdpInvoiceSchema.parse({ ...B2B_VALIDE, organizationId: "org-de-la-victime" });

    expect(parsed).not.toHaveProperty("organizationId");
  });

  it("refuse un clientUniqueId vide — il ferait converger tous les documents sans référence", () => {
    expect(createPdpInvoiceSchema.safeParse({ ...B2B_VALIDE, clientUniqueId: "" }).success).toBe(false);
  });

  it("refuse un type de transaction inconnu", () => {
    expect(createPdpInvoiceSchema.safeParse({ ...B2B_VALIDE, transactionType: "b2x" }).success).toBe(false);
  });

  // Un ERP qui envoie un `number` a déjà fait passer son montant par un flottant
  // avant que notre code ne s'exécute. Le refus est la seule façon d'obtenir le
  // montant que l'ERP a réellement calculé.
  it("refuse un montant transmis en nombre plutôt qu'en chaîne", () => {
    const resultat = createPdpInvoiceSchema.safeParse({ ...B2B_VALIDE, totalHT: 1_000_000 });

    expect(resultat.success).toBe(false);
  });

  it("refuse un montant à trois décimales, en relayant le message de toCentimes", () => {
    const resultat = createPdpInvoiceSchema.safeParse({ ...B2B_VALIDE, totalVAT: "180000.123" });

    expect(resultat.success).toBe(false);
    expect(JSON.stringify(resultat.error?.issues)).toContain("au plus 2 décimales");
  });

  it("refuse un document b2b sans lignes — une facture certifiée sans ligne ne s'émet pas", () => {
    const sansLignes = { ...B2B_VALIDE, lines: undefined };

    expect(createPdpInvoiceSchema.safeParse(sansLignes).success).toBe(false);
  });

  it("refuse un document b2g sans lignes, au même titre qu'un b2b", () => {
    const resultat = createPdpInvoiceSchema.safeParse({
      ...B2B_VALIDE,
      transactionType: "b2g",
      lines: undefined,
    });

    expect(resultat.success).toBe(false);
  });

  // Contrôle de cohérence, jamais un recalcul : on n'AJUSTE pas le total annoncé
  // par l'ERP. Un écart signifie que le connecteur et nous ne parlons pas du
  // même document — un 400 immédiat vaut mieux qu'une facture certifiée dont le
  // total ne correspond pas à ses lignes.
  it("refuse un totalHT qui n'est pas la somme des lignes", () => {
    const incoherent = {
      ...B2B_VALIDE,
      totalHT: "999999",
      lines: [{ description: "Prestation", quantity: 2, unitPrice: "500000" }],
    };

    expect(createPdpInvoiceSchema.safeParse(incoherent).success).toBe(false);
  });

  it("accepte un totalHT égal à la somme des lignes sur plusieurs lignes", () => {
    const coherent = {
      ...B2B_VALIDE,
      totalHT: "1300000",
      lines: [
        { description: "Prestation", quantity: 2, unitPrice: "500000" },
        { description: "Fournitures", quantity: 3, unitPrice: "100000" },
      ],
    };

    expect(createPdpInvoiceSchema.safeParse(coherent).success).toBe(true);
  });

  it("ne contrôle pas la cohérence des lignes pour un b2c, qui n'en a pas", () => {
    expect(createPdpInvoiceSchema.safeParse(B2C_VALIDE).success).toBe(true);
  });

  it("accepte les références B2G déclaratives sans les vérifier (ADR-090/109)", () => {
    const parsed = createPdpInvoiceSchema.parse({
      ...B2B_VALIDE,
      transactionType: "b2g",
      referenceMarche: "TELEMO-2026-014",
      numeroBonCommande: "BC-889",
      numeroEngagement: "ENG-2026-77",
    });

    expect(parsed.referenceMarche).toBe("TELEMO-2026-014");
    expect(parsed.numeroEngagement).toBe("ENG-2026-77");
  });

  it("accepte un client déclaré par libellés, sans identifiant de notre base", () => {
    const parsed = createPdpInvoiceSchema.parse({
      ...B2B_VALIDE,
      customer: { name: "Ministère de la Santé", nif: "123456789" },
    });

    expect(parsed.customer?.name).toBe("Ministère de la Santé");
  });

  it("refuse une quantité nulle ou fractionnaire", () => {
    for (const quantity of [0, -1, 1.5]) {
      const resultat = createPdpInvoiceSchema.safeParse({
        ...B2B_VALIDE,
        lines: [{ description: "Prestation", quantity, unitPrice: "500000" }],
      });
      expect(resultat.success).toBe(false);
    }
  });
});
