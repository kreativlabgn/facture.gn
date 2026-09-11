import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdpInvoiceService, flowForTransactionType } from "./pdp-invoice.service";
import { buildPdpJobId, ETAX_INVOICING_UNITARY } from "./pdp.constants";
import type { CreatePdpInvoiceDto } from "./dto/create-pdp-invoice.dto";

const ORG = "org-1";
const API_KEY_ID = "key-1";
const CLIENT_UNIQUE_ID = "INV/2026/00042";
const LIGNE_ID = "11111111-2222-3333-4444-555555555555";
const CERT_ID = "GN-12345678-2026-ABC123";

const CLIENT = { organizationId: ORG, apiKeyId: API_KEY_ID };

const DTO_B2B = {
  clientUniqueId: CLIENT_UNIQUE_ID,
  transactionType: "b2b",
  totalHT: BigInt(100_000_000),
  totalVAT: BigInt(18_000_000),
  issueDate: new Date("2026-09-09T10:00:00.000Z"),
  lines: [{ description: "Prestation", quantity: 2, unitPrice: BigInt(50_000_000) }],
} as unknown as CreatePdpInvoiceDto;

const DTO_B2C = {
  clientUniqueId: "TICKET-0001",
  transactionType: "b2c",
  totalHT: BigInt(1_500_000),
  totalVAT: BigInt(270_000),
  issueDate: new Date("2026-09-09T10:00:00.000Z"),
} as unknown as CreatePdpInvoiceDto;

const PAYLOAD_BRUT = { clientUniqueId: CLIENT_UNIQUE_ID, totalHT: "1000000", source: "odoo-17" };

function ligne(overrides: Record<string, unknown> = {}) {
  return {
    id: LIGNE_ID,
    organizationId: ORG,
    clientUniqueId: CLIENT_UNIQUE_ID,
    flow: "e_invoicing",
    status: "pending",
    invoiceId: null,
    certificationId: null,
    ...overrides,
  };
}

// Erreur P2002 telle que Prisma la rend SOUS RLS FORCÉE : target à null, parce
// que Postgres supprime le DETAIL « Key (...) already exists » quand le rôle
// courant n'a pas le droit de voir la ligne en conflit. C'est la forme RÉELLE en
// production — celle avec un target nommé n'existe qu'en superutilisateur.
function collisionRls() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: null } });
}

function collisionNommee() {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: ["organization_id", "client_unique_id"] },
  });
}

// organizationScopedClient() appelle `$extends` ; `$extends` rend le client
// LUI-MÊME pour que les mocks de modèle restent partagés.
function fakePrisma(overrides: { existante?: unknown; createImpl?: unknown } = {}) {
  const p: any = {
    pdpRawTransaction: {
      findFirst: vi.fn().mockResolvedValue(overrides.existante ?? null),
      create:
        (overrides.createImpl as any) ?? vi.fn().mockResolvedValue(ligne()),
    },
  };
  p.$extends = vi.fn(() => p);
  p.$executeRaw = vi.fn().mockResolvedValue(1);
  p.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(p)));
  return p;
}

function compteur() {
  return { inc: vi.fn() };
}

function service(prisma: any, queue: any = { add: vi.fn().mockResolvedValue({}) }) {
  const metriques = { ingested: compteur(), duplicates: compteur(), enqueueFailures: compteur() };
  const svc = new PdpInvoiceService(
    prisma,
    queue as any,
    metriques.ingested as any,
    metriques.duplicates as any,
    metriques.enqueueFailures as any,
  );
  return { svc, queue, metriques };
}

describe("flowForTransactionType (ADR-107)", () => {
  it("aiguille b2b et b2g vers l'e-invoicing unitaire", () => {
    expect(flowForTransactionType("b2b")).toBe("e_invoicing");
    expect(flowForTransactionType("b2g")).toBe("e_invoicing");
  });

  it("aiguille b2c vers l'e-reporting agrégé", () => {
    expect(flowForTransactionType("b2c")).toBe("e_reporting");
  });
});

describe("PdpInvoiceService.ingest — dépôt nominal", () => {
  it("insère la ligne tampon et enfile le job pour un b2b", async () => {
    const prisma = fakePrisma();
    const { svc, queue, metriques } = service(prisma);

    const resultat = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("accepted");
    expect(resultat.transactionId).toBe(LIGNE_ID);
    expect(resultat.status).toBe("pending");
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(metriques.ingested.inc).toHaveBeenCalledWith({ flow: "e_invoicing" });
  });

  it("enfile sous le nom de job ETAX_INVOICING_UNITARY, avec un jobId déterministe", async () => {
    const prisma = fakePrisma();
    const { svc, queue } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(queue.add).toHaveBeenCalledWith(
      ETAX_INVOICING_UNITARY,
      { rawTransactionId: LIGNE_ID, organizationId: ORG, clientUniqueId: CLIENT_UNIQUE_ID },
      expect.objectContaining({ jobId: buildPdpJobId(LIGNE_ID) }),
    );
  });

  // C'est l'agrégation qui est due à la DGI, pas une transmission par
  // micro-vente : enfiler un job par ticket de caisse noierait la file pour rien.
  it("N'ENFILE RIEN pour un b2c — la ligne attend le Z de caisse", async () => {
    const prisma = fakePrisma({
      createImpl: vi.fn().mockResolvedValue(ligne({ flow: "e_reporting", clientUniqueId: "TICKET-0001" })),
    });
    const { svc, queue, metriques } = service(prisma);

    const resultat = await svc.ingest(DTO_B2C, CLIENT, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("accepted");
    expect(resultat.status).toBe("pending");
    expect(queue.add).not.toHaveBeenCalled();
    expect(metriques.ingested.inc).toHaveBeenCalledWith({ flow: "e_reporting" });
  });

  it("dérive le TTC de HT + TVA, et archive le corps ERP INTACT", async () => {
    const prisma = fakePrisma();
    const { svc } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(prisma.pdpRawTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        apiKeyId: API_KEY_ID,
        flow: "e_invoicing",
        status: "pending",
        totalHtCentimes: BigInt(100_000_000),
        totalVatCentimes: BigInt(18_000_000),
        totalTtcCentimes: BigInt(118_000_000),
        payload: PAYLOAD_BRUT,
      }),
    });
  });

  // L'organisation vient de la clé API vérifiée, jamais du corps.
  it("rattache la ligne à l'organisation de la clé API, jamais à une autre", async () => {
    const prisma = fakePrisma();
    const { svc } = service(prisma);

    await svc.ingest(
      { ...DTO_B2B, organizationId: "org-de-la-victime" } as unknown as CreatePdpInvoiceDto,
      CLIENT,
      PAYLOAD_BRUT,
    );

    expect(prisma.pdpRawTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG }),
    });
  });

  // RLS (ADR-111) — toutes les opérations passent par le client scopé.
  it("lit et écrit sous scope organisation", async () => {
    const prisma = fakePrisma();
    const { svc } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(prisma.$extends).toHaveBeenCalled();
    expect(prisma.pdpRawTransaction.findFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG, clientUniqueId: CLIENT_UNIQUE_ID },
    });
  });

  it("ne rend aucun reçu tant que le document n'est pas certifié", async () => {
    const { svc } = service(fakePrisma());

    expect((await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT)).receipt).toBeNull();
  });
});

describe("PdpInvoiceService.ingest — idempotence par lecture", () => {
  it("ne crée rien et rend « duplicate » quand la ligne existe déjà", async () => {
    const prisma = fakePrisma({ existante: ligne({ status: "certified", certificationId: CERT_ID, invoiceId: "inv-1" }) });
    const { svc, metriques } = service(prisma);

    const resultat = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("duplicate");
    expect(prisma.pdpRawTransaction.create).not.toHaveBeenCalled();
    expect(metriques.duplicates.inc).toHaveBeenCalledWith({ flow: "e_invoicing", detection: "lecture" });
  });

  // L'exigence centrale du cahier des charges : un rejeu d'un document DÉJÀ
  // certifié rend immédiatement le reçu fiscal et son QR, sans redupliquer.
  it("rend le reçu fiscal complet et son QR quand le document est déjà certifié", async () => {
    const prisma = fakePrisma({
      existante: ligne({ status: "certified", certificationId: CERT_ID, invoiceId: "inv-1" }),
    });
    const { svc } = service(prisma);

    const { receipt } = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(receipt).not.toBeNull();
    expect(receipt?.certificationId).toBe(CERT_ID);
    expect(receipt?.invoiceId).toBe("inv-1");
    expect(receipt?.verificationUrl).toContain(CERT_ID);
    expect(receipt?.qrCode).toMatch(/^data:image\/png;base64,/);
  });

  it("ne réenfile pas un document déjà certifié", async () => {
    const prisma = fakePrisma({
      existante: ligne({ status: "certified", certificationId: CERT_ID, invoiceId: "inv-1" }),
    });
    const { svc, queue } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(queue.add).not.toHaveBeenCalled();
  });

  // Un `certified` sans certificationId serait une incohérence de base ; rendre
  // un reçu sans identifiant vérifiable serait pire que ne rien rendre — l'ERP
  // l'imprimerait sur un ticket qu'aucun contrôleur ne pourrait valider.
  it("ne fabrique pas de reçu pour un « certified » sans identifiant de certification", async () => {
    const prisma = fakePrisma({ existante: ligne({ status: "certified", certificationId: null }) });
    const { svc } = service(prisma);

    expect((await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT)).receipt).toBeNull();
  });

  // RATTRAPAGE. Une ligne e-invoicing restée `pending` signifie qu'aucun worker
  // n'a mené le travail à terme — souvent parce que l'enfilement initial s'est
  // perdu (Redis éteint). Sans cette reprise, le rejeu du connecteur ne ferait
  // que lui confirmer un `pending` éternel.
  it("REPREND l'enfilement d'une ligne e-invoicing restée en attente", async () => {
    const prisma = fakePrisma({ existante: ligne({ status: "pending" }) });
    const { svc, queue } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      ETAX_INVOICING_UNITARY,
      expect.anything(),
      expect.objectContaining({ jobId: buildPdpJobId(LIGNE_ID) }),
    );
  });

  it("ne reprend jamais l'enfilement d'une ligne e-reporting en attente", async () => {
    const prisma = fakePrisma({ existante: ligne({ flow: "e_reporting", status: "pending" }) });
    const { svc, queue } = service(prisma);

    await svc.ingest(DTO_B2C, CLIENT, PAYLOAD_BRUT);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it("ne réenfile pas une ligne en échec définitif", async () => {
    const prisma = fakePrisma({ existante: ligne({ status: "failed" }) });
    const { svc, queue } = service(prisma);

    const resultat = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(resultat.status).toBe("failed");
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe("PdpInvoiceService.ingest — collision concurrentielle (P2002)", () => {
  // LE test de non-régression du chemin RLS. Prisma rend target: null dès que la
  // politique masque la ligne en conflit ; une implémentation qui exigerait un
  // tableau ne reconnaîtrait JAMAIS la collision en production, et ce 200
  // idempotent retomberait en 500 opaque — alors que tous les tests unitaires
  // fabriquant l'erreur AVEC son target passeraient.
  it("reconnaît la collision même quand RLS masque le nom de la colonne (target: null)", async () => {
    const existante = ligne({ status: "certified", certificationId: CERT_ID, invoiceId: "inv-1" });
    const prisma = fakePrisma({ createImpl: vi.fn().mockRejectedValue(collisionRls()) });
    prisma.pdpRawTransaction.findFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // la lecture d'idempotence ne voit encore rien
      .mockResolvedValueOnce(existante); // la relecture, après collision, voit la gagnante
    const { svc, metriques } = service(prisma);

    const resultat = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("duplicate");
    expect(resultat.receipt?.certificationId).toBe(CERT_ID);
    expect(metriques.duplicates.inc).toHaveBeenCalledWith({ flow: "e_invoicing", detection: "collision" });
  });

  it("reconnaît aussi la collision quand la colonne EST nommée (hors RLS, superutilisateur)", async () => {
    const prisma = fakePrisma({ createImpl: vi.fn().mockRejectedValue(collisionNommee()) });
    prisma.pdpRawTransaction.findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ligne());
    const { svc } = service(prisma);

    expect((await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT)).outcome).toBe("duplicate");
  });

  it("la perdante n'enfile qu'un job, sous le MÊME jobId que la gagnante", async () => {
    const prisma = fakePrisma({ createImpl: vi.fn().mockRejectedValue(collisionRls()) });
    prisma.pdpRawTransaction.findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ligne({ status: "pending" }));
    const { svc, queue } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      ETAX_INVOICING_UNITARY,
      expect.anything(),
      expect.objectContaining({ jobId: buildPdpJobId(LIGNE_ID) }),
    );
  });

  // Mieux vaut un 500 lisible qu'un accusé de réception mensonger sur une pièce
  // fiscale : si la relecture ne trouve rien, la collision venait d'ailleurs.
  it("relaie l'erreur d'origine si la relecture ne retrouve aucune ligne", async () => {
    const prisma = fakePrisma({ createImpl: vi.fn().mockRejectedValue(collisionRls()) });
    prisma.pdpRawTransaction.findFirst = vi.fn().mockResolvedValue(null);
    const { svc } = service(prisma);

    await expect(svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT)).rejects.toMatchObject({ code: "P2002" });
  });

  it("ne masque jamais une erreur qui n'est pas une violation d'unicité", async () => {
    const panne = Object.assign(new Error("connexion perdue"), { code: "P1001" });
    const prisma = fakePrisma({ createImpl: vi.fn().mockRejectedValue(panne) });
    const { svc } = service(prisma);

    await expect(svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT)).rejects.toThrow("connexion perdue");
  });
});

describe("PdpInvoiceService.ingest — Redis indisponible", () => {
  // Le document est déjà committé : Redis éteint ne doit pas le transformer en
  // 500 pour le connecteur, qui rejouerait alors un document déjà en base.
  it("NE LÈVE JAMAIS quand l'enfilement échoue — le dépôt reste accepté", async () => {
    const queue = { add: vi.fn().mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:6379")) };
    const { svc, metriques } = service(fakePrisma(), queue);

    const resultat = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("accepted");
    expect(resultat.status).toBe("pending");
    expect(metriques.enqueueFailures.inc).toHaveBeenCalledTimes(1);
  });

  // BullMQ/ioredis rejettent parfois autre chose qu'une Error (chaîne, objet de
  // statut). Le journal d'un dépôt perdu ne doit pas devenir illisible pour
  // autant — et surtout, la normalisation ne doit pas lever à son tour.
  it("absorbe aussi un rejet qui n'est pas une Error", async () => {
    const queue = { add: vi.fn().mockRejectedValue("connexion refusée") };
    const { svc, metriques } = service(fakePrisma(), queue);

    const resultat = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(resultat.outcome).toBe("accepted");
    expect(metriques.enqueueFailures.inc).toHaveBeenCalledTimes(1);
  });

  // La boucle de rattrapage complète : l'enfilement se perd, le connecteur
  // rejoue (sa réaction naturelle à une réponse qu'il juge incomplète), et CE
  // rejeu-là remet le document en file.
  it("un rejeu ultérieur remet en file le document dont l'enfilement s'était perdu", async () => {
    const queue = { add: vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")).mockResolvedValue({}) };
    const prisma = fakePrisma();
    const { svc } = service(prisma, queue);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    prisma.pdpRawTransaction.findFirst = vi.fn().mockResolvedValue(ligne({ status: "pending" }));
    const rejeu = await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);

    expect(rejeu.outcome).toBe("duplicate");
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});

describe("PdpInvoiceService.ingest — étanchéité inter-organisations", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = fakePrisma();
  });

  // Deux PME peuvent parfaitement utiliser la même numérotation ERP :
  // l'idempotence est composite, jamais globale sur clientUniqueId.
  it("le même clientUniqueId chez deux organisations donne deux lignes distinctes", async () => {
    const { svc } = service(prisma);

    await svc.ingest(DTO_B2B, CLIENT, PAYLOAD_BRUT);
    await svc.ingest(DTO_B2B, { organizationId: "org-2", apiKeyId: "key-2" }, PAYLOAD_BRUT);

    expect(prisma.pdpRawTransaction.findFirst).toHaveBeenNthCalledWith(1, {
      where: { organizationId: ORG, clientUniqueId: CLIENT_UNIQUE_ID },
    });
    expect(prisma.pdpRawTransaction.findFirst).toHaveBeenNthCalledWith(2, {
      where: { organizationId: "org-2", clientUniqueId: CLIENT_UNIQUE_ID },
    });
    expect(prisma.pdpRawTransaction.create).toHaveBeenCalledTimes(2);
  });
});
