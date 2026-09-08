import { UnrecoverableError } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EtaxInvoiceService } from "./etax-invoice.service";
import { EtaxRejetDefinitif } from "./etax.client";
import { ETAX_INVOICE_JOB } from "./etax.constants";
import { ACQUEREUR_PARTICULIER, buildEtaxInvoice, type EtaxInvoicePayload } from "./etax-invoice";

const ORG = "org-1";
const FACTURE = "inv-1";

const PAYLOAD: EtaxInvoicePayload = {
  invoiceId: FACTURE,
  organizationId: ORG,
  etaxNumberEmetteur: "ETAX-42",
  nifAcquereur: "NIF-CLIENT",
  numero: "FG-2026-000042",
  certificationId: "GN-12345678-2026-ABC123",
  totalHt: "1000000",
  totalTva: "180000",
  totalTtc: "1180000",
  taxRateBps: 1800,
  taxCode: "TVA-18",
  issuedAt: "2026-09-08T10:00:00.000Z",
  hash: "hash-facture",
};

const FACTURE_EMISE = {
  id: FACTURE,
  organizationId: ORG,
  number: "FG-2026-000042",
  certificationId: "GN-12345678-2026-ABC123",
  hash: "hash-facture",
  totalHt: 1_000_000n,
  totalTva: 180_000n,
  totalTtc: 1_180_000n,
  issuedAt: new Date("2026-09-08T10:00:00.000Z"),
  customer: { nif: "NIF-CLIENT" },
};

// Le client scopé rendu par $extends partage les mocks — sauf invoice.findFirst,
// qui reçoit un mock distinct, pour qu'une lecture oubliant le scope ne puisse
// pas emprunter le même espion que la lecture scopée.
type ClientFaux<T> = T & {
  $extends: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  scopeView: any;
};

function fakePrisma(overrides: { existante?: unknown } = {}) {
  const p: any = {
    invoice: {
      findFirst: vi.fn().mockResolvedValue(overrides.existante ?? null),
      findFirstOrThrow: vi.fn().mockResolvedValue(FACTURE_EMISE),
      update: vi.fn().mockResolvedValue({}),
    },
    organization: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" }),
    },
    invoiceEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  p.$executeRaw = vi.fn().mockResolvedValue(1);
  p.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(p)));

  // Les mocks scopés et bruts doivent être INDÉPENDANTS : partagés, une lecture
  // qui oublie le scope emprunterait le même espion que la lecture scopée et
  // passerait inaperçue. Côté brut, on LÈVE — aucune lecture de ce service n'a
  // de raison légitime de sortir du scope.
  const lectureScopee = p.invoice.findFirst;
  const detailScope = p.invoice.findFirstOrThrow;
  const orgScope = p.organization.findFirstOrThrow;
  const horsScope = () =>
    vi.fn().mockRejectedValue(new Error("lecture hors scope — le worker n'a ni session ni requête"));
  p.invoice.findFirst = horsScope();
  p.invoice.findFirstOrThrow = horsScope();
  p.organization.findFirstOrThrow = horsScope();
  const scope = {
    ...p,
    invoice: { ...p.invoice, findFirst: lectureScopee, findFirstOrThrow: detailScope },
    organization: { ...p.organization, findFirstOrThrow: orgScope },
  };
  p.$extends = vi.fn(() => scope);
  p.scopeView = scope;
  return p as ClientFaux<typeof p>;
}

const compteur = () => ({ inc: vi.fn() });

function service(prisma: any, client: any, compteurs = { t: compteur(), f: compteur(), e: compteur() }) {
  const queue = { add: vi.fn().mockResolvedValue({ id: "job-1" }) };
  const svc = new EtaxInvoiceService(
    prisma as never,
    queue as never,
    client as never,
    compteurs.t as never,
    compteurs.f as never,
    compteurs.e as never,
  );
  return { svc, queue, compteurs };
}

beforeEach(() => {
  process.env.ETAX_ENABLED = "true";
});
afterEach(() => {
  delete process.env.ETAX_ENABLED;
  vi.restoreAllMocks();
});

describe("buildEtaxInvoice", () => {
  it("assemble le payload d'une facture certifiée", () => {
    const payload = buildEtaxInvoice(
      FACTURE_EMISE,
      { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" },
      { nif: "NIF-CLIENT" },
    );
    expect(payload).toMatchObject({
      invoiceId: FACTURE,
      etaxNumberEmetteur: "ETAX-42",
      nifAcquereur: "NIF-CLIENT",
      numero: "FG-2026-000042",
      taxCode: "TVA-18",
      taxRateBps: 1800,
      hash: "hash-facture",
    });
  });

  // Les montants partent en CHAÎNE : BullMQ écrit `data` en JSON dans Redis, et
  // JSON.stringify(1n) lève.
  it("sérialise les montants en chaîne, jamais en BigInt ni en Number", () => {
    const payload = buildEtaxInvoice(
      FACTURE_EMISE,
      { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" },
      null,
    );
    expect(payload.totalTtc).toBe("1180000");
    expect(typeof payload.totalTtc).toBe("string");
    expect(() => JSON.stringify(payload)).not.toThrow();
  });

  // Un client sans NIF est le cas NORMAL du commerce de détail, pas une anomalie.
  it("déclare un acquéreur sans NIF comme particulier", () => {
    const payload = buildEtaxInvoice(
      FACTURE_EMISE,
      { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" },
      { nif: null },
    );
    expect(payload.nifAcquereur).toBe(ACQUEREUR_PARTICULIER);
  });

  it("refuse une organisation sans numéro eTax", () => {
    expect(() =>
      buildEtaxInvoice(FACTURE_EMISE, { etaxNumber: null, regimeFiscal: "normal_tva" }, null),
    ).toThrow(/numéro eTax/);
  });

  // Transmettre une facture non certifiée enverrait à la DGI un document
  // qu'aucune vérification publique ne pourra rapprocher.
  it("refuse une facture sans numéro, sans certification ou sans hash", () => {
    const org = { etaxNumber: "ETAX-42", regimeFiscal: "normal_tva" } as const;
    expect(() => buildEtaxInvoice({ ...FACTURE_EMISE, number: null }, org, null)).toThrow(/non certifiée/);
    expect(() => buildEtaxInvoice({ ...FACTURE_EMISE, hash: null }, org, null)).toThrow(/non certifiée/);
    expect(() => buildEtaxInvoice({ ...FACTURE_EMISE, certificationId: null }, org, null)).toThrow(
      /non certifiée/,
    );
    expect(() => buildEtaxInvoice({ ...FACTURE_EMISE, issuedAt: null }, org, null)).toThrow(
      /non certifiée/,
    );
  });

  // Les trois régimes à 0 bps remplissent trois cases différentes chez la DGI.
  it("porte le code de régime, jamais un taux plat", () => {
    const codes = (["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"] as const).map(
      (regimeFiscal) =>
        buildEtaxInvoice(FACTURE_EMISE, { etaxNumber: "E", regimeFiscal }, null).taxCode,
    );
    expect(new Set(codes).size).toBe(4);
  });
});

describe("enqueueForInvoice", () => {
  it("marque pending puis enfile la facture", async () => {
    const prisma = fakePrisma();
    const { svc, queue } = service(prisma, {});

    await svc.enqueueForInvoice(FACTURE, ORG);

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { etaxStatus: "pending" } }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      ETAX_INVOICE_JOB,
      expect.objectContaining({ invoiceId: FACTURE }),
      expect.objectContaining({ jobId: `invoice-${FACTURE}` }),
    );
  });

  // Un double clic sur « Émettre » ne doit pas produire deux transmissions : le
  // jobId déterministe laisse BullMQ dédoublonner.
  it("porte un jobId déterministe", async () => {
    const { svc, queue } = service(fakePrisma(), {});
    await svc.enqueueForInvoice(FACTURE, ORG);
    expect(queue.add.mock.calls[0][2].jobId).toBe(`invoice-${FACTURE}`);
  });

  // BullMQ réserve « : » pour ses clés Redis et REJETTE tout jobId qui en
  // contient (« Custom Id cannot contain : »). La file étant mockée dans ces
  // tests, rien ne le signalait — le défaut ne s'est vu qu'en émettant une vraie
  // facture. Cette assertion-ci remplace ce constat.
  it("n'emploie jamais un jobId que BullMQ refuserait", async () => {
    const { svc, queue } = service(fakePrisma(), {});
    await svc.enqueueForInvoice(FACTURE, ORG);
    expect(queue.add.mock.calls[0][2].jobId).not.toContain(":");
  });

  // `pending` doit signifier « un job existe ». Sinon la facture se présente
  // indéfiniment comme en attente de la DGI, et le rattrapage passe à côté.
  it("défait le marquage pending si l'enfilement échoue", async () => {
    const prisma = fakePrisma();
    const { svc, queue } = service(prisma, {});
    queue.add.mockRejectedValue(new Error("Redis injoignable"));

    await svc.enqueueForInvoice(FACTURE, ORG);

    expect(prisma.invoice.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { etaxStatus: null } }),
    );
  });

  it("porte le profil de réessai (5 tentatives, backoff exponentiel)", async () => {
    const { svc, queue } = service(fakePrisma(), {});
    await svc.enqueueForInvoice(FACTURE, ORG);
    expect(queue.add.mock.calls[0][2]).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
    });
  });

  // Sans opt-in explicite, tout environnement de développement écrirait chez la
  // DGI — et une transmission fiscale ne se retire pas.
  it("ne transmet rien tant que ETAX_ENABLED n'est pas true", async () => {
    process.env.ETAX_ENABLED = "false";
    const prisma = fakePrisma();
    const { svc, queue } = service(prisma, {});

    await svc.enqueueForInvoice(FACTURE, ORG);

    expect(queue.add).not.toHaveBeenCalled();
    // Et surtout : aucun marquage. Une facture affichée « en attente de la DGI »
    // alors que personne ne l'a mise en file serait un mensonge à l'écran.
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  // NE LÈVE JAMAIS : la facture est déjà certifiée et committée. Redis éteint ne
  // doit pas transformer une émission réussie en erreur pour le commerçant.
  it("n'échoue jamais si Redis est indisponible", async () => {
    const prisma = fakePrisma();
    const { svc, queue, compteurs } = service(prisma, {});
    queue.add.mockRejectedValue(new Error("Redis injoignable"));

    await expect(svc.enqueueForInvoice(FACTURE, ORG)).resolves.toBeUndefined();
    expect(compteurs.e.inc).toHaveBeenCalled();
  });

  it("n'échoue pas non plus si le payload est inconstructible", async () => {
    const prisma = fakePrisma();
    prisma.organization.findFirstOrThrow = vi
      .fn()
      .mockResolvedValue({ etaxNumber: null, regimeFiscal: "normal_tva" });
    const { svc } = service(prisma, {});

    await expect(svc.enqueueForInvoice(FACTURE, ORG)).resolves.toBeUndefined();
  });

  it("lit sous le scope de l'organisation, jamais une autre", async () => {
    const prisma = fakePrisma();
    const { svc } = service(prisma, {});

    await svc.enqueueForInvoice(FACTURE, "org-a-proteger");

    const extension = prisma.$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = prisma.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("org-a-proteger");

    // Double épinglage : le GUC porte la bonne organisation, ET la facture est
    // bien lue par le client scopé — deux constructions distinctes.
    expect(prisma.scopeView.invoice.findFirstOrThrow).toHaveBeenCalled();
    expect(prisma.invoice.findFirstOrThrow).not.toHaveBeenCalled();
  });
});

describe("processTransmission", () => {
  const clientOk = () => ({ submitInvoice: vi.fn().mockResolvedValue({ submissionRef: "RECU-9" }) });

  it("transmet, enregistre le reçu et journalise l'événement", async () => {
    const prisma = fakePrisma();
    const client = clientOk();
    const { svc, compteurs } = service(prisma, client);

    await expect(svc.processTransmission(PAYLOAD)).resolves.toEqual({
      receiptNumber: "RECU-9",
      skipped: false,
    });

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ etaxStatus: "transmitted", etaxReceiptNumber: "RECU-9" }),
      }),
    );
    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "etax_transmitted" }) }),
    );
    expect(compteurs.t.inc).toHaveBeenCalled();
  });

  // Le worker n'a NI session NI requête HTTP : rien ne pose de scope pour lui.
  it("pose le scope de l'organisation avant d'écrire", async () => {
    const prisma = fakePrisma();
    const { svc } = service(prisma, clientOk());

    await svc.processTransmission({ ...PAYLOAD, organizationId: "org-a-proteger" });

    const setConfig = prisma.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("org-a-proteger");
  });

  // Un redémarrage entre l'écriture et l'ack Redis rejoue le job : on ne
  // retransmet pas, la DGI a déjà le reçu.
  it("ignore une facture déjà transmise", async () => {
    const prisma = fakePrisma({
      existante: { etaxStatus: "transmitted", etaxReceiptNumber: "RECU-DEJA" },
    });
    const client = clientOk();
    const { svc } = service(prisma, client);

    await expect(svc.processTransmission(PAYLOAD)).resolves.toEqual({
      receiptNumber: "RECU-DEJA",
      skipped: true,
    });
    expect(client.submitInvoice).not.toHaveBeenCalled();
  });

  it("retransmet si le statut dit transmis mais qu'aucun reçu n'a été enregistré", async () => {
    const prisma = fakePrisma({ existante: { etaxStatus: "transmitted", etaxReceiptNumber: null } });
    const client = clientOk();
    const { svc } = service(prisma, client);

    await svc.processTransmission(PAYLOAD);
    expect(client.submitInvoice).toHaveBeenCalled();
  });

  // Une panne du guichet doit REJOUER : c'est l'exception qui déclenche le
  // backoff. L'avaler marquerait le job « completed » sans que la DGI ait reçu.
  it("laisse remonter une panne passagère, sans marquer d'échec", async () => {
    const prisma = fakePrisma();
    const client = { submitInvoice: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")) };
    const { svc, compteurs } = service(prisma, client);

    await expect(svc.processTransmission(PAYLOAD)).rejects.toThrow(/503/);
    // Écrire `failed` dès la première tentative afficherait au commerçant un
    // échec que les quatre suivantes vont peut-être démentir.
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(compteurs.f.inc).toHaveBeenCalledWith({ reason: "transitoire" });
  });

  it("ne se transforme jamais en UnrecoverableError sur une panne passagère", async () => {
    const client = { submitInvoice: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")) };
    const { svc } = service(fakePrisma(), client);

    await expect(svc.processTransmission(PAYLOAD)).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  // Un refus définitif rejoué à l'identique sera refusé à l'identique :
  // s'acharner bloquerait la file derrière des milliers de factures par jour.
  it("coupe le backoff sur un refus définitif et marque l'échec", async () => {
    const prisma = fakePrisma();
    const client = { submitInvoice: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(422)) };
    const { svc, compteurs } = service(prisma, client);

    await expect(svc.processTransmission(PAYLOAD)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { etaxStatus: "failed" } }),
    );
    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "etax_transmission_failed" }),
      }),
    );
    expect(compteurs.f.inc).toHaveBeenCalledWith({ reason: "rejet_definitif" });
  });

  // Le journal d'échec est lisible par le commerçant : il porte la cause, jamais
  // l'écho du guichet, qui contient le numéro eTax et les montants.
  it("ne journalise que la cause, jamais le corps de la réponse du guichet", async () => {
    const prisma = fakePrisma();
    const client = { submitInvoice: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(422)) };
    const { svc } = service(prisma, client);

    await expect(svc.processTransmission(PAYLOAD)).rejects.toBeInstanceOf(UnrecoverableError);

    const metadata = prisma.invoiceEvent.create.mock.calls.at(-1)?.[0].data.metadata;
    expect(JSON.stringify(metadata)).not.toContain("ETAX-42");
    expect(JSON.stringify(metadata)).not.toContain("1180000");
    expect(metadata.cause).toContain("422");
  });

  it("n'invente pas d'acteur dans le journal WORM", async () => {
    const prisma = fakePrisma();
    const { svc } = service(prisma, clientOk());

    await svc.processTransmission(PAYLOAD);

    const data = prisma.invoiceEvent.create.mock.calls.at(-1)?.[0].data;
    expect(data.actorId).toBeUndefined();
  });
});
