import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppStubProvider } from "./whatsapp-stub.provider";
import {
  SovereignWhatsAppSendProvider,
  WHATSAPP_SEND_REQUEST_TIMEOUT_MS,
  whatsappProviderFromEnv,
} from "./sovereign-whatsapp-send.provider";

const CONFIG = { accessToken: "jeton-meta", phoneNumberId: "1234567890" };
const PHONE = "+224620000000";
const MESSAGE = "Brouillon créé — ouvrez l'application facture.gn.";

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

describe("SovereignWhatsAppSendProvider.send", () => {
  it("appelle l'API Graph Meta d'envoi avec le jeton en Bearer et l'enveloppe attendue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reponse({ messages: [{ id: "wamid.out-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const resultat = await new SovereignWhatsAppSendProvider(CONFIG).send(PHONE, MESSAGE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v20.0/1234567890/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer jeton-meta");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      to: PHONE,
      type: "text",
      text: { body: MESSAGE },
    });
    expect(resultat).toEqual({ success: true });
  });

  it("rend success:false sur un statut non-2xx, sans lever et sans relayer le corps de la réponse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reponse({ error: { message: "invalid token" } }, { ok: false, status: 401 })));

    const resultat = await new SovereignWhatsAppSendProvider(CONFIG).send(PHONE, MESSAGE);

    expect(resultat).toEqual({ success: false });
  });

  it("rend success:false quand l'API Graph est injoignable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(new SovereignWhatsAppSendProvider(CONFIG).send(PHONE, MESSAGE)).resolves.toEqual({ success: false });
  });

  it("abandonne après le budget de requête et rend success:false", async () => {
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

    const promesse = new SovereignWhatsAppSendProvider(CONFIG).send(PHONE, MESSAGE);
    const attente = expect(promesse).resolves.toEqual({ success: false });
    await vi.advanceTimersByTimeAsync(WHATSAPP_SEND_REQUEST_TIMEOUT_MS + 1);
    await attente;
  });
});

describe("whatsappProviderFromEnv (clarification 8 du plan 2026-09-16)", () => {
  it("sans WHATSAPP_ACCESS_TOKEN ni WHATSAPP_PHONE_NUMBER_ID, garde WhatsAppStubProvider inchangé", () => {
    expect(whatsappProviderFromEnv({})).toBeInstanceOf(WhatsAppStubProvider);
  });

  it("avec WHATSAPP_ACCESS_TOKEN seul (PHONE_NUMBER_ID absent), garde WhatsAppStubProvider — configuration à moitié faite jamais acceptée", () => {
    expect(whatsappProviderFromEnv({ WHATSAPP_ACCESS_TOKEN: "t" })).toBeInstanceOf(WhatsAppStubProvider);
  });

  it("avec WHATSAPP_PHONE_NUMBER_ID seul (ACCESS_TOKEN absent), garde WhatsAppStubProvider", () => {
    expect(whatsappProviderFromEnv({ WHATSAPP_PHONE_NUMBER_ID: "123" })).toBeInstanceOf(WhatsAppStubProvider);
  });

  it("avec les DEUX variables présentes, câble le connecteur souverain live", async () => {
    const provider = whatsappProviderFromEnv({ WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123" });
    expect(provider).toBeInstanceOf(SovereignWhatsAppSendProvider);

    const fetchMock = vi.fn().mockResolvedValue(reponse({ messages: [{ id: "wamid.out-1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await provider.send(PHONE, MESSAGE);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v20.0/123/messages");
  });
});
