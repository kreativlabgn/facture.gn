import { beforeEach, describe, expect, it, vi } from "vitest";

// consentRecorded devient, côté trust-api, la preuve légale de consentement
// (AssistedSession.consentRecordedAt, L/2016/037) dès qu'elle vaut `true`.
// Avant ce correctif, l'action l'envoyait toujours à `true` sans qu'aucun
// écran ne demande à l'agent terrain de confirmer avoir réellement recueilli
// ce consentement — ces tests figent la garde qui l'en empêche désormais.

const requireSessionTokenMock = vi.fn();
const createAssistedOrganizationMock = vi.fn();

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, requireSessionToken: () => requireSessionTokenMock() };
});

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return { ...actual, createAssistedOrganization: (...args: unknown[]) => createAssistedOrganizationMock(...args) };
});

const { enrolFieldMerchant } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionTokenMock.mockResolvedValue("jeton-agent");
  createAssistedOrganizationMock.mockResolvedValue({ id: "org-1" });
});

describe("enrolFieldMerchant — consentement de l'attestation", () => {
  it("refuse sans appeler trust-api quand le consentement n'est pas attesté", async () => {
    const result = await enrolFieldMerchant("Établissements Camara", "620112233", false);

    expect(result).toEqual({ error: "Le consentement du marchand doit être confirmé avant l'enrôlement." });
    expect(createAssistedOrganizationMock).not.toHaveBeenCalled();
  });

  it("enrôle et transmet consentRecorded:true quand l'agent a attesté le consentement", async () => {
    const result = await enrolFieldMerchant("Établissements Camara", "620112233", true);

    expect(result).toEqual({ organizationId: "org-1" });
    expect(createAssistedOrganizationMock).toHaveBeenCalledWith(
      "jeton-agent",
      expect.objectContaining({ msisdn: "620112233", consentRecorded: true }),
    );
  });

  it("valide le nom et le numéro avant même de regarder le consentement", async () => {
    const result = await enrolFieldMerchant("", "620112233", true);

    expect(result).toEqual({ error: "Saisissez un nom de commerce et un numéro guinéen à 9 chiffres." });
    expect(createAssistedOrganizationMock).not.toHaveBeenCalled();
  });
});
