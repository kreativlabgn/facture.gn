import { describe, expect, it } from "vitest";
import { generateRevenueShareSchema } from "./generate-revenue-share.dto";

describe("generateRevenueShareSchema", () => {
  it("accepte une demande sans periodMonth", () => {
    const result = generateRevenueShareSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepte un periodMonth au format YYYY-MM valide", () => {
    const result = generateRevenueShareSchema.safeParse({ periodMonth: "2026-08" });
    expect(result.success).toBe(true);
  });

  it("rejette un periodMonth mal formé", () => {
    const result = generateRevenueShareSchema.safeParse({ periodMonth: "08-2026" });
    expect(result.success).toBe(false);
  });

  it("rejette un mois hors 01-12", () => {
    const result = generateRevenueShareSchema.safeParse({ periodMonth: "2026-13" });
    expect(result.success).toBe(false);
  });
});
