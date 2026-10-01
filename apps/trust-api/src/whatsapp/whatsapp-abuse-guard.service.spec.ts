import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppAbuseGuardService } from "./whatsapp-abuse-guard.service";
import { WHATSAPP_OCR_HOURLY_LIMIT } from "./whatsapp.constants";

const ORG = "org-1";

function fakeRedisClient() {
  const store = new Map<string, number>();
  return {
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    _store: store,
  };
}

function fakeQueue(client: ReturnType<typeof fakeRedisClient>) {
  return { client: Promise.resolve(client) };
}

describe("WhatsAppAbuseGuardService (clarification 6, point 7 du plan 2026-09-16)", () => {
  let client: ReturnType<typeof fakeRedisClient>;
  let service: WhatsAppAbuseGuardService;

  beforeEach(() => {
    client = fakeRedisClient();
    service = new WhatsAppAbuseGuardService(fakeQueue(client) as never);
  });

  it("autorise la première soumission de l'heure et pose l'expiration (INCR + EXPIRE 3600)", async () => {
    const autorise = await service.estAutorise(ORG);

    expect(autorise).toBe(true);
    expect(client.incr).toHaveBeenCalledWith(expect.stringContaining(`whatsapp-ocr:${ORG}:`));
    expect(client.expire).toHaveBeenCalledWith(expect.stringContaining(`whatsapp-ocr:${ORG}:`), 3600);
  });

  it("ne réarme PAS l'expiration sur les soumissions suivantes de la même heure — un TTL glissant ferait fuir la fenêtre", async () => {
    await service.estAutorise(ORG);
    await service.estAutorise(ORG);
    await service.estAutorise(ORG);

    expect(client.expire).toHaveBeenCalledTimes(1);
  });

  it(`autorise jusqu'à ${WHATSAPP_OCR_HOURLY_LIMIT} soumissions par organisation sur l'heure`, async () => {
    for (let i = 0; i < WHATSAPP_OCR_HOURLY_LIMIT; i++) {
      expect(await service.estAutorise(ORG)).toBe(true);
    }
  });

  it(`refuse la ${WHATSAPP_OCR_HOURLY_LIMIT + 1}e soumission de l'heure`, async () => {
    for (let i = 0; i < WHATSAPP_OCR_HOURLY_LIMIT; i++) {
      await service.estAutorise(ORG);
    }

    expect(await service.estAutorise(ORG)).toBe(false);
  });

  it("compte PAR ORGANISATION — le plafond d'une organisation n'affecte jamais une autre", async () => {
    for (let i = 0; i < WHATSAPP_OCR_HOURLY_LIMIT; i++) {
      await service.estAutorise(ORG);
    }
    expect(await service.estAutorise(ORG)).toBe(false);

    expect(await service.estAutorise("org-2")).toBe(true);
  });

  it("la clé Redis change quand l'heure calendaire change — deux heures distinctes ne partagent jamais le même compteur", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T09:59:00.000Z"));
    await service.estAutorise(ORG);
    const cleHeure1 = client.incr.mock.calls[0][0];

    vi.setSystemTime(new Date("2026-09-17T10:01:00.000Z"));
    await service.estAutorise(ORG);
    const cleHeure2 = client.incr.mock.calls[1][0];

    expect(cleHeure1).not.toBe(cleHeure2);
    vi.useRealTimers();
  });
});
