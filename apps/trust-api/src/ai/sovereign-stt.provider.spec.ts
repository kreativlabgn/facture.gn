import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnconfiguredSttProvider } from "./stt.provider";
import {
  OCR_STT_REQUEST_TIMEOUT_MS,
  SovereignSttProvider,
  sttProviderFromEnv,
} from "./sovereign-stt.provider";

const CONFIG = { endpoint: "https://stt.facture.gn", token: "jeton-souverain" };
const AUDIO = { storageKey: "audio-notes/org-1/note.ogg", mimeType: "audio/ogg" as const };

function reponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SovereignSttProvider.transcrire", () => {
  it("relaie la RÉFÉRENCE audio au point de transcription, jamais des octets, avec le jeton en Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "whisper-gn-2026.09", texte: "deux sacs de riz" }));
    vi.stubGlobal("fetch", fetchMock);

    await new SovereignSttProvider(CONFIG).transcrire(AUDIO);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://stt.facture.gn/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer jeton-souverain");
    expect(JSON.parse(init.body)).toEqual({ storageKey: AUDIO.storageKey, mimeType: "audio/ogg" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rend l'identifiant de modèle et le texte transcrit tel quel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ modelId: "whisper-gn-2026.09", texte: "deux sacs de riz à 50000" })));

    const resultat = await new SovereignSttProvider(CONFIG).transcrire(AUDIO);

    expect(resultat.modelId).toBe("whisper-gn-2026.09");
    expect(resultat.texte).toBe("deux sacs de riz à 50000");
  });

  it("lève 503 sur un statut non-2xx, sans relayer le corps de la réponse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ echo: "Boutique Aissatou 15000000" }, { ok: false, status: 502 })));

    const erreur = await new SovereignSttProvider(CONFIG).transcrire(AUDIO).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ServiceUnavailableException);
    expect((erreur as Error).message).toContain("502");
    expect((erreur as Error).message).not.toContain("Aissatou");
  });

  it("lève 503 quand le point de transcription est injoignable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(new SovereignSttProvider(CONFIG).transcrire(AUDIO)).rejects.toThrow(ServiceUnavailableException);
  });

  it("abandonne après le budget de requête et lève 503", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            });
          }),
      ),
    );

    const promesse = new SovereignSttProvider(CONFIG).transcrire(AUDIO);
    const attente = expect(promesse).rejects.toThrow(/délai dépassé/);
    await vi.advanceTimersByTimeAsync(OCR_STT_REQUEST_TIMEOUT_MS + 1);
    await attente;
  });

  it("lève 503 sur une enveloppe sans modelId — la traçabilité de souveraineté n'est pas optionnelle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ texte: "deux sacs de riz" })));

    await expect(new SovereignSttProvider(CONFIG).transcrire(AUDIO)).rejects.toThrow(ServiceUnavailableException);
  });

  it("lève 503 sur une enveloppe sans texte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ modelId: "whisper-gn-2026.09" })));

    await expect(new SovereignSttProvider(CONFIG).transcrire(AUDIO)).rejects.toThrow(ServiceUnavailableException);
  });

  it("lève 503 sur un corps qui n'est pas du JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }),
    );

    await expect(new SovereignSttProvider(CONFIG).transcrire(AUDIO)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe("sttProviderFromEnv", () => {
  it("sans OCR_STT_ENDPOINT, garde l'implémentation non configurée (503 explicite)", () => {
    expect(sttProviderFromEnv({})).toBeInstanceOf(UnconfiguredSttProvider);
    expect(sttProviderFromEnv({ OCR_STT_ENDPOINT: "   " })).toBeInstanceOf(UnconfiguredSttProvider);
  });

  it("avec endpoint et jeton, câble le connecteur souverain et retire la barre finale", async () => {
    const provider = sttProviderFromEnv({ OCR_STT_ENDPOINT: "https://stt.facture.gn/", OCR_STT_TOKEN: "t" });
    expect(provider).toBeInstanceOf(SovereignSttProvider);

    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "m", texte: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    await provider.transcrire(AUDIO);
    expect(fetchMock.mock.calls[0][0]).toBe("https://stt.facture.gn/transcriptions");
  });

  it("refuse de démarrer avec un endpoint sans jeton — une configuration à moitié faite se voit au déploiement", () => {
    expect(() => sttProviderFromEnv({ OCR_STT_ENDPOINT: "https://stt.facture.gn" })).toThrow(/OCR_STT_TOKEN/);
  });
});
