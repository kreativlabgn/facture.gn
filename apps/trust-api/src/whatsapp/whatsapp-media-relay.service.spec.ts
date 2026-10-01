import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import {
  SovereignWhatsAppMediaRelayService,
  UnconfiguredWhatsAppMediaRelay,
  WhatsAppMediaRelayIndisponible,
  whatsAppMediaRelayFromEnv,
} from "./whatsapp-media-relay.service";

// Le SDK S3 réel signe chaque requête (identifiants, horodatage) — inutile de
// reproduire cette machinerie pour tester le CÂBLAGE de whatsAppMediaRelayFromEnv
// (forcePathStyle/région, voir le "point d'attention MinIO" du plan). Seul
// S3Client est remplacé ; PutObjectCommand reste le VRAI export du SDK
// (SovereignWhatsAppMediaRelayService.relayer() en construit une instance).
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })) };
});

const ACCESS_TOKEN = "jeton-meta-souverain";
const BUCKET = "ocr-media";
const ORG = "org-1";
const WAMID = "wamid.audio-1";
const MEDIA_ID = "media-123";

const ENV_COMPLET = {
  WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN,
  STORAGE_ENDPOINT: "http://minio:9000",
  STORAGE_ACCESS_KEY: "minio-access-key",
  STORAGE_SECRET_KEY: "minio-secret-key",
  STORAGE_BUCKET: BUCKET,
} as NodeJS.ProcessEnv;

function metaResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

function octetsResponse(texte: string, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    arrayBuffer: async () => new TextEncoder().encode(texte).buffer,
  };
}

function fakeS3() {
  return { send: vi.fn().mockResolvedValue({}) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SovereignWhatsAppMediaRelayService.relayer", () => {
  it("télécharge le média (métadonnées puis octets, MÊME en-tête) et le dépose dans MinIO sous whatsapp/{org}/{wamid}", async () => {
    const s3 = fakeS3();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metaResponse({ url: "https://graph-media.facebook.com/xyz", mime_type: "audio/ogg" }))
      .mockResolvedValueOnce(octetsResponse("octets-audio"));
    vi.stubGlobal("fetch", fetchMock);

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });
    const resultat = await service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID });

    expect(resultat).toEqual({ storageKey: `whatsapp/${ORG}/${WAMID}`, mimeType: "audio/ogg" });

    const [metaUrl, metaInit] = fetchMock.mock.calls[0];
    expect(metaUrl).toBe(`https://graph.facebook.com/v20.0/${MEDIA_ID}`);
    expect(metaInit.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    const [binUrl, binInit] = fetchMock.mock.calls[1];
    expect(binUrl).toBe("https://graph-media.facebook.com/xyz");
    expect(binInit.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

    expect(s3.send).toHaveBeenCalledTimes(1);
    const command = s3.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe(BUCKET);
    expect(command.input.Key).toBe(`whatsapp/${ORG}/${WAMID}`);
    expect(command.input.ContentType).toBe("audio/ogg");
    expect(Buffer.isBuffer(command.input.Body)).toBe(true);
  });

  it("jeton Meta invalide (401 sur les métadonnées) → WhatsAppMediaRelayIndisponible, aucun dépôt MinIO tenté", async () => {
    const s3 = fakeS3();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(metaResponse({ error: { message: "Invalid OAuth access token" } }, { ok: false, status: 401 })),
    );

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });

    await expect(
      service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID }),
    ).rejects.toBeInstanceOf(WhatsAppMediaRelayIndisponible);
    expect(s3.send).not.toHaveBeenCalled();
  });

  it("média introuvable chez Meta (404 sur les métadonnées) → WhatsAppMediaRelayIndisponible", async () => {
    const s3 = fakeS3();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metaResponse({}, { ok: false, status: 404 })));

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });

    await expect(
      service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID }),
    ).rejects.toBeInstanceOf(WhatsAppMediaRelayIndisponible);
  });

  it("API Graph Meta injoignable (métadonnées) → WhatsAppMediaRelayIndisponible", async () => {
    const s3 = fakeS3();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });

    await expect(
      service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID }),
    ).rejects.toBeInstanceOf(WhatsAppMediaRelayIndisponible);
  });

  it("échec du téléchargement des octets (statut non-2xx sur l'URL Meta) → WhatsAppMediaRelayIndisponible", async () => {
    const s3 = fakeS3();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metaResponse({ url: "https://graph-media.facebook.com/xyz", mime_type: "audio/ogg" }))
      .mockResolvedValueOnce(octetsResponse("", { ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });

    await expect(
      service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID }),
    ).rejects.toBeInstanceOf(WhatsAppMediaRelayIndisponible);
    expect(s3.send).not.toHaveBeenCalled();
  });

  it("MinIO/S3 injoignable au dépôt → WhatsAppMediaRelayIndisponible", async () => {
    const s3 = { send: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:9000")) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metaResponse({ url: "https://graph-media.facebook.com/xyz", mime_type: "audio/ogg" }))
      .mockResolvedValueOnce(octetsResponse("octets-audio"));
    vi.stubGlobal("fetch", fetchMock);

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });

    await expect(
      service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID }),
    ).rejects.toBeInstanceOf(WhatsAppMediaRelayIndisponible);
  });

  it("jamais d'octets ni de jeton journalisés, succès comme échec", async () => {
    const logSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const logInfoSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const s3 = fakeS3();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metaResponse({ url: "https://graph-media.facebook.com/xyz", mime_type: "audio/ogg" }))
      .mockResolvedValueOnce(octetsResponse("contenu-audio-secret"));
    vi.stubGlobal("fetch", fetchMock);

    const service = new SovereignWhatsAppMediaRelayService({ accessToken: ACCESS_TOKEN, bucket: BUCKET, s3 });
    await service.relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID });

    // Échec, pour vérifier aussi cette voie.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(metaResponse({ error: "nope" }, { ok: false, status: 401 })));
    await service.relayer({ organizationId: ORG, whatsappMessageId: "wamid.echec", mediaId: MEDIA_ID }).catch(() => undefined);

    for (const call of [...logSpy.mock.calls, ...logInfoSpy.mock.calls]) {
      const message = String(call[0]);
      expect(message).not.toContain(ACCESS_TOKEN);
      expect(message).not.toContain("contenu-audio-secret");
    }
    logSpy.mockRestore();
    logInfoSpy.mockRestore();
  });
});

describe("UnconfiguredWhatsAppMediaRelay", () => {
  it("rejette systématiquement avec WhatsAppMediaRelayIndisponible, sans jamais tenter d'appel réseau", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new UnconfiguredWhatsAppMediaRelay().relayer({ organizationId: ORG, whatsappMessageId: WAMID, mediaId: MEDIA_ID }),
    ).rejects.toBeInstanceOf(WhatsAppMediaRelayIndisponible);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("whatsAppMediaRelayFromEnv", () => {
  it("sans aucune configuration, retombe sur l'implémentation non configurée", () => {
    expect(whatsAppMediaRelayFromEnv({} as NodeJS.ProcessEnv)).toBeInstanceOf(UnconfiguredWhatsAppMediaRelay);
  });

  it.each(["WHATSAPP_ACCESS_TOKEN", "STORAGE_ENDPOINT", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "STORAGE_BUCKET"])(
    "une seule variable manquante (%s) suffit à retomber sur l'implémentation non configurée",
    (cle) => {
      const env = { ...ENV_COMPLET };
      delete (env as Record<string, string | undefined>)[cle];
      expect(whatsAppMediaRelayFromEnv(env)).toBeInstanceOf(UnconfiguredWhatsAppMediaRelay);
    },
  );

  it("avec la configuration complète, câble le connecteur souverain", () => {
    const relay = whatsAppMediaRelayFromEnv(ENV_COMPLET);
    expect(relay).toBeInstanceOf(SovereignWhatsAppMediaRelayService);
  });

  it("configure le SDK S3 pour MinIO : endpoint, région factice et forcePathStyle (sans ça le SDK échoue contre MinIO)", () => {
    whatsAppMediaRelayFromEnv(ENV_COMPLET);

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "http://minio:9000",
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: "minio-access-key", secretAccessKey: "minio-secret-key" },
      }),
    );
  });
});
