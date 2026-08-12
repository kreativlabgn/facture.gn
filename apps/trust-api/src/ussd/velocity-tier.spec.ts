import { describe, expect, it } from "vitest";
import { resolveVelocityTier, VELOCITY_LIMITS_CENTIMES } from "./velocity-tier";

const DAY_MS = 24 * 3600_000;

describe("resolveVelocityTier — §4 Spec USSD", () => {
  it("T0 pour une organisation non vérifiée DGI", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "unverified",
      dgiVerifiedAt: null,
      hasAnomalyFlag: false,
      forcedT0Until: null,
    });
    expect(tier).toBe("T0");
  });

  it("T1 pour une organisation vérifiée DGI depuis moins de 90 jours", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - 30 * DAY_MS),
      hasAnomalyFlag: false,
      forcedT0Until: null,
    });
    expect(tier).toBe("T1");
  });

  it("T2 pour une organisation vérifiée depuis plus de 90 jours sans aucun flag", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - 100 * DAY_MS),
      hasAnomalyFlag: false,
      forcedT0Until: null,
    });
    expect(tier).toBe("T2");
  });

  it("reste T1 (pas T2) si un flag existe, même après 90 jours", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - 100 * DAY_MS),
      hasAnomalyFlag: true,
      forcedT0Until: null,
    });
    expect(tier).toBe("T1");
  });

  it("T3 pour une organisation en T2 depuis plus de 12 mois (90j + 365j), sans flag", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - (90 + 366) * DAY_MS),
      hasAnomalyFlag: false,
      forcedT0Until: null,
    });
    expect(tier).toBe("T3");
  });

  it("reste T2 (pas T3) avant les 12 mois supplémentaires", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - (90 + 100) * DAY_MS),
      hasAnomalyFlag: false,
      forcedT0Until: null,
    });
    expect(tier).toBe("T2");
  });

  it("force T0 si forcedT0Until est dans le futur, quel que soit le palier DGI réel (bascule post-reset PIN/récupération)", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - (90 + 366) * DAY_MS),
      hasAnomalyFlag: false,
      forcedT0Until: new Date(Date.now() + 3600_000),
    });
    expect(tier).toBe("T0");
  });

  it("n'est plus forcé T0 une fois forcedT0Until dépassé", () => {
    const tier = resolveVelocityTier({
      dgiVerificationStatus: "verified",
      dgiVerifiedAt: new Date(Date.now() - 100 * DAY_MS),
      hasAnomalyFlag: false,
      forcedT0Until: new Date(Date.now() - 3600_000),
    });
    expect(tier).toBe("T2");
  });
});

describe("VELOCITY_LIMITS_CENTIMES — table des plafonds (§4)", () => {
  it("reflète exactement la table de la Spec USSD, en centimes GNF", () => {
    expect(VELOCITY_LIMITS_CENTIMES.T0).toEqual({
      perAct: 50_000_000n,
      perDay: 150_000_000n,
      perWeek: 300_000_000n,
      perMonth: 600_000_000n,
    });
    expect(VELOCITY_LIMITS_CENTIMES.T3).toEqual({
      perAct: 8_000_000_000n,
      perDay: 8_000_000_000n,
      perWeek: 20_000_000_000n,
      perMonth: 40_000_000_000n,
    });
  });
});
