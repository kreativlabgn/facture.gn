import { describe, expect, it } from "vitest";

import { resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("mappe pular → pular (seule langue locale active avec fr)", () => {
    expect(resolveLocale("pular")).toBe("pular");
  });

  it("mappe fr → fr", () => {
    expect(resolveLocale("fr")).toBe("fr");
  });

  it("retombe sur fr pour les langues pas encore traduites (malinke, soussou)", () => {
    expect(resolveLocale("malinke")).toBe("fr");
    expect(resolveLocale("soussou")).toBe("fr");
  });

  it("retombe sur fr quand la préférence est absente", () => {
    expect(resolveLocale(null)).toBe("fr");
    expect(resolveLocale(undefined)).toBe("fr");
  });
});
