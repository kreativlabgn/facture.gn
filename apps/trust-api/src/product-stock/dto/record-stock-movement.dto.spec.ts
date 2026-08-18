import { describe, expect, it } from "vitest";
import { recordStockMovementSchema } from "./record-stock-movement.dto";

describe("recordStockMovementSchema", () => {
  it("accepte reception avec un delta positif", () => {
    const result = recordStockMovementSchema.safeParse({ type: "reception", quantityDelta: 50 });
    expect(result.success).toBe(true);
  });

  it("accepte loss avec un delta négatif", () => {
    const result = recordStockMovementSchema.safeParse({ type: "loss", quantityDelta: -5 });
    expect(result.success).toBe(true);
  });

  it("rejette un type hors énumération", () => {
    const result = recordStockMovementSchema.safeParse({ type: "vol", quantityDelta: -5 });
    expect(result.success).toBe(false);
  });

  it("rejette un quantityDelta non entier", () => {
    const result = recordStockMovementSchema.safeParse({ type: "adjustment", quantityDelta: 1.5 });
    expect(result.success).toBe(false);
  });
});
