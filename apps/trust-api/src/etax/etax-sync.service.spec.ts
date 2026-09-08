import { UnrecoverableError } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EtaxSyncService } from "./etax-sync.service";
import type { EtaxDeclarationPayload } from "./etax-declaration";

// organizationScopedClient() appelle `$extends`. Le vrai client l'offre ; un faux
// qui ne l'offre pas ne teste pas le service, il plante dessus. `$extends` rend
// le client LUI-MÊME pour que les mocks de modèle restent partagés, et
// `$transaction` en forme tableau est celle qu'emploie makeScopedOperation() —
// c'est ce qui rend l'extension rejouable, seul moyen d'épingler la VALEUR du
// scope.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction =
    p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  return prisma;
}

const ORG = "org-du-declarant";

const CLOTURE = {
  id: "closing-1",
  organizationId: ORG,
  year: 2025,
  totalHt: 1_000_000n,
  totalTva: 180_000n,
  totalTtc: 1_180_000n,
  sealHash: "sceau-abc",
  etaxSubmittedAt: null as Date | null,
  etaxSubmissionRef: null as string | null,
};

const JOB: EtaxDeclarationPayload = {
  organizationId: ORG,
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

function fakePrisma(overrides: { closing?: unknown; organization?: unknown } = {}) {
  return auClientScope({
    fiscalPeriodClosing: {
      findFirst: vi.fn().mockResolvedValue("closing" in overrides ? overrides.closing : { ...CLOTURE }),
      update: vi.fn(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
    organization: {
      findFirst: vi.fn().mockResolvedValue(
        "organization" in overrides ? overrides.organization : { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" },
      ),
    },
  });
}

function compteur() {
  return { inc: vi.fn() };
}

function construire(prisma: unknown, queue: unknown, client: unknown) {
  return new EtaxSyncService(
    prisma as never,
    queue as never,
    client as never,
    compteur() as never,
    compteur() as never,
    compteur() as never,
  );
}

function fakeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
}

function fakeClient(result: unknown = { submissionRef: "ACK-2025-001" }) {
  return { submit: vi.fn().mockResolvedValue(result) };
}

beforeEach(() => {
  process.env.ETAX_ENABLED = "true";
});
afterEach(() => {
  delete process.env.ETAX_ENABLED;
});

// ═══ ENFILEMENT ═══════════════════════════════════════════════════════════════
describe("EtaxSyncService.enqueueForClosing", () => {
  it("enfile la déclaration avec le profil de backoff exponentiel", async () => {
    const queue = fakeQueue();
    const service = construire(fakePrisma(), queue, fakeClient());

    await service.enqueueForClosing(CLOTURE);

    const [nom, payload, options] = queue.add.mock.calls[0];
    expect(nom).toBe("declare-fiscal-period");
    expect(payload).toMatchObject({ organizationId: ORG, year: 2025, taxCode: "TVA-18", sealHash: "sceau-abc" });
    expect(options).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
    });
  });

  // Un jobId déterministe empêche deux clôtures rejouées (double clic, retry
  // client) de produire deux déclarations pour le même exercice.
  it("le jobId est déterministe — organisation + exercice", async () => {
    const queue = fakeQueue();
    const service = construire(fakePrisma(), queue, fakeClient());

    await service.enqueueForClosing(CLOTURE);

    expect(queue.add.mock.calls[0][2]).toMatchObject({ jobId: `closing-${ORG}-2025` });
    // BullMQ réserve « : » pour ses clés Redis et REJETTE tout jobId qui en
    // contient. Le jobId portait un deux-points : queue.add() levait, et comme
    // enqueueForClosing() n avale ses erreurs, AUCUNE clôture ne s enfilait —
    // silencieusement. La file étant mockée ici, rien ne le disait.
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(":");
  });

  // LE POINT CRITIQUE de l'enfilement. Une clôture d'exercice est un acte
  // comptable engageant (sceau OHADA) : elle est déjà commitée quand on arrive
  // ici. Laisser remonter une panne Redis la ferait échouer côté HTTP alors
  // qu'elle est acquise en base.
  it("Redis en panne : n'explose JAMAIS — la clôture reste acquise", async () => {
    const queue = { add: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    const service = construire(fakePrisma(), queue, fakeClient());

    await expect(service.enqueueForClosing(CLOTURE)).resolves.toBeUndefined();
  });

  it("organisation sans numéro eTax : absorbé aussi, rien n'est enfilé", async () => {
    const queue = fakeQueue();
    const prisma = fakePrisma({ organization: { etaxNumber: null, regimeFiscal: "normal_tva" } });
    const service = construire(prisma, queue, fakeClient());

    await expect(service.enqueueForClosing(CLOTURE)).resolves.toBeUndefined();
    expect(queue.add).not.toHaveBeenCalled();
  });

  // Le défaut est « ne transmet pas » : sans opt-in explicite, un environnement
  // de dev qui clôture un exercice écrirait chez la DGI. Une déclaration fiscale
  // ne se retire pas.
  it("ETAX_ENABLED absent : rien n'est enfilé", async () => {
    delete process.env.ETAX_ENABLED;
    const queue = fakeQueue();
    const service = construire(fakePrisma(), queue, fakeClient());

    await service.enqueueForClosing(CLOTURE);

    expect(queue.add).not.toHaveBeenCalled();
  });

  // DOUBLE ÉPINGLAGE, volet 1 — la VALEUR portée par le client scopé. Les faux
  // `$extends` se renvoyant eux-mêmes, elle n'est observable qu'en rejouant
  // l'extension capturée.
  it("lit l'organisation sous le scope de la clôture, jamais un autre", async () => {
    const prisma = fakePrisma();
    const service = construire(prisma, fakeQueue(), fakeClient());

    await service.enqueueForClosing({ ...CLOTURE, organizationId: "org-a-proteger" });

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });
});

// ═══ TRAITEMENT DU JOB ════════════════════════════════════════════════════════
describe("EtaxSyncService.processDeclaration", () => {
  it("transmet la déclaration et marque la clôture acquittée", async () => {
    const prisma = fakePrisma();
    const client = fakeClient();
    const service = construire(prisma, fakeQueue(), client);

    const resultat = await service.processDeclaration(JOB);

    expect(resultat).toEqual({ submissionRef: "ACK-2025-001", skipped: false });
    expect(client.submit).toHaveBeenCalledWith(
      expect.objectContaining({ etaxNumber: "ETAX-42", totalTtc: "1180000", taxCode: "TVA-18" }),
    );
    expect((prisma as any).fiscalPeriodClosing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "closing-1" },
        data: expect.objectContaining({ etaxSubmissionRef: "ACK-2025-001" }),
      }),
    );
  });

  // DOUBLE ÉPINGLAGE, volet 2 — le worker n'a NI session, NI RolesGuard, NI
  // requête HTTP : rien ne pose de scope pour lui. C'est l'invariant central du
  // module. Sans scope explicite, une erreur de payload ferait déclarer à la DGI
  // les montants d'une autre PME sous le numéro eTax de la première.
  it("pose app.current_org_id sur l'organisation du JOB, jamais une autre", async () => {
    const prisma = fakePrisma({ closing: { ...CLOTURE, organizationId: "org-du-job" } });
    const service = construire(prisma, fakeQueue(), fakeClient());

    await service.processDeclaration({ ...JOB, organizationId: "org-du-job" });

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-du-job");
  });

  it("la clôture est lue avec la DOUBLE CLAUSE, jamais par id seul", async () => {
    const prisma = fakePrisma();
    const service = construire(prisma, fakeQueue(), fakeClient());

    await service.processDeclaration(JOB);

    expect((prisma as any).fiscalPeriodClosing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "closing-1", organizationId: ORG } }),
    );
  });

  // CETTE lecture-ci doit être scopée, pas seulement celle de buildPayload.
  // Les deux clients scopés sont des constructions DISTINCTES : une assertion
  // qui rejoue « le » $extends attrape celui de buildPayload, en aval, et
  // laisserait passer une lecture de clôture faite sur le client nu. On se
  // place donc sur le chemin idempotent, où buildPayload n'est JAMAIS atteint :
  // tout $extends observé ne peut alors venir que de la lecture de la clôture.
  it("la lecture de la clôture est elle-même scopée — rien ne pose de scope pour un worker", async () => {
    const prisma = fakePrisma({
      closing: { ...CLOTURE, etaxSubmittedAt: new Date("2026-01-15T10:00:00Z"), etaxSubmissionRef: "ACK" },
    });
    const client = fakeClient();
    const service = construire(prisma, fakeQueue(), client);

    await service.processDeclaration({ ...JOB, organizationId: ORG });

    expect(client.submit).not.toHaveBeenCalled(); // on est bien sur le chemin idempotent
    expect((prisma as any).$extends).toHaveBeenCalled();

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain(ORG);
  });

  // Et le scope doit précéder la lecture, pas la suivre.
  it("le scope est posé AVANT la lecture de la clôture", async () => {
    const prisma = fakePrisma();
    const service = construire(prisma, fakeQueue(), fakeClient());

    await service.processDeclaration(JOB);

    const scope = (prisma as any).$extends.mock.invocationCallOrder[0];
    const lecture = (prisma as any).fiscalPeriodClosing.findFirst.mock.invocationCallOrder[0];
    expect(scope).toBeLessThan(lecture);
  });

  // Le payload part de la BASE, pas du job : le job n'est qu'un déclencheur.
  // Sinon un job forgé ou périmé dicterait les montants déclarés à la DGI.
  it("le payload transmis vient de la base, jamais des montants portés par le job", async () => {
    const prisma = fakePrisma({ closing: { ...CLOTURE, totalTtc: 999n, totalHt: 900n, totalTva: 99n } });
    const client = fakeClient();
    const service = construire(prisma, fakeQueue(), client);

    await service.processDeclaration({ ...JOB, totalTtc: "1180000", totalHt: "1000000", totalTva: "180000" });

    expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({ totalTtc: "999" }));
  });

  // Une déclaration fiscale transmise ne se retire pas : un réessai après un
  // acquittement dont la réponse s'est perdue ne doit pas redéclarer.
  it("idempotent : une clôture déjà acquittée n'est pas redéclarée", async () => {
    const prisma = fakePrisma({
      closing: { ...CLOTURE, etaxSubmittedAt: new Date("2026-01-15T10:00:00Z"), etaxSubmissionRef: "ACK-PRECEDENT" },
    });
    const client = fakeClient();
    const service = construire(prisma, fakeQueue(), client);

    const resultat = await service.processDeclaration(JOB);

    expect(resultat).toEqual({ submissionRef: "ACK-PRECEDENT", skipped: true });
    expect(client.submit).not.toHaveBeenCalled();
    expect((prisma as any).fiscalPeriodClosing.update).not.toHaveBeenCalled();
  });

  it("sceau divergent : erreur DÉFINITIVE, rien n'est transmis", async () => {
    const prisma = fakePrisma({ closing: { ...CLOTURE, sealHash: "sceau-different" } });
    const client = fakeClient();
    const service = construire(prisma, fakeQueue(), client);

    await expect(service.processDeclaration(JOB)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(client.submit).not.toHaveBeenCalled();
  });

  it("clôture introuvable : erreur DÉFINITIVE, aucun réessai à espérer", async () => {
    const service = construire(fakePrisma({ closing: null }), fakeQueue(), fakeClient());

    await expect(service.processDeclaration(JOB)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("organisation sans numéro eTax : erreur DÉFINITIVE", async () => {
    const prisma = fakePrisma({ organization: { etaxNumber: null, regimeFiscal: "normal_tva" } });
    const service = construire(prisma, fakeQueue(), fakeClient());

    await expect(service.processDeclaration(JOB)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  // La distinction qui fait toute la résilience : une panne d'eTax est
  // TRANSITOIRE. Elle doit remonter telle quelle pour que le backoff reprenne la
  // main — surtout pas en UnrecoverableError, qui arrêterait les réessais.
  it("panne eTax : erreur TRANSITOIRE relayée telle quelle, la clôture reste non acquittée", async () => {
    const prisma = fakePrisma();
    const client = { submit: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")) };
    const service = construire(prisma, fakeQueue(), client);

    const erreur = await service.processDeclaration(JOB).catch((e) => e);

    expect(erreur).not.toBeInstanceOf(UnrecoverableError);
    expect(erreur.message).toMatch(/503/);
    expect((prisma as any).fiscalPeriodClosing.update).not.toHaveBeenCalled();
  });
});
