import { describe, expect, it } from "vitest";
import { listInvoicesQuerySchema } from "./list-invoices-query.dto";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

describe("listInvoicesQuerySchema (Lot D)", () => {
  it("accepte une requête sans filtre — emissionChannel devient undefined", () => {
    const parsed = listInvoicesQuerySchema.parse({ organizationId: ORG_ID });
    expect(parsed.emissionChannel).toBeUndefined();
  });

  it("accepte les 4 canaux valides", () => {
    for (const channel of ["pwa", "ussd", "agent_terrain", "api"] as const) {
      expect(listInvoicesQuerySchema.parse({ organizationId: ORG_ID, emissionChannel: channel }).emissionChannel).toBe(
        channel,
      );
    }
  });

  it("rejette un canal inconnu", () => {
    expect(() => listInvoicesQuerySchema.parse({ organizationId: ORG_ID, emissionChannel: "sms" })).toThrow();
  });

  it("exige toujours organizationId (hérité du schéma partagé)", () => {
    expect(() => listInvoicesQuerySchema.parse({ emissionChannel: "ussd" })).toThrow();
  });
});
