import { describe, expect, it } from "vitest";
import { isCashProofRequirementMet } from "./cash-proof-requirement";

describe("isCashProofRequirementMet (G3, ADR-091 — seuil de preuve effectif)", () => {
  it("n'exige aucune preuve sous le seuil effectif", () => {
    const met = isCashProofRequirementMet({
      amount: 50_000_000n,
      effectiveThresholdGnfCentimes: 100_000_000n,
    });

    expect(met).toBe(true);
  });

  it("exige les 4 champs de preuve au-delà du seuil effectif", () => {
    const met = isCashProofRequirementMet({
      amount: 150_000_000n,
      effectiveThresholdGnfCentimes: 100_000_000n,
    });

    expect(met).toBe(false);
  });

  it("accepte un montant au-delà du seuil effectif si les 4 champs de preuve sont fournis", () => {
    const met = isCashProofRequirementMet({
      amount: 150_000_000n,
      effectiveThresholdGnfCentimes: 100_000_000n,
      proofPhotoUrl: "https://storage.facture.gn/proofs/inv-1.jpg",
      proofGpsLat: 9.535,
      proofGpsLng: -13.6785,
      proofSignature: "data:image/svg+xml;base64,PHN2Zy8+",
    });

    expect(met).toBe(true);
  });

  it("rejette une preuve partielle au-delà du seuil effectif", () => {
    const met = isCashProofRequirementMet({
      amount: 150_000_000n,
      effectiveThresholdGnfCentimes: 100_000_000n,
      proofPhotoUrl: "https://storage.facture.gn/proofs/inv-1.jpg",
    });

    expect(met).toBe(false);
  });

  it("suit le seuil effectif abaissé (Niveau 2, ADR-091) — un montant accepté au seuil global peut exiger une preuve au seuil abaissé", () => {
    const met = isCashProofRequirementMet({
      amount: 60_000_000n,
      effectiveThresholdGnfCentimes: 50_000_000n,
    });

    expect(met).toBe(false);
  });
});
