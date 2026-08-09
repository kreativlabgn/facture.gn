import { describe, expect, it } from "vitest";
import { generateAccountCode } from "./account-code";

describe("generateAccountCode (B5, ADR-046/047)", () => {
  it("génère un code de 8 caractères en alphabet Base32 (A-Z2-7, sans padding)", () => {
    const code = generateAccountCode();

    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z2-7]{8}$/);
  });

  it("génère des codes différents à chaque appel", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateAccountCode()));

    expect(codes.size).toBe(20);
  });
});
