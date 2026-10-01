import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { UnconfiguredSttProvider } from "./stt.provider";

describe("UnconfiguredSttProvider", () => {
  it("répond 503 explicite tant qu'aucun point de transcription n'est câblé — jamais un job silencieusement bloqué", async () => {
    await expect(new UnconfiguredSttProvider().transcrire()).rejects.toThrow(ServiceUnavailableException);
  });
});
