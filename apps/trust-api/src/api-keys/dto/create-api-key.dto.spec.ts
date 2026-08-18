import { describe, expect, it } from "vitest";
import { createApiKeySchema } from "./create-api-key.dto";

describe("createApiKeySchema", () => {
  it("accepte environment production", () => {
    const result = createApiKeySchema.safeParse({ environment: "production" });
    expect(result.success).toBe(true);
  });

  it("accepte environment sandbox", () => {
    const result = createApiKeySchema.safeParse({ environment: "sandbox" });
    expect(result.success).toBe(true);
  });

  it("rejette un environment hors énumération", () => {
    const result = createApiKeySchema.safeParse({ environment: "staging" });
    expect(result.success).toBe(false);
  });

  it("rejette une demande sans environment", () => {
    const result = createApiKeySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
