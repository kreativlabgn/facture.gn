import { describe, expect, it, vi } from "vitest";

import { RetentionProcessor } from "./retention.processor";
import type { RetentionSummary } from "./retention.service";

function build(summary: RetentionSummary) {
  const runOnce = vi.fn().mockResolvedValue(summary);
  const processor = new RetentionProcessor({ runOnce } as never);
  return { processor, runOnce };
}

describe("RetentionProcessor.process", () => {
  it("délègue à RetentionService.runOnce et retourne le résumé quand tout va bien", async () => {
    const summary: RetentionSummary = {
      deletedByTable: { ussd_session: 4, revoked_token: 1 },
      errored: [],
      ruleCount: 4,
    };
    const { processor, runOnce } = build(summary);

    await expect(processor.process()).resolves.toEqual(summary);
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it("ne rejette pas sur un échec PARTIEL (au moins une table purgée)", async () => {
    const { processor } = build({
      deletedByTable: { ussd_session: 4 },
      errored: ["revoked_token"],
      ruleCount: 4,
    });

    await expect(processor.process()).resolves.toBeDefined();
  });

  it("FAIT ÉCHOUER le job quand toutes les tables ont échoué (panne globale ≠ 'completed')", async () => {
    const { processor } = build({
      deletedByTable: {},
      errored: ["ussd_session", "client_portal_otp", "revoked_token", "pending_member_invite"],
      ruleCount: 4,
    });

    await expect(processor.process()).rejects.toThrow(/toutes les tables ont échoué/i);
  });
});
