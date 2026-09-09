import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { PdpProcessor } from "./pdp.processor";
import {
  ETAX_INVOICING_UNITARY,
  ETAX_REPORTING_CONSOLIDATION_CRON,
  ETAX_REPORTING_PERIODIC,
} from "./pdp.constants";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";

const PAYLOAD: PdpInvoicingJobPayload = {
  rawTransactionId: "11111111-2222-3333-4444-555555555555",
  organizationId: "org-1",
  clientUniqueId: "INV/2026/00042",
};

const RESULTAT = {
  rawTransactionId: PAYLOAD.rawTransactionId,
  invoiceId: "inv-1",
  certificationId: "GN-12345678-2026-ABC123",
  skipped: false,
};

const RESULTAT_Z = {
  organizationId: "org-caisse",
  invoiceId: "inv-z",
  certificationId: "GN-12345678-2026-ZZZ999",
  reportingSeriesNumber: "ZR-2026-000004",
  ticketCount: 50,
  totalHtCentimes: BigInt(42_066_066_925),
  totalVatCentimes: BigInt(7_571_893_025),
  skipped: false,
};

const job = (name: string, data: unknown = PAYLOAD, attemptsMade = 0) =>
  ({ name, data, attemptsMade }) as never;

/** File factice. `add` compte les jobs posés par l'éventail — c'est la seule
 *  chose que le processeur écrit dans Redis. */
function fileFactice() {
  return { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
}

const processeur = (consolidation: unknown, queue: unknown = fileFactice()) =>
  new PdpProcessor(consolidation as never, queue as never);

describe("PdpProcessor — aiguillage sur job.name", () => {
  it("délègue un document unitaire au service de consolidation", async () => {
    const consolidation = { consolidateUnitary: vi.fn().mockResolvedValue(RESULTAT) };

    await expect(processeur(consolidation).process(job(ETAX_INVOICING_UNITARY))).resolves.toEqual(
      RESULTAT,
    );
    // Le payload est passé TEL QUEL : c'est le service qui relit la ligne
    // tampon, le processeur n'interprète jamais le document.
    expect(consolidation.consolidateUnitary).toHaveBeenCalledWith(PAYLOAD);
  });

  // LE TEST QUI PROTÈGE LE FLUX B2C. Un lot de caisse consolidé à l'unité
  // produirait une facture certifiée — et un numéro Article 23 consommé — par
  // micro-vente, là où la DGI attend un Z de caisse agrégé. Irréversible.
  //
  // La branche e-reporting fait désormais un vrai travail (tranche 3), mais ce
  // travail n'est JAMAIS consolidateUnitary : c'est exactement ce que ce test
  // continue de garder.
  it("compile un lot e-reporting, et ne le traite JAMAIS à l'unité", async () => {
    const consolidation = {
      consolidateUnitary: vi.fn(),
      consolidatePeriodicReporting: vi.fn().mockResolvedValue(RESULTAT_Z),
    };

    await expect(
      processeur(consolidation).process(job(ETAX_REPORTING_PERIODIC, { organizationId: "org-caisse" })),
    ).resolves.toEqual(RESULTAT_Z);
    expect(consolidation.consolidateUnitary).not.toHaveBeenCalled();
    expect(consolidation.consolidatePeriodicReporting).toHaveBeenCalledWith("org-caisse");
  });

  // Un job e-reporting sans organizationId ne dit pas QUELLE caisse compiler.
  // Le laisser passer en ferait une erreur opaque de setOrganizationScope, cinq
  // fois de suite ; nommé ici, il coupe le backoff tout de suite.
  it("refuse définitivement un lot e-reporting sans organizationId", async () => {
    const consolidation = { consolidatePeriodicReporting: vi.fn() };

    await expect(
      processeur(consolidation).process(job(ETAX_REPORTING_PERIODIC, { organizationId: "  " })),
    ).rejects.toThrow(UnrecoverableError);
    expect(consolidation.consolidatePeriodicReporting).not.toHaveBeenCalled();
  });

  // Même garde côté unitaire : un payload forgé ou tronqué n'atteint jamais une
  // transaction qui pose un scope RLS.
  it("refuse définitivement un job unitaire à la charge utile incomplète", async () => {
    const consolidation = { consolidateUnitary: vi.fn() };

    await expect(
      processeur(consolidation).process(job(ETAX_INVOICING_UNITARY, { organizationId: "org-1" })),
    ).rejects.toThrow(UnrecoverableError);
    expect(consolidation.consolidateUnitary).not.toHaveBeenCalled();
  });

  // Rejouer cinq fois un job qu'on ne sait pas traiter n'a jamais fait
  // apparaître le code manquant : UnrecoverableError coupe le backoff.
  it("refuse définitivement un type de job inconnu", async () => {
    await expect(
      processeur({ consolidateUnitary: vi.fn() }).process(job("consolider-quelque-chose")),
    ).rejects.toThrow(UnrecoverableError);
  });

  it("refuse aussi un job sans nom", async () => {
    await expect(processeur({ consolidateUnitary: vi.fn() }).process(job(""))).rejects.toThrow(
      UnrecoverableError,
    );
  });

  // Garde de non-régression sur le nom lui-même : la valeur de la constante est
  // ce que PdpInvoiceService.enfiler() écrit dans Redis. La changer d'un côté
  // seulement laisserait les jobs déjà déposés tomber sur la branche inconnue.
  it("reconnaît exactement les noms enfilés par l'ingestion", async () => {
    const consolidation = { consolidateUnitary: vi.fn().mockResolvedValue(RESULTAT) };
    await expect(
      processeur(consolidation).process(job("etax-invoicing-unitary")),
    ).resolves.toEqual(RESULTAT);
  });
});

describe("PdpProcessor — remontée des échecs", () => {
  // Le processeur ne rattrape RIEN, à dessein : c'est l'exception qui remonte
  // qui fait échouer le job et déclenche le backoff exponentiel. La rattraper
  // ici marquerait le job « completed » alors que rien n'a été certifié.
  it("laisse remonter une panne passagère du service", async () => {
    const consolidation = {
      consolidateUnitary: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")),
    };

    await expect(processeur(consolidation).process(job(ETAX_INVOICING_UNITARY))).rejects.toThrow(
      /503/,
    );
  });

  it("laisse remonter un refus définitif sans le convertir", async () => {
    const consolidation = {
      consolidateUnitary: vi
        .fn()
        .mockRejectedValue(new UnrecoverableError("Document PDP refusé définitivement : 400")),
    };

    await expect(processeur(consolidation).process(job(ETAX_INVOICING_UNITARY))).rejects.toThrow(
      UnrecoverableError,
    );
  });
});

describe("PdpProcessor — l'éventail du cron de regroupement", () => {
  // Le cron n'écrit RIEN en base : il énumère et il enfile. Un lot Odoo qui
  // échoue chez une PME ne fait donc jamais attendre les 400 autres.
  it("pose un job de compilation par organisation en attente", async () => {
    const consolidation = {
      listOrganizationsWithPendingReporting: vi.fn().mockResolvedValue(["org-a", "org-b", "org-c"]),
      consolidatePeriodicReporting: vi.fn(),
    };
    const queue = fileFactice();

    const resultat = await processeur(consolidation, queue).process(
      job(ETAX_REPORTING_CONSOLIDATION_CRON, {}),
    );

    expect(resultat).toEqual({ organizationsFanned: 3, enqueueFailures: 0 });
    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add.mock.calls.map((appel) => appel[1])).toEqual([
      { organizationId: "org-a" },
      { organizationId: "org-b" },
      { organizationId: "org-c" },
    ]);
    // Chaque job posé porte le nom que la branche périodique reconnaît. Un autre
    // nom tomberait sur la branche « type inconnu » et mourrait sans réessai —
    // un Z de caisse perdu.
    expect(queue.add.mock.calls.every((appel) => appel[0] === ETAX_REPORTING_PERIODIC)).toBe(true);
    // L'éventail ne consolide JAMAIS lui-même : tout le travail lourd vit
    // derrière les jobs qu'il pose.
    expect(consolidation.consolidatePeriodicReporting).not.toHaveBeenCalled();
  });

  it("n'enfile rien quand aucune organisation n'a de ticket en attente", async () => {
    const consolidation = {
      listOrganizationsWithPendingReporting: vi.fn().mockResolvedValue([]),
    };
    const queue = fileFactice();

    const resultat = await processeur(consolidation, queue).process(
      job(ETAX_REPORTING_CONSOLIDATION_CRON, {}),
    );

    expect(resultat).toEqual({ organizationsFanned: 0, enqueueFailures: 0 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  // UN échec d'enfilement n'interrompt pas l'éventail : Redis qui refuse un job
  // pour une organisation ne doit pas priver les suivantes de leur compilation.
  it("poursuit l'éventail malgré un enfilement perdu, et le compte", async () => {
    const consolidation = {
      listOrganizationsWithPendingReporting: vi.fn().mockResolvedValue(["org-a", "org-b", "org-c"]),
    };
    const queue = {
      add: vi
        .fn()
        .mockResolvedValueOnce({ id: "1" })
        .mockRejectedValueOnce(new Error("Redis indisponible"))
        .mockResolvedValueOnce({ id: "3" }),
    };

    const resultat = await processeur(consolidation, queue).process(
      job(ETAX_REPORTING_CONSOLIDATION_CRON, {}),
    );

    expect(resultat).toEqual({ organizationsFanned: 2, enqueueFailures: 1 });
    expect(queue.add).toHaveBeenCalledTimes(3);
  });

  // Toutes les organisations perdues = Redis globalement KO. Rendre le job
  // « completed » ferait passer pour un passage réussi une heure sans aucune
  // compilation : c'est précisément la panne silencieuse que la file existe pour
  // empêcher.
  it("fait ÉCHOUER le passage quand aucune organisation n'a pu être enfilée", async () => {
    const consolidation = {
      listOrganizationsWithPendingReporting: vi.fn().mockResolvedValue(["org-a", "org-b"]),
    };
    const queue = { add: vi.fn().mockRejectedValue(new Error("Redis indisponible")) };

    await expect(
      processeur(consolidation, queue).process(job(ETAX_REPORTING_CONSOLIDATION_CRON, {})),
    ).rejects.toThrow(/aucune des 2 organisations/);
  });

  // Garde de non-régression sur le nom lui-même : c'est la valeur que
  // PdpModule.onModuleInit écrit dans le scheduler Redis. La changer d'un côté
  // seulement ferait tomber chaque passage horaire sur la branche inconnue.
  it("reconnaît exactement le nom armé par le scheduler", async () => {
    const consolidation = { listOrganizationsWithPendingReporting: vi.fn().mockResolvedValue([]) };

    await expect(
      processeur(consolidation).process(job("etax-reporting-consolidation-cron", {})),
    ).resolves.toEqual({ organizationsFanned: 0, enqueueFailures: 0 });
  });
});
