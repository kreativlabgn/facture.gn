import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { UnconfiguredOcrTextExtractionProvider } from "./ocr-text-extraction.provider";

describe("UnconfiguredOcrTextExtractionProvider", () => {
  it("répond 503 explicite tant qu'aucun point d'inférence n'est câblé — jamais un job silencieusement bloqué", async () => {
    await expect(new UnconfiguredOcrTextExtractionProvider().extraire()).rejects.toThrow(ServiceUnavailableException);
  });
});
