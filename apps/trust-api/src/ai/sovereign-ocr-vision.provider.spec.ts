import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnconfiguredOcrVisionProvider } from "./ocr-vision.provider";
import {
  OCR_VISION_REQUEST_TIMEOUT_MS,
  SovereignOcrVisionProvider,
  ocrVisionProviderFromEnv,
} from "./sovereign-ocr-vision.provider";

const CONFIG = { endpoint: "https://vision.facture.gn", token: "jeton-souverain" };
const IMAGE = { storageKey: "scans/org-1/abc.jpg", mimeType: "image/jpeg" as const };

// Ce que le modèle est instruit de rendre : des CENTIMES en chaînes de
// chiffres seuls (« 15000000 » = 150 000,00 GNF — un sac de riz), jamais des
// nombres. Le connecteur relaie cette extraction telle quelle ; c'est
// ocrExtractionSchema qui la convertira en BigInt, chiffre pour chiffre.
const EXTRACTION = {
  saisieRegime: "HT_FIRST",
  lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: "15000000", lineTotal: "15000000" }],
  totals: { ht: "15000000", vat: "2700000", ttc: "17700000" },
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

describe("SovereignOcrVisionProvider.extraire", () => {
  it("relaie la RÉFÉRENCE d'image au point d'inférence, jamais des octets, avec le jeton en Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "vision-gn-2026.09", extraction: EXTRACTION }));
    vi.stubGlobal("fetch", fetchMock);

    await new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://vision.facture.gn/extractions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer jeton-souverain");
    expect(JSON.parse(init.body)).toEqual({ storageKey: IMAGE.storageKey, mimeType: "image/jpeg" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rend l'identifiant de modèle et l'extraction BRUTE — les montants restent des chaînes de chiffres", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ modelId: "vision-gn-2026.09", extraction: EXTRACTION })));

    const inference = await new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE);

    expect(inference.modelId).toBe("vision-gn-2026.09");
    expect(inference.sortie).toEqual(EXTRACTION);
    // Aucune conversion ici : « 15000000 » arrive au validateur tel que le
    // modèle l'a écrit, et c'est BigInt(chaîne) qui le lira — jamais Number().
    expect((inference.sortie as typeof EXTRACTION).lines[0].unitPrice).toBe("15000000");
  });

  it("lève 503 sur un statut non-2xx, sans relayer le corps de la réponse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ echo: "Boutique Aissatou 15000000" }, { ok: false, status: 502 })));

    const erreur = await new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ServiceUnavailableException);
    expect((erreur as Error).message).toContain("502");
    expect((erreur as Error).message).not.toContain("Aissatou");
  });

  it("lève 503 quand le point d'inférence est injoignable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE)).rejects.toThrow(ServiceUnavailableException);
  });

  it("abandonne après le budget de requête et lève 503 — la PWA ne doit jamais attendre sans verdict", async () => {
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

    const promesse = new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE);
    const attente = expect(promesse).rejects.toThrow(/délai dépassé/);
    await vi.advanceTimersByTimeAsync(OCR_VISION_REQUEST_TIMEOUT_MS + 1);
    await attente;
  });

  it("lève 503 sur une enveloppe sans modelId — la traçabilité de souveraineté n'est pas optionnelle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ extraction: EXTRACTION })));

    await expect(new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE)).rejects.toThrow(ServiceUnavailableException);
  });

  it("lève 503 sur un corps qui n'est pas du JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } }),
    );

    await expect(new SovereignOcrVisionProvider(CONFIG).extraire(IMAGE)).rejects.toThrow(ServiceUnavailableException);
  });
});

describe("ocrVisionProviderFromEnv", () => {
  it("sans OCR_VISION_ENDPOINT, garde l'implémentation non configurée (503 explicite)", () => {
    expect(ocrVisionProviderFromEnv({})).toBeInstanceOf(UnconfiguredOcrVisionProvider);
    expect(ocrVisionProviderFromEnv({ OCR_VISION_ENDPOINT: "   " })).toBeInstanceOf(UnconfiguredOcrVisionProvider);
  });

  it("avec endpoint et jeton, câble le connecteur souverain et retire la barre finale", async () => {
    const provider = ocrVisionProviderFromEnv({ OCR_VISION_ENDPOINT: "https://vision.facture.gn/", OCR_VISION_TOKEN: "t" });
    expect(provider).toBeInstanceOf(SovereignOcrVisionProvider);

    const fetchMock = vi.fn().mockResolvedValue(reponse({ modelId: "m", extraction: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await provider.extraire(IMAGE);
    expect(fetchMock.mock.calls[0][0]).toBe("https://vision.facture.gn/extractions");
  });

  it("refuse de démarrer avec un endpoint sans jeton — une configuration à moitié faite se voit au déploiement", () => {
    expect(() => ocrVisionProviderFromEnv({ OCR_VISION_ENDPOINT: "https://vision.facture.gn" })).toThrow(/OCR_VISION_TOKEN/);
  });
});
