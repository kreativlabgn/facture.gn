import { describe, expect, it } from "vitest";
import { scanAudioSchema } from "./scan-audio.dto";

const ORG = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);

const COMMANDE = {
  organizationId: ORG,
  audioSha256: SHA,
  storageKey: "audio-notes/2026/09/note-0001.ogg",
  mimeType: "audio/ogg",
};

describe("scanAudioSchema (plan 2026-09-16, OCR multicanal)", () => {
  it("accepte une commande complète", () => {
    const parsed = scanAudioSchema.parse(COMMANDE);
    expect(parsed).toEqual(COMMANDE);
  });

  it("accepte les quatre types MIME audio prévus", () => {
    for (const mimeType of ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm"] as const) {
      expect(scanAudioSchema.parse({ ...COMMANDE, mimeType }).mimeType).toBe(mimeType);
    }
  });

  it("refuse un audioSha256 mal formé", () => {
    for (const audioSha256 of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "", "pas-du-hex"]) {
      expect(scanAudioSchema.safeParse({ ...COMMANDE, audioSha256 }).success, `« ${audioSha256} » aurait dû être refusé`).toBe(
        false,
      );
    }
  });

  it("refuse un mimeType hors liste", () => {
    expect(scanAudioSchema.safeParse({ ...COMMANDE, mimeType: "image/jpeg" }).success).toBe(false);
    expect(scanAudioSchema.safeParse({ ...COMMANDE, mimeType: "video/mp4" }).success).toBe(false);
  });

  it("refuse un organizationId qui n'est pas un uuid", () => {
    expect(scanAudioSchema.safeParse({ ...COMMANDE, organizationId: "pas-un-uuid" }).success).toBe(false);
  });

  it("refuse un storageKey vide", () => {
    expect(scanAudioSchema.safeParse({ ...COMMANDE, storageKey: "" }).success).toBe(false);
  });
});
