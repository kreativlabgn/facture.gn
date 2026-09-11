import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RLS_ORG_SETTING } from "@facture-gn/db";
import { EtaxRejetDefinitif } from "../etax/etax.client";
import { estRefusDefinitif, PdpConsolidationService } from "./pdp-consolidation.service";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";
import { PDP_REPORTING_BATCH_MAX, PDP_REPORTING_FANOUT_MAX } from "./pdp.constants";

const ORG = "org-1";
const LIGNE_ID = "11111111-2222-3333-4444-555555555555";
const CLIENT_UNIQUE_ID = "INV/2026/00042";
const INVOICE_ID = "inv-1";
const CERT_ID = "GN-12345678-2026-ABC123";
const SERIE_ZR = "ZR-2026-000004";

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

/** Le compteur de série ZR, mocké : le vrai exige un Postgres (upsert atomique
 *  ON CONFLICT), et aucun test de CE fichier ne porte sur la numérotation. */
function numerotationReporting(numero = SERIE_ZR) {
  return { nextNumber: vi.fn().mockResolvedValue(numero) };
}

function service(
  prisma: any,
  invoices: any = { issue: vi.fn() },
  numerotation: any = numerotationReporting(),
) {
  return new PdpConsolidationService(
    prisma,
    invoices,
    numerotation,
    compteur() as never,
    compteur() as never,
    compteur() as never,
    compteur() as never,
  );
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

// ══════════════════════════════════════════════════════════════════════════════
// e-REPORTING PÉRIODIQUE (B2C / CAISSES) — ADR-107 tranche 3
// ══════════════════════════════════════════════════════════════════════════════

const ORG_CAISSE = "org-caisse";

/** 50 tickets de caisse, montants VOLONTAIREMENT non ronds : c'est ainsi qu'on
 *  attrape une sommation qui passerait par un flottant. 8 413 213,14 GNF HT se
 *  relit 8413213.139999999 en IEEE-754 — l'écart n'apparaît qu'à la 50ᵉ addition. */
function ticketsDeCaisse(nombre = 50) {
  return Array.from({ length: nombre }, (_, index) => ({
    id: `ticket-${index}`,
    totalHtCentimes: BigInt(841_321_314 + index),
    totalVatCentimes: BigInt(151_437_836 + index),
    totalTtcCentimes: BigInt(841_321_314 + index) + BigInt(151_437_836 + index),
    receivedAt: new Date(Date.UTC(2026, 8, 9, 6, index)),
  }));
}

function sommeAttendue(tickets: ReturnType<typeof ticketsDeCaisse>) {
  return tickets.reduce(
    (acc, t) => ({
      ht: acc.ht + t.totalHtCentimes,
      tva: acc.tva + t.totalVatCentimes,
    }),
    { ht: BigInt(0), tva: BigInt(0) },
  );
}

/** Prisma factice du chemin périodique. `findMany` rend d'abord les lignes DÉJÀ
 *  rattachées (la reprise), puis les tickets verrouillés — c'est l'ordre exact
 *  dans lequel ouvrirOuReprendreLot les demande. */
function prismaCaisse(options: { rattaches?: unknown[]; tickets?: unknown[] } = {}) {
  const tickets = options.tickets ?? ticketsDeCaisse();
  const p: any = {
    pdpRawTransaction: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(options.rattaches ?? [])
        .mockResolvedValue(tickets),
      updateMany: vi.fn().mockResolvedValue({ count: tickets.length }),
    },
    invoice: {
      create: vi.fn().mockResolvedValue({ id: INVOICE_ID }),
      findFirst: vi.fn().mockResolvedValue({ id: INVOICE_ID, status: "draft", certificationId: null }),
    },
    invoiceEvent: { create: vi.fn().mockResolvedValue({}) },
    organization: { findFirstOrThrow: vi.fn().mockResolvedValue({ regimeFiscal: "normal_tva" }) },
  };
  p.$extends = vi.fn(() => p);
  p.$executeRaw = vi.fn().mockResolvedValue(1);
  p.$queryRaw = vi.fn().mockResolvedValue(tickets.map((t: any) => ({ id: t.id })));
  p.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(p)));
  return p;
}

/** Le SQL réellement envoyé, fragments recollés — pour vérifier le verrou et les
 *  prédicats sans dépendre du formatage. */
function sqlEnvoye(prisma: any, index = 0): string {
  return (prisma.$queryRaw.mock.calls[index][0] as string[]).join(" ? ");
}

describe("PdpConsolidationService — compilation du Z de caisse", () => {
  let prisma: any;
  let invoices: any;

  beforeEach(() => {
    prisma = prismaCaisse();
    invoices = emissionReussie();
  });

  // LE TEST CENTRAL. 50 micro-ventes, un seul document certifié, pas un centime
  // perdu ni inventé.
  it("somme 50 tickets en une facture de synthèse unique, au centime", async () => {
    const attendu = sommeAttendue(ticketsDeCaisse());

    const resultat = await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
    const facture = prisma.invoice.create.mock.calls[0][0].data;
    expect(facture.totalHt).toBe(attendu.ht);
    expect(facture.totalTva).toBe(attendu.tva);
    expect(facture.totalTtc).toBe(attendu.ht + attendu.tva);
    // amountDue = TTC : le Z n'est pas encaissé par ce chemin, il est déclaré.
    expect(facture.amountDue).toBe(attendu.ht + attendu.tva);
    expect(resultat).toMatchObject({
      organizationId: ORG_CAISSE,
      invoiceId: INVOICE_ID,
      certificationId: CERT_ID,
      reportingSeriesNumber: SERIE_ZR,
      ticketCount: 50,
      totalHtCentimes: attendu.ht,
      totalVatCentimes: attendu.tva,
      skipped: false,
    });
  });

  // La sommation reste ENTIÈRE. Un reduce sur des Number dériverait au-delà de
  // 2^53 centimes (~90 milliards de GNF, un CA de caisse annuel atteignable), et
  // la dérive serait SIGNÉE dans le hash de certification.
  it("ne fait jamais transiter un montant par un flottant", async () => {
    await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    const facture = prisma.invoice.create.mock.calls[0][0].data;
    expect(typeof facture.totalHt).toBe("bigint");
    expect(typeof facture.totalTva).toBe("bigint");
    expect(typeof facture.totalTtc).toBe("bigint");
    // Le total exact, écrit en dur : si la sommation régresse vers un flottant,
    // c'est CETTE valeur qui bougera, pas une comparaison qui se recalcule
    // avec le même bug.
    expect(facture.totalHt).toBe(BigInt(42_066_066_925));
    expect(facture.totalTva).toBe(BigInt(7_571_893_025));
  });

  // ADR-108. Le prix unitaire de la ligne de synthèse est un HT ; sans ce
  // marquage le PDF l'intitulerait « P.U. TTC » et sommerait en un sous-total
  // TTC qui vaudrait le HT.
  it("marque la ligne de synthèse HT_FIRST et y porte le total HT", async () => {
    const attendu = sommeAttendue(ticketsDeCaisse());

    await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    const [ligne] = prisma.invoice.create.mock.calls[0][0].data.lines.create;
    expect(ligne.saisieRegime).toBe("HT_FIRST");
    expect(ligne.unitPrice).toBe(attendu.ht);
    expect(ligne.quantity).toBe(1);
    expect(ligne.taxRateBps).toBe(1800);
    // Le libellé porte le rang de série et le périmètre — c'est ce que lit un
    // contrôleur qui rapproche le Z de ses tickets.
    expect(ligne.description).toContain(SERIE_ZR);
    expect(ligne.description).toContain("50 ticket(s)");
  });

  // Les deux numérotations coexistent et disent deux choses différentes : le
  // numéro légal Article 23 vient d'issue(), la série ZR du compteur dédié.
  it("porte le numéro de série e-Reporting sans toucher à la séquence légale", async () => {
    const numerotation = numerotationReporting();

    await service(prisma, invoices, numerotation).consolidatePeriodicReporting(ORG_CAISSE);

    expect(prisma.invoice.create.mock.calls[0][0].data.reportingSeriesNumber).toBe(SERIE_ZR);
    // `number` n'est JAMAIS écrit ici : issue() seul le pose.
    expect(prisma.invoice.create.mock.calls[0][0].data.number).toBeUndefined();
    expect(invoices.issue).toHaveBeenCalledWith(INVOICE_ID, ORG_CAISSE);
    // Le rang est consommé DANS la transaction du brouillon (tx passé), jamais
    // sur le client global — sinon un rollback laisserait un trou définitif.
    expect(numerotation.nextNumber).toHaveBeenCalledWith(ORG_CAISSE, expect.any(Number), prisma);
  });

  // L'ancre d'idempotence du lot : le rattachement est posé sur le BROUILLON,
  // avant l'émission. Sans lui, une interruption ferait émettre un SECOND Z sur
  // les mêmes ventes — la même TVA déclarée deux fois.
  it("rattache les tickets au brouillon AVANT de l'émettre", async () => {
    await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    const rattachement = prisma.pdpRawTransaction.updateMany.mock.calls[0][0];
    expect(rattachement.data).toEqual({ consolidatedInvoiceId: INVOICE_ID });
    expect(rattachement.where.organizationId).toBe(ORG_CAISSE);
    expect(prisma.pdpRawTransaction.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      invoices.issue.mock.invocationCallOrder[0],
    );
  });

  // `certified` et non « CONSOLIDATED » : c'est la valeur que porte l'enum, dont
  // le commentaire de schéma couvre déjà explicitement le cas e-reporting.
  it("bascule les tickets en certified en les liant à la certification du Z", async () => {
    await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    const bascule = prisma.pdpRawTransaction.updateMany.mock.calls[1][0];
    expect(bascule.where).toMatchObject({
      organizationId: ORG_CAISSE,
      consolidatedInvoiceId: INVOICE_ID,
      status: "pending",
    });
    expect(bascule.data).toMatchObject({ status: "certified", certificationId: CERT_ID });
    // Un abandon antérieur repris avec succès ne laisse pas son motif derrière.
    expect(bascule.data.failureReason).toBeNull();
  });

  // Le verrou de lignes, en SQL brut faute d'équivalent Prisma. Sans lui, deux
  // passages concurrents embarqueraient les mêmes tickets dans deux Z distincts.
  it("verrouille les tickets et exclut ceux d'un lot déjà en vol", async () => {
    await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    const sql = sqlEnvoye(prisma);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("consolidated_invoice_id IS NULL");
    // Le filtre organisation est porté par le SQL lui-même : tant que la
    // politique RLS dort, c'est lui qui empêche de verrouiller les tickets d'un
    // autre locataire.
    expect(sql).toContain("organization_id =");
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe(ORG_CAISSE);
    // Ordre stable : deux passages concurrents prennent les lignes dans le même
    // ordre, sinon Postgres tue l'un des deux en deadlock.
    expect(sql).toContain("ORDER BY received_at, id");
    expect(sql).toContain("LIMIT");
    expect(prisma.$queryRaw.mock.calls[0][2]).toBe(PDP_REPORTING_BATCH_MAX);
  });

  // RLS (ADR-111) — le processus tourne hors contexte HTTP : rien ne pose de
  // scope pour lui. Une sommation de TVA qui déborderait sur un autre NIF est
  // irrattrapable une fois certifiée.
  it("force le scope RLS au début de CHAQUE transaction", async () => {
    await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    const scopes = scopesPoses(prisma);
    // Deux transactions écrivent (ouverture du lot, bascule finale) : deux scopes.
    expect(scopes).toHaveLength(2);
    for (const valeurs of scopes) {
      expect(valeurs).toEqual([RLS_ORG_SETTING, ORG_CAISSE]);
    }
  });
});

describe("PdpConsolidationService — Z de caisse : rien à compiler", () => {
  // Le cas NORMAL sur une organisation sans caisse, et sur toutes celles que
  // l'éventail vient de vider. Aucune facture, aucun numéro consommé.
  it("ne crée aucune facture quand aucun ticket n'attend", async () => {
    const prisma = prismaCaisse({ tickets: [] });
    prisma.$queryRaw = vi.fn().mockResolvedValue([]);
    const numerotation = numerotationReporting();

    const resultat = await service(prisma, emissionReussie(), numerotation).consolidatePeriodicReporting(
      ORG_CAISSE,
    );

    expect(resultat).toMatchObject({ skipped: true, invoiceId: null, ticketCount: 0 });
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(numerotation.nextNumber).not.toHaveBeenCalled();
  });

  // « Si la somme est supérieure à zéro ». Un lot intégralement nul (caisse de
  // test, connecteur mal configuré) ne consomme ni numéro Article 23 ni rang de
  // série. Les basculer en `certified` serait pire : ce serait déclarer à la DGI
  // un reporting qui n'a jamais eu lieu.
  it("n'émet aucun Z sur un lot de total nul, et laisse les tickets en attente", async () => {
    const nuls = [
      { id: "t0", totalHtCentimes: BigInt(0), totalVatCentimes: BigInt(0), totalTtcCentimes: BigInt(0), receivedAt: new Date() },
      { id: "t1", totalHtCentimes: BigInt(0), totalVatCentimes: BigInt(0), totalTtcCentimes: BigInt(0), receivedAt: new Date() },
    ];
    const prisma = prismaCaisse({ tickets: nuls });
    const invoices = emissionReussie();

    const resultat = await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    expect(resultat.skipped).toBe(true);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(invoices.issue).not.toHaveBeenCalled();
    // Aucun rattachement : les tickets restent libres pour le passage suivant.
    expect(prisma.pdpRawTransaction.updateMany).not.toHaveBeenCalled();
  });
});

describe("PdpConsolidationService — Z de caisse : reprise après interruption", () => {
  // Des tickets `pending` DÉJÀ rattachés = une tentative s'est arrêtée entre la
  // création du brouillon et la bascule finale. On repart de SON Z.
  it("reprend le Z ouvert au lieu d'en créer un second", async () => {
    const rattaches = [
      { id: "t0", consolidatedInvoiceId: INVOICE_ID, totalHtCentimes: BigInt(300), totalVatCentimes: BigInt(54) },
      { id: "t1", consolidatedInvoiceId: INVOICE_ID, totalHtCentimes: BigInt(700), totalVatCentimes: BigInt(126) },
    ];
    const prisma = prismaCaisse({ rattaches });
    // Le lot repris n'en compte que deux — et `ticketCount` est le nombre
    // RÉELLEMENT basculé en base, jamais une estimation reprise du lot.
    prisma.pdpRawTransaction.updateMany = vi.fn().mockResolvedValue({ count: 2 });
    prisma.invoice.findFirst = vi
      .fn()
      // Relecture du numéro de série sur la facture reprise…
      .mockResolvedValueOnce({ reportingSeriesNumber: SERIE_ZR })
      // …puis relecture par emettre(), qui la trouve encore en brouillon.
      .mockResolvedValue({ id: INVOICE_ID, status: "draft", certificationId: null });
    const numerotation = numerotationReporting();

    const resultat = await service(prisma, emissionReussie(), numerotation).consolidatePeriodicReporting(
      ORG_CAISSE,
    );

    expect(prisma.invoice.create).not.toHaveBeenCalled();
    // AUCUN second rang de série consommé : la série ne doit pas sauter un
    // numéro à chaque redémarrage du worker.
    expect(numerotation.nextNumber).not.toHaveBeenCalled();
    expect(resultat).toMatchObject({
      invoiceId: INVOICE_ID,
      reportingSeriesNumber: SERIE_ZR,
      ticketCount: 2,
      totalHtCentimes: BigInt(1000),
      totalVatCentimes: BigInt(180),
      skipped: false,
    });
    // Aucun verrou posé : il n'y a rien de neuf à ramasser tant que le lot en
    // vol n'est pas soldé.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // Deux Z en vol simultanément est impossible par construction (la sélection
  // exclut les lignes rattachées). Si ça arrive, poursuivre MÉLANGERAIT deux
  // lots de TVA : refus définitif, pas cinq réessais.
  it("refuse définitivement des tickets rattachés à deux Z distincts", async () => {
    const rattaches = [
      { id: "t0", consolidatedInvoiceId: "inv-a", totalHtCentimes: BigInt(1), totalVatCentimes: BigInt(0) },
      { id: "t1", consolidatedInvoiceId: "inv-b", totalHtCentimes: BigInt(1), totalVatCentimes: BigInt(0) },
    ];
    const prisma = prismaCaisse({ rattaches });

    await expect(
      service(prisma, emissionReussie()).consolidatePeriodicReporting(ORG_CAISSE),
    ).rejects.toThrow(UnrecoverableError);
  });

  // Une tentative précédente a émis le Z puis s'est interrompue avant la
  // bascule. issue() répondrait 409 « ne peut être émise depuis issued » — un
  // refus définitif qui condamnerait un lot pourtant DÉJÀ certifié.
  it("reprend la certification d'un Z déjà émis au lieu d'en demander une seconde", async () => {
    const rattaches = [
      { id: "t0", consolidatedInvoiceId: INVOICE_ID, totalHtCentimes: BigInt(100), totalVatCentimes: BigInt(18) },
    ];
    const prisma = prismaCaisse({ rattaches });
    prisma.invoice.findFirst = vi
      .fn()
      .mockResolvedValueOnce({ reportingSeriesNumber: SERIE_ZR })
      .mockResolvedValue({ id: INVOICE_ID, status: "issued", certificationId: CERT_ID });
    const invoices = emissionReussie();

    const resultat = await service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE);

    expect(invoices.issue).not.toHaveBeenCalled();
    expect(resultat.certificationId).toBe(CERT_ID);
  });
});

describe("PdpConsolidationService — Z de caisse : échecs", () => {
  // Panne passagère : AUCUNE écriture d'état. Les tickets restent `pending`,
  // rattachés au brouillon — exactement ce que la reprise attend. Écrire
  // `failed` ici condamnerait tout un lot de caisse pour un verrou expiré.
  it("laisse remonter une panne passagère sans rien abandonner", async () => {
    const prisma = prismaCaisse();
    const invoices = { issue: vi.fn().mockRejectedValue(new ConflictException("réessayer")) };

    await expect(
      service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE),
    ).rejects.toThrow(ConflictException);

    // Seul le rattachement a été écrit — jamais une bascule vers `failed`.
    expect(prisma.pdpRawTransaction.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.pdpRawTransaction.updateMany.mock.calls[0][0].data).toEqual({
      consolidatedInvoiceId: INVOICE_ID,
    });
  });

  // Refus définitif : le lot entier passe en `failed`, état TERMINAL. C'est
  // l'écriture la plus lourde de conséquences du module — d'où la trace WORM.
  it("abandonne le lot entier sur refus définitif, et le consigne au journal WORM", async () => {
    const prisma = prismaCaisse();
    prisma.pdpRawTransaction.updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 50 })
      .mockResolvedValue({ count: 50 });
    const invoices = { issue: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(400)) };

    await expect(
      service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE),
    ).rejects.toThrow(UnrecoverableError);

    const abandon = prisma.pdpRawTransaction.updateMany.mock.calls[1][0];
    expect(abandon.where).toMatchObject({ consolidatedInvoiceId: INVOICE_ID, status: "pending" });
    expect(abandon.data.status).toBe("failed");
    expect(abandon.data.failureReason).toBeTruthy();
    expect(prisma.invoiceEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.invoiceEvent.create.mock.calls[0][0].data).toMatchObject({
      invoiceId: INVOICE_ID,
      type: "etax_transmission_failed",
    });
  });

  // Même discipline que marquerEchec : consigner l'abandon ne doit jamais
  // masquer la cause d'origine par une panne d'écriture.
  it("remonte quand même le refus si la consignation de l'abandon échoue", async () => {
    const prisma = prismaCaisse();
    prisma.pdpRawTransaction.updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 50 })
      .mockRejectedValue(new Error("base injoignable"));
    const invoices = { issue: vi.fn().mockRejectedValue(new EtaxRejetDefinitif(400)) };

    await expect(
      service(prisma, invoices).consolidatePeriodicReporting(ORG_CAISSE),
    ).rejects.toThrow(UnrecoverableError);
  });
});

describe("PdpConsolidationService — énumération des organisations à compiler", () => {
  // La seule lecture transverse du module. Elle ne rend que des identifiants
  // d'organisation : aucun montant, aucun client, aucune référence de marché.
  it("ne rend que les organisations ayant des tickets e-reporting en attente", async () => {
    const prisma = prismaCaisse();
    prisma.$queryRaw = vi
      .fn()
      .mockResolvedValue([{ organization_id: "org-a" }, { organization_id: "org-b" }]);

    const orgs = await service(prisma).listOrganizationsWithPendingReporting();

    expect(orgs).toEqual(["org-a", "org-b"]);
    const sql = sqlEnvoye(prisma);
    expect(sql).toContain("SELECT DISTINCT organization_id");
    expect(sql).toContain(`'e_reporting'::"PdpFlow"`);
    expect(sql).toContain(`'pending'::"PdpTransactionStatus"`);
    // La table `organization` n'est JAMAIS balayée : il n'existe aucune colonne
    // « active » dessus, et lire tous les locataires coûterait plus cher que le
    // travail lui-même.
    expect(sql).not.toContain("FROM organization");
  });

  it("borne la rafale de jobs posés d'un coup", async () => {
    const prisma = prismaCaisse();
    prisma.$queryRaw = vi.fn().mockResolvedValue([]);

    await service(prisma).listOrganizationsWithPendingReporting();

    expect(prisma.$queryRaw.mock.calls[0][1]).toBe(PDP_REPORTING_FANOUT_MAX);
  });
});
