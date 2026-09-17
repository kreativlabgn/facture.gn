import { describe, expect, it } from "vitest";
import { setWhatsappOcrChannelSchema } from "./set-whatsapp-ocr-channel.dto";

describe("setWhatsappOcrChannelSchema (plan 2026-09-16, OCR multicanal, clarification 7)", () => {
  it("accepte enabled: true", () => {
    expect(setWhatsappOcrChannelSchema.safeParse({ enabled: true }).success).toBe(true);
  });

  it("accepte enabled: false", () => {
    expect(setWhatsappOcrChannelSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("rejette une commande sans enabled", () => {
    expect(setWhatsappOcrChannelSchema.safeParse({}).success).toBe(false);
  });

  it("rejette un enabled non booléen", () => {
    expect(setWhatsappOcrChannelSchema.safeParse({ enabled: "true" }).success).toBe(false);
  });
});
