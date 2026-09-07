import { describe, expect, it, vi } from "vitest";
import { EtaxSyncProcessor } from "./etax-sync.processor";
import type { EtaxDeclarationPayload } from "./etax-declaration";

const JOB_DATA: EtaxDeclarationPayload = {
  organizationId: "org-1",
  fiscalPeriodId: "closing-1",
  year: 2025,
  etaxNumber: "ETAX-42",
  totalHt: "1000000",
  totalTva: "180000",
  totalTtc: "1180000",
  taxRateBps: 1800,
  taxCode: "TVA-18",
  sealHash: "sceau-abc",
};

const job = (overrides: Partial<{ attemptsMade: number }> = {}) =>
  ({ data: JOB_DATA, attemptsMade: overrides.attemptsMade ?? 0 }) as never;

describe("EtaxSyncProcessor", () => {
  it("délègue au service et rend son résultat", async () => {
    const service = {
      processDeclaration: vi.fn().mockResolvedValue({ submissionRef: "ACK-1", skipped: false }),
    };
    const processor = new EtaxSyncProcessor(service as never);

    await expect(processor.process(job())).resolves.toEqual({ submissionRef: "ACK-1", skipped: false });
    expect(service.processDeclaration).toHaveBeenCalledWith(JOB_DATA);
  });

  // Le processeur ne rattrape RIEN, à dessein : c'est l'exception qui remonte
  // qui fait échouer le job et déclenche le backoff exponentiel. La rattraper
  // ici marquerait le job « completed » alors que la DGI n'a rien reçu — soit
  // exactement la panne silencieuse que la file est censée empêcher.
  it("laisse remonter l'échec — sans quoi le backoff ne se déclencherait jamais", async () => {
    const service = { processDeclaration: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")) };
    const processor = new EtaxSyncProcessor(service as never);

    await expect(processor.process(job())).rejects.toThrow(/503/);
  });
});
