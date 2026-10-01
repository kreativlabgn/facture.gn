import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnconfiguredOcrTextExtractionProvider } from "./ocr-text-extraction.provider";
import {
  OCR_TEXT_EXTRACTION_REQUEST_TIMEOUT_MS,
  SovereignOcrTextExtractionProvider,
  ocrTextExtractionProviderFromEnv,
} from "./sovereign-ocr-text-extraction.provider";

const CONFIG = { endpoint: "https://vision.facture.gn", token: "jeton-souverain" };
const TEXTE = { texte: "deux sacs de riz 50kg à 500000 GNF" };

const EXTRACTION = {
  saisieRegime: "HT_FIRST",
  lines: [{ description: "Sac de riz 50kg", quantity: 2, unitPrice: "50000000", lineTotal: "100000000" }],
  totals: { ht: "100000000", vat: "18000000", ttc: "118000000" },
};

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

describe("SovereignOcrTextExtractionProvider.extraire", () => {
  it("appelle le sous-chemin /extractions/text du HUB VISION, avec le texte et le jeton en Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "vision-gn-2026.09", extraction: EXTRACTION }));
    vi.stubGlobal("fetch", fetchMock);

    await new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://vision.facture.gn/extractions/text");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer jeton-souverain");
    expect(JSON.parse(init.body)).toEqual({ texte: TEXTE.texte });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rend l'identifiant de modèle et l'extraction BRUTE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ modelId: "vision-gn-2026.09", extraction: EXTRACTION })));

    const inference = await new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE);

    expect(inference.modelId).toBe("vision-gn-2026.09");
    expect(inference.sortie).toEqual(EXTRACTION);
  });

  it("lève 503 sur un statut non-2xx, sans relayer le corps de la réponse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ echo: "Boutique Aissatou 15000000" }, { ok: false, status: 502 })));

    const erreur = await new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ServiceUnavailableException);
    expect((erreur as Error).message).toContain("502");
    expect((erreur as Error).message).not.toContain("Aissatou");
  });

  it("lève 503 quand le point d'inférence est injoignable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE)).rejects.toThrow(ServiceUnavailableException);
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

    const promesse = new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE);
    const attente = expect(promesse).rejects.toThrow(/délai dépassé/);
    await vi.advanceTimersByTimeAsync(OCR_TEXT_EXTRACTION_REQUEST_TIMEOUT_MS + 1);
    await attente;
  });

  it("lève 503 sur une enveloppe sans modelId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ extraction: EXTRACTION })));

    await expect(new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE)).rejects.toThrow(ServiceUnavailableException);
  });

  it("lève 503 sur un corps qui n'est pas du JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }),
    );

    await expect(new SovereignOcrTextExtractionProvider(CONFIG).extraire(TEXTE)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe("ocrTextExtractionProviderFromEnv", () => {
  it("sans OCR_VISION_ENDPOINT, garde l'implémentation non configurée (503 explicite) — aucune nouvelle variable lue", () => {
    expect(ocrTextExtractionProviderFromEnv({})).toBeInstanceOf(UnconfiguredOcrTextExtractionProvider);
    expect(ocrTextExtractionProviderFromEnv({ OCR_VISION_ENDPOINT: "   " })).toBeInstanceOf(UnconfiguredOcrTextExtractionProvider);
  });

  it("avec OCR_VISION_ENDPOINT et OCR_VISION_TOKEN, câble le connecteur souverain sur /extractions/text", async () => {
    const provider = ocrTextExtractionProviderFromEnv({ OCR_VISION_ENDPOINT: "https://vision.facture.gn/", OCR_VISION_TOKEN: "t" });
    expect(provider).toBeInstanceOf(SovereignOcrTextExtractionProvider);

    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "m", extraction: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await provider.extraire(TEXTE);
    expect(fetchMock.mock.calls[0][0]).toBe("https://vision.facture.gn/extractions/text");
  });

  it("refuse de démarrer avec OCR_VISION_ENDPOINT sans OCR_VISION_TOKEN", () => {
    expect(() => ocrTextExtractionProviderFromEnv({ OCR_VISION_ENDPOINT: "https://vision.facture.gn" })).toThrow(
      /OCR_VISION_TOKEN/,
    );
  });

  it("ne lit AUCUNE variable d'environnement nouvelle — un OCR_TEXT_EXTRACTION_ENDPOINT parasite est ignoré", async () => {
    const env = {
      OCR_VISION_ENDPOINT: "https://vision.facture.gn",
      OCR_VISION_TOKEN: "t",
      OCR_TEXT_EXTRACTION_ENDPOINT: "https://autre-hub.exemple",
    };
    const provider = ocrTextExtractionProviderFromEnv(env);

    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "m", extraction: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await provider.extraire(TEXTE);

    expect(fetchMock.mock.calls[0][0]).toBe("https://vision.facture.gn/extractions/text");
  });
});
