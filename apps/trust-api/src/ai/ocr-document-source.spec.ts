import { describe, expect, it } from "vitest";
import type { OcrDocumentSource } from "@facture-gn/db";
import { emissionChannelForSource } from "./ocr-document-source";

// Exhaustif sur les 4 valeurs de OcrDocumentSource (plan 2026-09-16, OCR
// multicanal) : IMAGE_SCAN/AUDIO_PWA sont des actes PWA ; WHATSAPP_VOICE/
// WHATSAPP_TEXT sont des actes WhatsApp. Jamais deviné, jamais implicite.
const ATTENDU: Record<OcrDocumentSource, "pwa" | "whatsapp"> = {
  IMAGE_SCAN: "pwa",
  AUDIO_PWA: "pwa",
  WHATSAPP_VOICE: "whatsapp",
  WHATSAPP_TEXT: "whatsapp",
};

describe("emissionChannelForSource (plan 2026-09-16)", () => {
  it.each(Object.entries(ATTENDU) as [OcrDocumentSource, "pwa" | "whatsapp"][])(
    "pose %s → %s",
    (source, attendu) => {
      expect(emissionChannelForSource(source)).toBe(attendu);
    },
  );

  it("couvre exactement les 4 valeurs de l'enum, aucune de plus, aucune de moins", () => {
    expect(Object.keys(ATTENDU).sort()).toEqual(
      ["AUDIO_PWA", "IMAGE_SCAN", "WHATSAPP_TEXT", "WHATSAPP_VOICE"].sort(),
    );
  });
});
