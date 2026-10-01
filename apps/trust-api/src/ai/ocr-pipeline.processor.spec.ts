import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { OcrPipelineProcessor } from "./ocr-pipeline.processor";
import { OCR_PIPELINE_JOBS } from "./ocr-pipeline.constants";

const PAYLOAD = { documentId: "doc-1", organizationId: "org-1", mimeType: "audio/ogg" };

const job = (name: string, data: unknown, attemptsMade = 0, attempts = 3) =>
  ({ name, data, attemptsMade, opts: { attempts } }) as never;

describe("OcrPipelineProcessor — aiguillage (patron EtaxSyncProcessor)", () => {
  it("délègue TRANSCRIBE_AND_EXTRACT au service, avec attemptsMade et attempts du job", async () => {
    const pipeline = {
      transcribeAndExtract: vi.fn().mockResolvedValue({
        documentId: "doc-1",
        status: "AUTO_INSERTED",
        invoiceId: "inv-1",
        findings: null,
        rejectionReason: null,
      }),
    };

    const resultat = await new OcrPipelineProcessor(pipeline as never).process(
      job(OCR_PIPELINE_JOBS.TRANSCRIBE_AND_EXTRACT, PAYLOAD, 1, 3),
    );

    expect(resultat).toMatchObject({ status: "AUTO_INSERTED", invoiceId: "inv-1" });
    expect(pipeline.transcribeAndExtract).toHaveBeenCalledWith(PAYLOAD, { attemptsMade: 1, attempts: 3 });
  });

  // EXTRACT_FROM_TEXT — WHATSAPP_TEXT (plan 2026-09-16, étape 2) : câblé à
  // cette tranche, même patron exact que TRANSCRIBE_AND_EXTRACT ci-dessus.
  it("délègue EXTRACT_FROM_TEXT au service, avec attemptsMade et attempts du job", async () => {
    const pipeline = {
      transcribeAndExtract: vi.fn(),
      extractFromText: vi.fn().mockResolvedValue({
        documentId: "doc-1",
        status: "AUTO_INSERTED",
        invoiceId: "inv-1",
        findings: null,
        rejectionReason: null,
      }),
    };

    const resultat = await new OcrPipelineProcessor(pipeline as never).process(
      job(OCR_PIPELINE_JOBS.EXTRACT_FROM_TEXT, PAYLOAD, 1, 3),
    );

    expect(resultat).toMatchObject({ status: "AUTO_INSERTED", invoiceId: "inv-1" });
    expect(pipeline.extractFromText).toHaveBeenCalledWith(PAYLOAD, { attemptsMade: 1, attempts: 3 });
    expect(pipeline.transcribeAndExtract).not.toHaveBeenCalled();
  });

  // LE TEST QUI PROTÈGE LA COHABITATION — même raisonnement que EtaxSyncProcessor :
  // les deux types de job partagent la même file, l'aiguillage sur job.name
  // n'est donc pas décoratif.
  it("ne confond jamais EXTRACT_FROM_TEXT avec TRANSCRIBE_AND_EXTRACT", async () => {
    const pipeline = { transcribeAndExtract: vi.fn(), extractFromText: vi.fn().mockResolvedValue({}) };
    await new OcrPipelineProcessor(pipeline as never).process(job(OCR_PIPELINE_JOBS.EXTRACT_FROM_TEXT, PAYLOAD));
    expect(pipeline.transcribeAndExtract).not.toHaveBeenCalled();
  });

  it("refuse un job sans documentId ni organizationId exploitables", async () => {
    const pipeline = { transcribeAndExtract: vi.fn(), extractFromText: vi.fn() };
    await expect(
      new OcrPipelineProcessor(pipeline as never).process(job(OCR_PIPELINE_JOBS.TRANSCRIBE_AND_EXTRACT, { mimeType: "audio/ogg" })),
    ).rejects.toThrow(UnrecoverableError);
    expect(pipeline.transcribeAndExtract).not.toHaveBeenCalled();
  });

  // Rejouer plusieurs fois un job qu'on ne sait pas traiter n'a jamais fait
  // apparaître le code manquant : UnrecoverableError coupe le backoff.
  it("refuse toujours un type de job totalement inconnu", async () => {
    const pipeline = { transcribeAndExtract: vi.fn(), extractFromText: vi.fn() };
    await expect(
      new OcrPipelineProcessor(pipeline as never).process(job("un-job-quelconque", PAYLOAD)),
    ).rejects.toThrow(UnrecoverableError);
    expect(pipeline.transcribeAndExtract).not.toHaveBeenCalled();
    expect(pipeline.extractFromText).not.toHaveBeenCalled();
  });
});

describe("OcrPipelineProcessor — remontée des échecs", () => {
  // Le processeur ne rattrape RIEN, à dessein : c'est l'exception qui remonte
  // qui fait échouer le job et déclenche le backoff exponentiel. L'avaler ici
  // marquerait le job « completed » alors que rien n'a été traité — exactement
  // la panne silencieuse que la file est censée empêcher.
  it("laisse remonter l'échec d'une transcription/extraction", async () => {
    const pipeline = { transcribeAndExtract: vi.fn().mockRejectedValue(new Error("Hub STT injoignable")) };
    await expect(
      new OcrPipelineProcessor(pipeline as never).process(job(OCR_PIPELINE_JOBS.TRANSCRIBE_AND_EXTRACT, PAYLOAD)),
    ).rejects.toThrow(/Hub STT injoignable/);
  });
});
