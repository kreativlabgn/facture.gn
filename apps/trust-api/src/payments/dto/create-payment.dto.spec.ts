import { describe, expect, it } from "vitest";
import { createPaymentSchema } from "./create-payment.dto";

// G3, ADR-091 — la règle de seuil de preuve (montant > seuil effectif ⇒ preuve
// obligatoire) a migré vers PaymentsService.assertCashProofRequirement() (voir
// payments.service.spec.ts) : ce schéma ne valide plus que la forme du payload,
// jamais le montant contre un seuil (qui dépend désormais de l'organisation).
describe("createPaymentSchema", () => {
  it("accepte un encaissement cash sans aucune preuve, quel que soit le montant", () => {
    const result = createPaymentSchema.safeParse({
      amount: "150000000", // 1 500 000 GNF en centimes
      method: "cash",
    });

    expect(result.success).toBe(true);
  });

  it("accepte un encaissement cash avec les 4 champs de preuve", () => {
    const result = createPaymentSchema.safeParse({
      amount: "150000000",
      method: "cash",
      proofPhotoUrl: "https://storage.facture.gn/proofs/inv-1.jpg",
      proofGpsLat: 9.535,
      proofGpsLng: -13.6785,
      proofSignature: "data:image/svg+xml;base64,PHN2Zy8+",
    });

    expect(result.success).toBe(true);
  });

  it("rejette une méthode autre que cash — bank_transfer et payment_link sont des stories distinctes", () => {
    const result = createPaymentSchema.safeParse({
      amount: "50000000",
      method: "bank_transfer",
    });

    expect(result.success).toBe(false);
  });
});
