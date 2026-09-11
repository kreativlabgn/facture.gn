import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RLS_ORG_SETTING } from "@facture-gn/db";
import { EtaxRejetDefinitif } from "../etax/etax.client";
import { estRefusDefinitif, PdpConsolidationService } from "./pdp-consolidation.service";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";

const ORG = "org-1";
const LIGNE_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_UNIQUE_ID = "INV/2026/00042";
const INVOICE_ID = "inv-1";
const CERT_ID = "GN-12345678-2026-ABC123";

const JOB: PdpInvoicingJobPayload = {
  rawTransactionId: LIGNE_ID,
  organizationId: ORG,
  clientUniqueId: CLIENT_UNIQUE_ID,
};

// Le document tel que le connecteur l'a déposé, archivé BRUT dans
// pdp_raw_transaction.payload : des chaînes décimales en GNF, jamais nos
// centimes internes. Le worker le relit par createPdpInvoiceSchema — d'où ce
// format ici, et non un DTO déjà parsé.
const PAYLOAD_ARCHIVE = {
  clientUniqueId: CLIENT_UNIQUE_ID,
  transactionType: "b2b",
  totalHT: "1000000",
  totalVAT: "180000",
  issueDate: "2026-09-09T10:00:00.000Z",
  customer: { name: "SOGUIPAH SA", nif: "123456789" },
  lines: [{ description: "Prestation de conseil", quantity: 2, unitPrice: "500000" }],
};

function ligne(overrides: Record<string, unknown> = {}) {
  return {
    id: LIGNE_ID,
    organizationId: ORG,
    clientUniqueId: CLIENT_UNIQUE_ID,
    flow: "e_invoicing",
    status: "pending",
    invoiceId: null,
    certificationId: null,
    failureReason: null,
    // 1 000 000 GNF HT + 180 000 GNF TVA, en centimes (ADR-014).
    totalHtCentimes: BigInt(100_000_000),
    totalVatCentimes: BigInt(18_000_000),
    totalTtcCentimes: BigInt(118_000_000),
    payload: PAYLOAD_ARCHIVE,
    ...overrides,
  };
}

// organizationScopedClient() appelle `$extends` ; `$extends` rend le client
// LUI-MÊME pour que les mocks de modèle restent partagés — et `$transaction`
// exécute le callback avec ce même objet, qui joue donc aussi le rôle de `tx`.
function fakePrisma(overrides: Record<string, unknown> = {}) {
  const p: any = {
    pdpRawTransaction: {
      findFirst: vi.fn().mockResolvedValue(ligne()),
      update: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue({ id: INVOICE_ID, status: "draft", certificationId: null }),
      create: vi.fn().mockResolvedValue({ id: INVOICE_ID }),
    },
    invoiceEvent: { create: vi.fn().mockResolvedValue({}) },
    organization: { findFirstOrThrow: vi.fn().mockResolvedValue({ regimeFiscal: "reel_normal" }) },
    customer: {
      findFirst: vi.fn().mockResolvedValue({ id: "cust-1" }),
      create: vi.fn().mockResolvedValue({ id: "cust-neuf" }),
    },
    ...overrides,
  };
  p.$extends = vi.fn(() => p);
  p.$executeRaw = vi.fn().mockResolvedValue(1);
  p.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(p)));
  return p;
}

function compteur() {
  return { inc: vi.fn() };
}

function service(prisma: any, invoices: any = { issue: vi.fn() }) {
  return new PdpConsolidationService(prisma, invoices, compteur() as never, compteur() as never);
}

const emissionReussie = () => ({
  issue: vi.fn().mockResolvedValue({ id: INVOICE_ID, certificationId: CERT_ID }),
});

/** Toutes les valeurs passées à set_config(app.current_org_id, …) pendant le
 *  test — c'est la preuve du forçage RLS côté worker. */
function scopesPoses(prisma: any): unknown[] {
  return prisma.$executeRaw.mock.calls.map((call: any[]) => (call[0] as { values: unknown[] }).values);
}

describe("PdpConsolidationService — chemin nominal", () => {
  let prisma: any;
  let invoices: any;

  beforeEach(() => {
    prisma = fakePrisma();
    invoices = emissionReussie();
  });

  it("crée la facture, l'émet, et bascule la ligne tampon en certified", async () => {
    const resultat = await service(prisma, invoices).consolidateUnitary(JOB);

    expect(invoices.issue).toHaveBeenCalledWith(INVOICE_ID, ORG);
    expect(resultat).toEqual({
      rawTransactionId: LIGNE_ID,
      invoiceId: INVOICE_ID,
      certificationId: CERT_ID,
      skipped: false,
    });

    const bascule = prisma.pdpRawTransaction.update.mock.calls.at(-1)[0];
    expect(bascule.where).toEqual({ id: LIGNE_ID });
    expect(bascule.data.status).toBe("certified");
    expect(bascule.data.certificationId).toBe(CERT_ID);
    expect(bascule.data.processedAt).toBeInstanceOf(Date);
  });

  // L'ANCRE D'IDEMPOTENCE. Le lien vers la facture est écrit dans la MÊME
  // transaction que la création du brouillon, avant toute émission : c'est ce
  // qui empêche un rejeu après crash d'émettre un second document fiscal.
  it("lie la facture à la ligne tampon dès la création du brouillon", async () => {
    await service(prisma, invoices).consolidateUnitary(JOB);

    const lien = prisma.pdpRawTransaction.update.mock.calls[0][0];
    expect(lien.data).toEqual({ invoiceId: INVOICE_ID });
    // …et ce lien précède l'émission, pas l'inverse.
    expect(prisma.pdpRawTransaction.update.mock.invocationCallOrder[0]).toBeLessThan(
      invoices.issue.mock.invocationCallOrder[0],
    );
  });

  // LES MONTANTS SONT CEUX QUE L'ERP A DÉCLARÉS, jamais recalculés depuis les
  // lignes par la convention TTC-first du chemin PWA — qui produirait ici une
  // facture dont le TTC vaudrait le HT déclaré.
  it("certifie les montants déclarés par le connecteur, sans les recalculer", async () => {
    await service(prisma, invoices).consolidateUnitary(JOB);

    const { data } = prisma.invoice.create.mock.calls[0][0];
    expect(data.totalHt).toBe(BigInt(100_000_000));
    expect(data.totalTva).toBe(BigInt(18_000_000));
    expect(data.totalTtc).toBe(BigInt(118_000_000));
    expect(data.amountDue).toBe(BigInt(118_000_000));
    expect(data.emissionChannel).toBe("api");
    expect(data.status).toBe("draft");
  });

  it("conserve le cadre marché public d'un document b2g", async () => {
    prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(
          ligne({
            payload: {
              ...PAYLOAD_ARCHIVE,
              transactionType: "b2g",
              referenceMarche: "MP-2026-018",
              numeroEngagement: "ENG-77",
            },
          }),
        ),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    await service(prisma, emissionReussie()).consolidateUnitary(JOB);

    const { data } = prisma.invoice.create.mock.calls[0][0];
    expect(data.cadreFacturation).toBe("marche_public");
    expect(data.referenceMarche).toBe("MP-2026-018");
    expect(data.numeroEngagement).toBe("ENG-77");
  });

  it("rapproche le client par son NIF plutôt que d'en créer un doublon", async () => {
    await service(prisma, invoices).consolidateUnitary(JOB);

    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, nif: "123456789" } }),
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.invoice.create.mock.calls[0][0].data.customerId).toBe("cust-1");
  });

  it("laisse la facture sans client quand le document est anonyme", async () => {
    const sansClient: Partial<typeof PAYLOAD_ARCHIVE> = { ...PAYLOAD_ARCHIVE };
    delete sansClient.customer;
    prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ payload: sansClient })),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    await service(prisma, emissionReussie()).consolidateUnitary(JOB);

    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.invoice.create.mock.calls[0][0].data.customerId).toBeNull();
  });
});

// ── LE TEST QUE LE CAHIER DE LA TRANCHE EXIGE ────────────────────────────────
//
// Un job BullMQ n'a NI session, NI RolesGuard, NI requête HTTP : rien ne pose de
// scope pour lui. Sans forçage explicite, le worker écrirait avec les GUC
// dormants — et un job forgé ferait certifier les montants d'une PME sous le
// NIF d'une autre.
describe("PdpConsolidationService — forçage du scope RLS", () => {
  it("pose app.current_org_id avant toute lecture de la ligne tampon", async () => {
    const prisma = fakePrisma();
    await service(prisma, emissionReussie()).consolidateUnitary(JOB);

    expect(prisma.$extends).toHaveBeenCalled();
    expect(scopesPoses(prisma).length).toBeGreaterThan(0);
    for (const values of scopesPoses(prisma)) {
      expect(values).toEqual([RLS_ORG_SETTING, ORG]);
    }
  });

  // Paramétré, JAMAIS interpolé. Un `SET app.current_company = '<id>'` construit
  // par concaténation ouvrirait une injection SQL sur une valeur qui décide de
  // l'étanchéité entre locataires — la pire place possible pour en ouvrir une.
  it("passe l'organisation en paramètre lié, jamais dans le texte de la requête", async () => {
    const prisma = fakePrisma();
    await service(prisma, emissionReussie()).consolidateUnitary(JOB);

    for (const call of prisma.$executeRaw.mock.calls) {
      const sql = call[0] as { strings?: string[]; values: unknown[] };
      expect(sql.values).toContain(ORG);
      expect((sql.strings ?? []).join("")).not.toContain(ORG);
    }
  });

  // Le scope de CHAQUE transaction interactive, pas seulement de la première :
  // set_config(..., TRUE) est local à sa transaction, il ne fuit pas d'un bloc à
  // l'autre — mais il ne s'hérite pas non plus.
  it("repose le scope dans la transaction d'abandon", async () => {
    const prisma = fakePrisma();
    const invoices = { issue: vi.fn().mockRejectedValue(new BadRequestException("document invalide")) };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).rejects.toThrow(
      UnrecoverableError,
    );
    expect(scopesPoses(prisma).length).toBeGreaterThanOrEqual(2);
  });

  it("refuse un job dont la ligne tampon est invisible sous ce scope", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    });

    await expect(service(prisma).consolidateUnitary(JOB)).rejects.toThrow(UnrecoverableError);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });
});

describe("PdpConsolidationService — idempotence", () => {
  it("n'émet rien pour une ligne déjà consolidée", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            ligne({ status: "certified", invoiceId: INVOICE_ID, certificationId: CERT_ID }),
          ),
        update: vi.fn(),
      },
    });
    const invoices = { issue: vi.fn() };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).resolves.toEqual({
      rawTransactionId: LIGNE_ID,
      invoiceId: INVOICE_ID,
      certificationId: CERT_ID,
      skipped: true,
    });
    expect(invoices.issue).not.toHaveBeenCalled();
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("ne rejoue pas une ligne déjà abandonnée", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi
          .fn()
          .mockResolvedValue(ligne({ status: "failed", failureReason: "rejet définitif (400)" })),
        update: vi.fn(),
      },
    });
    const invoices = { issue: vi.fn() };

    const resultat = await service(prisma, invoices).consolidateUnitary(JOB);
    expect(resultat.skipped).toBe(true);
    expect(invoices.issue).not.toHaveBeenCalled();
  });

  // LE TEST QUI EMPÊCHE LA DOUBLE CERTIFICATION. Un worker interrompu entre
  // issue() et la bascule de la ligne tampon laisse une facture ÉMISE et une
  // ligne encore `pending`. Sans reprise, le rejeu créerait un second brouillon
  // et consommerait un second numéro Article 23 pour le même document ERP.
  it("reprend la facture existante au lieu d'en émettre une seconde", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ invoiceId: INVOICE_ID })),
        update: vi.fn().mockResolvedValue({}),
      },
      invoice: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: INVOICE_ID, status: "issued", certificationId: CERT_ID }),
        create: vi.fn(),
      },
    });
    const invoices = { issue: vi.fn() };

    const resultat = await service(prisma, invoices).consolidateUnitary(JOB);

    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(invoices.issue).not.toHaveBeenCalled();
    expect(resultat).toEqual({
      rawTransactionId: LIGNE_ID,
      invoiceId: INVOICE_ID,
      certificationId: CERT_ID,
      skipped: false,
    });
  });

  it("refuse un job unitaire posé sur une ligne e-reporting", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ flow: "e_reporting" })),
        update: vi.fn(),
      },
    });

    await expect(service(prisma).consolidateUnitary(JOB)).rejects.toThrow(/e_reporting/);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });
});

// ── Interception des erreurs ─────────────────────────────────────────────────
describe("PdpConsolidationService — pannes passagères", () => {
  // AUCUNE écriture d'état : la ligne reste en `pending`, BullMQ rejoue, et si
  // les cinq tentatives s'épuisent c'est le rejeu du connecteur qui la reprend
  // (PdpInvoiceService.surRejeu réenfile une ligne e-invoicing en attente).
  // Écrire `failed` ici fermerait ce rattrapage automatique.
  it("laisse remonter un 503 sans toucher au statut de la ligne", async () => {
    const prisma = fakePrisma();
    const invoices = { issue: vi.fn().mockRejectedValue(new Error("eTax a répondu 503")) };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).rejects.toThrow(/503/);

    const statuts = prisma.pdpRawTransaction.update.mock.calls.map((c: any[]) => c[0].data.status);
    expect(statuts).not.toContain("failed");
    expect(statuts).not.toContain("certified");
  });

  it("ne convertit pas une panne passagère en UnrecoverableError", async () => {
    const invoices = { issue: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) };
    await expect(service(fakePrisma(), invoices).consolidateUnitary(JOB)).rejects.not.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  // Un verrou de ligne expiré (P2028) remonte d'issue() en 409 « réessayer ».
  // Le condamner tuerait des factures sur une organisation simplement chargée.
  it("rejoue un conflit d'émission au lieu de l'abandonner", async () => {
    const prisma = fakePrisma();
    const invoices = {
      issue: vi.fn().mockRejectedValue(new ConflictException("Émission en cours — réessayer")),
    };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).rejects.not.toBeInstanceOf(
      UnrecoverableError,
    );
    const statuts = prisma.pdpRawTransaction.update.mock.calls.map((c: any[]) => c[0].data.status);
    expect(statuts).not.toContain("failed");
  });

  // Le gel d'émission après récupération de compte est une fenêtre TEMPORAIRE :
  // la ligne doit rester en `pending` pour que le prochain dépôt la reprenne.
  it("rejoue un gel d'émission temporaire", async () => {
    const invoices = { issue: vi.fn().mockRejectedValue(new ForbiddenException("Émission gelée")) };
    await expect(
      service(fakePrisma(), invoices).consolidateUnitary(JOB),
    ).rejects.not.toBeInstanceOf(UnrecoverableError);
  });
});

describe("PdpConsolidationService — refus définitifs", () => {
  it("consigne le motif exact en base et coupe le backoff sur un rejet de la DGI", async () => {
    const prisma = fakePrisma();
    const invoices = { issue: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(422)) };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).rejects.toThrow(
      UnrecoverableError,
    );

    const abandon = prisma.pdpRawTransaction.update.mock.calls.at(-1)[0];
    expect(abandon.data.status).toBe("failed");
    // Le motif TEXTUEL EXACT, pas un résumé : c'est lui que le support lit.
    expect(abandon.data.failureReason).toBe("eTax a rejeté définitivement (422)");
    expect(abandon.data.processedAt).toBeInstanceOf(Date);
  });

  it("écrit l'événement WORM quand une facture existe déjà", async () => {
    const prisma = fakePrisma();
    const invoices = { issue: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(400)) };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).rejects.toThrow(
      UnrecoverableError,
    );

    const { data } = prisma.invoiceEvent.create.mock.calls[0][0];
    expect(data.invoiceId).toBe(INVOICE_ID);
    expect(data.type).toBe("etax_transmission_failed");
    expect(data.metadata).toMatchObject({
      cause: "eTax a rejeté définitivement (400)",
      clientUniqueId: CLIENT_UNIQUE_ID,
      source: "pdp",
    });
    // actorId absent : personne n'a agi, c'est un worker. Inventer un acteur
    // système rendrait le journal WORM menteur.
    expect(data.actorId).toBeUndefined();
  });

  // Le journal WORM est indexé par invoice_id : un document refusé AVANT toute
  // création de facture n'a rien à quoi s'accrocher. Sa trace, c'est la ligne
  // tampon elle-même — pas un événement orphelin.
  it("n'écrit aucun événement WORM quand aucune facture n'existe", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ payload: { pas: "un document PDP" } })),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(service(prisma).consolidateUnitary(JOB)).rejects.toThrow(UnrecoverableError);
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
    expect(prisma.pdpRawTransaction.update.mock.calls.at(-1)[0].data.status).toBe("failed");
  });

  it("abandonne un document archivé que le schéma ne valide plus", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ payload: { clientUniqueId: "" } })),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(service(prisma).consolidateUnitary(JOB)).rejects.toThrow(/Payload archivé/);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  // Validation comptable : le total archivé fait foi, et la somme des lignes
  // doit le retrouver. Un écart signifie que l'archive et les totaux ne parlent
  // pas du même document — jamais certifier là-dessus.
  it("refuse de certifier quand la somme des lignes ne retrouve pas le total HT", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ totalHtCentimes: BigInt(99_000_000) })),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(service(prisma).consolidateUnitary(JOB)).rejects.toThrow(/Σ lignes/);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("refuse de certifier quand HT + TVA ne fait pas le TTC archivé", async () => {
    const prisma = fakePrisma({
      pdpRawTransaction: {
        findFirst: vi.fn().mockResolvedValue(ligne({ totalTtcCentimes: BigInt(117_000_000) })),
        update: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(service(prisma).consolidateUnitary(JOB)).rejects.toThrow(/HT \+ TVA/);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  // marquerEchec ne lève JAMAIS : l'appelant a déjà une erreur à remonter, et la
  // masquer par une panne d'écriture ferait perdre la cause.
  it("remonte le refus d'origine même si la consignation échoue", async () => {
    const prisma = fakePrisma();
    prisma.pdpRawTransaction.update = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValue(new Error("base injoignable"));
    const invoices = { issue: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(400)) };

    await expect(service(prisma, invoices).consolidateUnitary(JOB)).rejects.toThrow(
      UnrecoverableError,
    );
  });
});

describe("estRefusDefinitif", () => {
  it("condamne ce qui donnera le même refus au rejeu", () => {
    expect(estRefusDefinitif(new UnrecoverableError("insoluble"))).toBe(true);
    expect(estRefusDefinitif(new EtaxRejetDefinitif(400))).toBe(true);
    expect(estRefusDefinitif(new BadRequestException("document invalide"))).toBe(true);
  });

  // Le partage est délibérément étroit : un abandon est TERMINAL (plus rien ne
  // reprend une ligne `failed`), alors qu'un réessai de trop ne coûte qu'un job
  // dans la file d'échec.
  it("laisse rejouer tout ce qui peut encore aboutir", () => {
    expect(estRefusDefinitif(new ConflictException("réessayer"))).toBe(false);
    expect(estRefusDefinitif(new ForbiddenException("Émission gelée"))).toBe(false);
    expect(estRefusDefinitif(new Error("eTax a répondu 503"))).toBe(false);
    expect(estRefusDefinitif("ECONNRESET")).toBe(false);
    expect(estRefusDefinitif(undefined)).toBe(false);
  });
});
