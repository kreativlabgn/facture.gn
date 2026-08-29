import { afterEach, describe, expect, it } from "vitest";
import { buildVerificationQrDataUrl, verificationUrl } from "./verification-qr";

const CERT_ID = "GN-12345678-2026-ABC123";

afterEach(() => {
  delete process.env.PUBLIC_VERIFICATION_BASE_URL;
});

describe("verificationUrl — URL publique de verification d'une facture", () => {
  it("utilise https://verify.facture.gn par defaut", () => {
    expect(verificationUrl(CERT_ID)).toBe("https://verify.facture.gn/GN-12345678-2026-ABC123");
  });

  it("respecte PUBLIC_VERIFICATION_BASE_URL si defini", () => {
    process.env.PUBLIC_VERIFICATION_BASE_URL = "https://verify.staging.facture.gn";
    expect(verificationUrl(CERT_ID)).toBe("https://verify.staging.facture.gn/GN-12345678-2026-ABC123");
  });

  it("tolere un slash final dans la base", () => {
    process.env.PUBLIC_VERIFICATION_BASE_URL = "https://verify.facture.gn/";
    expect(verificationUrl(CERT_ID)).toBe("https://verify.facture.gn/GN-12345678-2026-ABC123");
  });
});

describe("buildVerificationQrDataUrl", () => {
  it("produit un data URL PNG non trivial", async () => {
    const dataUrl = await buildVerificationQrDataUrl(CERT_ID);
    expect(dataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    // un QR encodant une URL de ~45 caracteres pese largement plus que 200 octets
    expect(dataUrl.length).toBeGreaterThan(200);
  });
});
