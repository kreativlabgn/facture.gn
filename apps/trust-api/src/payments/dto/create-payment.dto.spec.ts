import { describe, expect, it } from "vitest";
import { createPaymentSchema } from "./create-payment.dto";

describe("createPaymentSchema", () => {
  it("rejette un encaissement cash > 1M GNF sans preuve photo/GPS/signature", () => {
    const result = createPaymentSchema.safeParse({
      amount: "150000000", // 1 500 000 GNF en centimes
      method: "cash",
    });

    expect(result.success).toBe(false);
  });

  it("accepte un encaissement cash > 1M GNF avec les 4 champs de preuve", () => {
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

  it("accepte un encaissement cash <= 1M GNF sans aucune preuve", () => {
    const result = createPaymentSchema.safeParse({
      amount: "50000000", // 500 000 GNF en centimes
      method: "cash",
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
