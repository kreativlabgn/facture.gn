import { describe, expect, it, vi } from "vitest";
import { ReconciliationProcessor } from "./reconciliation.processor";

describe("ReconciliationProcessor", () => {
  it("délègue à ReconciliationService.runOnce et retourne le résumé", async () => {
    const summary = { checked: 3, confirmed: 1, failed: 1, stillPending: 1, skipped: 0, errored: 0 };
    const service = { runOnce: vi.fn().mockResolvedValue(summary) };
    const processor = new ReconciliationProcessor(service as never);

    const result = await processor.process();

    expect(service.runOnce).toHaveBeenCalledOnce();
    expect(result).toEqual(summary);
  });
});
