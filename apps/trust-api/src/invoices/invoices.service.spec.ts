import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// À travers un client scopé, le service n'appelle que findFirst* (règle du
// runbook RLS : c'est la seule forme dont le `where` peut porter la colonne de
// scope). Les faux de ce fichier ne déclarent que findUnique* — on adosse l'un
// à l'autre pour TOUS les modèles, les deux désignant la même lecture, plutôt
// que de réécrire chaque test. Les assertions sur findUnique* restent valables.
function alignerFindFirst(prisma: any) {
  for (const modele of Object.values(prisma)) {
    if (!modele || typeof modele !== "object") continue;
    const m = modele as any;
    if (m.findUniqueOrThrow && !m.findFirstOrThrow) m.findFirstOrThrow = m.findUniqueOrThrow;
    if (m.findUnique && !m.findFirst) m.findFirst = m.findUnique;
  }
}

import { InvoicesService } from "./invoices.service";

function createFakePrisma(overrides: { invoice?: any; organization?: any; fiscalPeriodClosing?: any } = {}) {
  // update() cumulatif (comme le vrai Prisma, qui renvoie toujours la ligne complète,
  // pas seulement les champs patchés) — nécessaire car issue() peut faire deux
  // update() successifs (certification, puis lien de paiement en meilleur effort).
  // documentType: "invoice" par défaut (C15, ADR-064) — reflète @default(invoice) du
  // schema ; les tests qui exercent explicitement un proforma le surchargent.
  let invoiceState: any = { id: "inv-1", documentType: "invoice" };
  const seedFindUniqueOrThrow = overrides.invoice?.findUniqueOrThrow;

  const prisma: any = {
    invoice: {
      create: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft" }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }: any) => {
        invoiceState = { ...invoiceState, ...data };
        return Promise.resolve(invoiceState);
      }),
      // Quality Audit 2026-08-23, finding #3 — void() réclame désormais la
      // transition via updateMany+where (compte=1 par défaut) avant de relire
      // la facture ; comme update() ci-dessus, mute invoiceState pour que le
      // findUniqueOrThrow() final reflète bien status:"voided".
      updateMany: vi.fn().mockImplementation(({ data }: any) => {
        invoiceState = { ...invoiceState, ...data };
        return Promise.resolve({ count: 1 });
      }),
      ...overrides.invoice,
      // Toujours la version enveloppée, même si overrides en fournit une — sinon
      // invoiceState ne serait jamais initialisé et les update() suivants perdraient
      // les champs de la facture chargée au départ. Quality Audit 2026-08-23,
      // finding #3 — le seed n'est consulté QU'À LA PREMIÈRE lecture : void()
      // relit désormais l'état APRÈS updateMany() (Prisma ne renvoie pas la ligne
      // depuis updateMany) — un seed re-consulté à chaque appel écraserait
      // silencieusement la mutation avec sa valeur statique d'origine.
      findUniqueOrThrow: (() => {
        let calls = 0;
        return vi.fn().mockImplementation(async (...args: any[]) => {
          calls += 1;
          // 1er appel : renvoie le seed BRUT (pas la version enveloppée) — un
          // test comme C10 ("sans transformation") attend une égalité stricte
          // avec la forme exacte fournie, sans le documentType par défaut de
          // invoiceState mélangé dedans.
          if (calls === 1) {
            const result = seedFindUniqueOrThrow ? await seedFindUniqueOrThrow(...args) : invoiceState;
            invoiceState = { ...invoiceState, ...result };
            return result;
          }
          // Appels suivants (ex. void(), finding #3, qui relit après
          // updateMany() puisque Prisma ne renvoie pas la ligne depuis
          // updateMany) : reflète l'état réellement mutable, jamais le seed
          // statique d'origine.
          return invoiceState;
        });
      })(),
    },
    // Lot B — garde d'exercice clos dans issue() : null par défaut (aucun
    // exercice clos), surchargé par les tests dédiés.
    fiscalPeriodClosing: {
      findUnique: vi.fn().mockResolvedValue(overrides.fiscalPeriodClosing ?? null),
    },
    organization: {
      // commercialTier: freemium par défaut (grille commission, ADR-074) — reflète
      // Organization.commercialTier @default(freemium) du schema.
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", nif: "GN12345678", commercialTier: "freemium" }),
      ...overrides.organization,
    },
    // Quality Audit 2026-08-23, finding #1 — issue() tourne maintenant sous
    // $transaction()+$queryRaw (SELECT ... FOR UPDATE) : callback exécuté
    // directement avec ce même prisma mocké (comme les autres $transaction déjà
    // mockés ailleurs dans ce fichier), $queryRaw est un no-op côté test (aucune
    // vraie base, le verrou lui-même n'a rien à vérifier ici).
    $transaction: vi.fn((callback: any) => callback(prisma)),
    $queryRaw: vi.fn().mockResolvedValue([]),
    // setOrganizationScope() pose le GUC RLS via $executeRaw en première ligne
    // des transactions interactives (issue()). Le vrai tx en dispose ; le faux
    // doit donc le porter aussi, sinon on testerait un client qui ne peut pas
    // scoper.
    $executeRaw: vi.fn().mockResolvedValue(1),

    // organizationScopedClient() appelle client.$extends(). Ici le faux se
    // renvoie LUI-MÊME : les méthodes migrées (findOne, void) partagent alors
    // les mêmes mocks de modèle, ce qui garde lisibles les assertions
    // existantes sur les arguments. La contrepartie est qu'on ne distingue
    // plus le client scopé du client de base — c'est pourquoi les tests
    // vérifient explicitement que `$extends` a été appelé, et que le
    // `where` porte bien l'organisation. La discrimination complète, elle,
    // vit dans createFakeScopedPrisma() (tests de findAllByOrganization).
    $extends: vi.fn(() => prisma),
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow : leur `where` porte
  // désormais deux champs (id ET organizationId), ce qui n'est plus une clé
  // unique. Les faux existants ne déclarent que findUniqueOrThrow — on adosse
  // l'un à l'autre plutôt que de réécrire chaque test, les deux désignant la
  // même lecture. Les assertions sur findUniqueOrThrow restent donc valables.
  alignerFindFirst(prisma);

  alignerFindFirst(prisma);
  return prisma;
}

// Faux client pour les lectures scopées RLS (étape 1 du runbook rls-rollout).
// `$extends()` rend un client DISTINCT plutôt que lui-même : c'est ce qui
// permet à un test de distinguer une lecture passée par le client scopé d'une
// lecture restée sur le client de base. Un faux qui se renverrait lui-même
// laisserait passer une régression sans rien dire.
function createFakeScopedPrisma(rows: any[] = []) {
  const scoped = { invoice: { findMany: vi.fn().mockResolvedValue(rows) } };
  const prisma: any = {
    invoice: { findMany: vi.fn().mockResolvedValue(rows) },
    $extends: vi.fn(() => scoped),
    __scoped: scoped,
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow (where à deux champs,
  // donc plus de clé unique). Les faux ne déclarent que findUniqueOrThrow : on
  // adosse l'un à l'autre, les deux désignant la même lecture.
  alignerFindFirst(prisma);
  return prisma;
}

function createFakeNumbering(number = "FG-2026-000001") {
  return { nextNumber: vi.fn().mockResolvedValue(number) };
}

// A3, ADR-026 — remplace le CertificationService global légataire injecté :
// InvoicesService ne signe plus jamais avec la clé unique de la plateforme,
// toujours avec la clé racine (déchiffrée) de l'organisation émettrice.
function createFakeSigningKeyService() {
  return {
    certifyForOrganization: vi.fn().mockResolvedValue({
      hash: "a".repeat(64),
      previousHash: "GENESIS",
      certificationId: "GN-GN123456-2026-ABCDEF",
      signature: "b".repeat(128),
      signingKeyId: "signing-key-1",
    }),
  };
}

// null par défaut = comportement des tests préexistants (aucun lien de paiement
// généré) — reflète le cas le plus courant en test unitaire, la panne Money Context
// étant précisément ce que Test "réussit normalement" exerce explicitement.
function createFakePaymentLinkClient(result: any = null) {
  return { tryGenerate: vi.fn().mockResolvedValue(result) };
}

function createFakePrismaForCreateDraft(regimeFiscal: string) {
  // createDraft() lit et écrit désormais par le client scopé (l'organisation
  // vient du DTO) : le faux doit donc porter $extends.
  const prisma: any = {
    invoice: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal }),
    },
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  alignerFindFirst(prisma);
  return prisma;
}

describe("InvoicesService — régime fiscal appliqué automatiquement (C4, ADR-033)", () => {
  it("calcule totalHt/totalTva à 18% pour une organisation normal_tva, jamais un taux client", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
    } as any);

    expect(result.totalTtc).toBe(1_180_000n);
    expect(result.totalHt).toBe(1_000_000n);
    expect(result.totalTva).toBe(180_000n);
  });

  it("n'applique aucune TVA pour une organisation tpu — impôt forfaitaire séparé, pas une TVA sur facture", async () => {
    const prisma = createFakePrismaForCreateDraft("tpu");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 350_000n }],
    } as any);

    expect(result.totalTva).toBe(0n);
    expect(result.totalHt).toBe(result.totalTtc);
  });

  it("garantit totalHt + totalTva === totalTtc même sur un montant qui ne se divise pas exactement par 1,18 (arrondi bigint)", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_000_000n }],
    } as any);

    expect(result.totalHt + result.totalTva).toBe(result.totalTtc);
  });
});

describe("InvoicesService — remise globale à la création (E2)", () => {
  it("réduit totalTtc/amountDue du pourcentage AVANT le calcul HT/TVA, et persiste discountPct", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 100_000n }],
      discountPct: 10,
    } as any);

    expect(result.totalTtc).toBe(90_000n);
    expect(result.amountDue).toBe(90_000n);
    expect(result.discountPct).toBe(10);
    expect(result.totalHt + result.totalTva).toBe(result.totalTtc);
  });

  it("sans remise (discountPct 0 ou absent), le comportement reste strictement inchangé — non-régression", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 100_000n }],
    } as any);

    expect(result.totalTtc).toBe(100_000n);
    expect(result.amountDue).toBe(100_000n);
    expect(result.discountPct).toBe(0);
  });
});

describe("InvoicesService — montant de référence en devise étrangère (I3, ADR-055)", () => {
  it("persiste les 4 champs de référence devise tels quels quand ils sont fournis", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Prestation conseil diaspora", quantity: 1, unitPrice: 1_180_000n }],
      referenceCurrency: "USD",
      referenceAmount: 125n,
      fxRate: "9440.50",
      fxRateDate: new Date("2026-08-09"),
    } as any);

    expect(result.referenceCurrency).toBe("USD");
    expect(result.referenceAmount).toBe(125n);
    expect(result.fxRate).toBe("9440.50");
    expect(result.fxRateDate).toEqual(new Date("2026-08-09"));
  });

  it("sans champs de référence devise, le comportement reste strictement inchangé — non-régression", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 100_000n }],
    } as any);

    expect(result.referenceCurrency).toBeUndefined();
    expect(result.referenceAmount).toBeUndefined();
    expect(result.fxRate).toBeUndefined();
    expect(result.fxRateDate).toBeUndefined();
  });
});

describe("InvoicesService — référence marché commande publique B2G (K3, ADR-090)", () => {
  it("persiste referenceMarche tel quel quand fourni — aucune vérification automatique (ADR-090)", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Fourniture matériel bureau", quantity: 1, unitPrice: 1_180_000n }],
      referenceMarche: "TELEMO-2026-000123",
    } as any);

    expect(result.referenceMarche).toBe("TELEMO-2026-000123");
  });

  it("sans referenceMarche, le comportement reste strictement inchangé — même parcours qu'avec référence (Backlog K3)", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 100_000n }],
    } as any);

    expect(result.referenceMarche).toBeUndefined();
  });
});

function createFakePrismaForConvertToInvoice(
  proforma: any,
  regimeFiscal: string,
  updateManyCount = 1,
) {
  const proformaState = { ...proforma };
  const prisma: any = {
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(proformaState),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-2", ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...proformaState, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
    // organizationScopedClient() appelle $extends ; setOrganizationScope()
    // appelle $executeRaw dans la transaction. Le vrai client porte les deux.
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow (where à deux champs,
  // donc plus de clé unique). Les faux ne déclarent que findUniqueOrThrow : on
  // adosse l'un à l'autre, les deux désignant la même lecture.
  alignerFindFirst(prisma);
  return prisma;
}

describe("InvoicesService — proforma → facture (C15, ADR-064)", () => {
  it("refuse d'émettre un proforma directement — /issue réservé aux factures", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", documentType: "proforma" }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/proforma/);
  });

  it("refuse de convertir un document qui n'est pas un proforma", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      { id: "inv-1", documentType: "invoice", status: "draft", organizationId: "org-1", totalTtc: 350_000n, lines: [] },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.convertToInvoice("inv-1", "org-1")).rejects.toThrow(/proforma/);
  });

  it("refuse de convertir un proforma déjà converti — empêche une double conversion", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "converted",
        organizationId: "org-1",
        totalTtc: 350_000n,
        lines: [],
      },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.convertToInvoice("inv-1", "org-1")).rejects.toThrow(/statut/);
  });

  it("crée une nouvelle facture draft et marque le proforma converted avec convertedToInvoiceId", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 350_000n,
        lines: [{ description: "Nuitée hôtel", quantity: 1, unitPrice: 350_000n, taxRateBps: 0 }],
      },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const newInvoice = await service.convertToInvoice("inv-1", "org-1");

    expect(newInvoice.documentType).toBe("invoice");
    expect(newInvoice.status).toBe("draft");
    expect(newInvoice.totalTtc).toBe(350_000n);
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      // organizationId dans le where de l'écriture — seule barrière tant que
      // RLS dort.
      where: { id: "inv-1", organizationId: "org-1", status: "draft" },
      data: { status: "converted" },
    });
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { convertedToInvoiceId: "inv-2" },
    });
  });

  it("convertit également un devis (documentType=quote) — C16, même mécanisme que le proforma", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "quote",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 220_000n,
        lines: [{ description: "Prestation conseil", quantity: 1, unitPrice: 220_000n, taxRateBps: 0 }],
      },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const newInvoice = await service.convertToInvoice("inv-1", "org-1");

    expect(newInvoice.documentType).toBe("invoice");
    expect(newInvoice.status).toBe("draft");
    expect(newInvoice.totalTtc).toBe(220_000n);
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      // organizationId dans le where de l'écriture — seule barrière tant que
      // RLS dort.
      where: { id: "inv-1", organizationId: "org-1", status: "draft" },
      data: { status: "converted" },
    });
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { convertedToInvoiceId: "inv-2" },
    });
  });

  it("copie discountPct du proforma vers la nouvelle facture (E2) — totalTtc déjà net, purement traçabilité", async () => {
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 315_000n,
        discountPct: 15,
        lines: [{ description: "Nuitée hôtel", quantity: 1, unitPrice: 315_000n, taxRateBps: 0 }],
      },
      "tpu",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const newInvoice = await service.convertToInvoice("inv-1", "org-1");

    expect(newInvoice.discountPct).toBe(15);
  });

  it("recalcule le régime fiscal depuis l'organisation ACTUELLE, jamais depuis les lignes déjà stockées sur le proforma", async () => {
    // Le proforma a été créé quand l'organisation était tpu (taxRateBps=0 sur ses
    // lignes) — au moment de la conversion, l'organisation est mockée normal_tva :
    // la nouvelle facture doit refléter 18%, pas le 0% figé sur le proforma.
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 1_180_000n,
        lines: [{ description: "Prestation conseil", quantity: 1, unitPrice: 1_180_000n, taxRateBps: 0 }],
      },
      "normal_tva",
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const newInvoice = await service.convertToInvoice("inv-1", "org-1");

    expect(newInvoice.totalHt).toBe(1_000_000n);
    expect(newInvoice.totalTva).toBe(180_000n);
  });

  it("refuse une conversion concurrente — deux appels quasi simultanés ne peuvent pas produire deux factures pour un même proforma", async () => {
    // updateMany count=0 simule le cas où une autre transaction a déjà fait basculer
    // ce proforma hors de draft entre notre lecture initiale et notre écriture —
    // reproduction réaliste d'un retry réseau (PWA offline-first, réseau mobile
    // instable) qui renverrait deux POST /convert-to-invoice quasi simultanés.
    const prisma = createFakePrismaForConvertToInvoice(
      {
        id: "inv-1",
        documentType: "proforma",
        status: "draft",
        organizationId: "org-1",
        totalTtc: 350_000n,
        lines: [{ description: "Nuitée hôtel", quantity: 1, unitPrice: 350_000n, taxRateBps: 0 }],
      },
      "tpu",
      0,
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.convertToInvoice("inv-1", "org-1")).rejects.toThrow(/conver/);
  });
});

function createFakePrismaForForfeitDeposit(
  proforma: any,
  depositPayment: any,
  updateManyCount = 1,
) {
  const prisma: any = {
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(proforma),
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue(depositPayment),
    },
    invoiceEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "event-1", ...data })),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
    // organizationScopedClient() appelle $extends ; setOrganizationScope()
    // appelle $executeRaw dans la transaction. Le vrai client porte les deux.
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow (where à deux champs,
  // donc plus de clé unique). Les faux ne déclarent que findUniqueOrThrow : on
  // adosse l'un à l'autre, les deux désignant la même lecture.
  alignerFindFirst(prisma);
  return prisma;
}

describe("InvoicesService — forfait d'arrhes no-show (C5, ADR-034)", () => {
  it("refuse le forfait si aucune arrhes n'a été enregistrée sur ce proforma", async () => {
    const prisma = createFakePrismaForForfeitDeposit(
      { id: "proforma-1", documentType: "proforma", status: "draft" },
      null,
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.forfeitDeposit("proforma-1", "no_show_forfeited", "user-djenabou", "org-1"),
    ).rejects.toThrow(/arrhes/);
  });

  it("écrit un InvoiceEvent avec le bon type/montant et passe le proforma à voided", async () => {
    const prisma = createFakePrismaForForfeitDeposit(
      { id: "proforma-1", documentType: "proforma", status: "draft" },
      { id: "payment-1", amount: 300_000n, depositType: "arrhes" },
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const event = await service.forfeitDeposit("proforma-1", "no_show_forfeited", "user-djenabou", "org-1");

    expect(event.type).toBe("no_show_forfeited");
    expect(event.amount).toBe(300_000n);
    expect(event.invoiceId).toBe("proforma-1");
    expect(event.actorId).toBe("user-djenabou");
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "proforma-1", status: "draft" },
      data: { status: "voided" },
    });
  });

  it("refuse avec un message dédié le forfait d'un proforma déjà converti — distinct d'une course concurrente", async () => {
    const prisma = createFakePrismaForForfeitDeposit(
      { id: "proforma-1", documentType: "proforma", status: "converted" },
      { id: "payment-1", amount: 300_000n, depositType: "arrhes" },
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.forfeitDeposit("proforma-1", "cancellation_indemnity", "user-djenabou", "org-1"),
    ).rejects.toThrow(/statut/);
  });

  it("refuse avec le message de course concurrente si le statut change entre la lecture et l'écriture", async () => {
    const prisma = createFakePrismaForForfeitDeposit(
      { id: "proforma-1", documentType: "proforma", status: "draft" },
      { id: "payment-1", amount: 300_000n, depositType: "arrhes" },
      0,
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.forfeitDeposit("proforma-1", "cancellation_indemnity", "user-djenabou", "org-1"),
    ).rejects.toThrow(/autre requête/);
  });
});

describe("InvoicesService — immutabilité post-émission", () => {
  it("refuse toute mutation directe d'une facture issued — seul un avoir peut corriger", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.updateDraft("inv-1", { totalTtc: 999n }, "org-1")).rejects.toThrow(/immuable/);
  });

  it("autorise la mutation d'une facture encore draft", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.updateDraft("inv-1", { totalTtc: 999n }, "org-1");

    // updateMany filtré par organisation, et non plus update par id seul.
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", organizationId: "org-1" },
      data: { totalTtc: 999n },
    });
  });
});

describe("InvoicesService — machine à états", () => {
  // Non-régression — un brouillon annulé cassait la chaîne de hash de TOUTES
  // les factures suivantes, en silence. Il porte status='voided' (il passait
  // donc l'ancien filtre `not: "draft"`) avec issued_at NULL, et PostgreSQL
  // trie les NULL EN PREMIER en ORDER BY … DESC : c'est lui qui remontait,
  // previousHash devenait nul, et la facture suivante repartait sur GENESIS.
  //
  // Le faux ci-dessous applique VRAIMENT le where et reproduit ce tri : sans
  // cela le test passerait quelle que soit la requête, et ne prouverait rien.
  it("un brouillon annulé ne devient jamais un maillon de la chaîne de hash", async () => {
    const HASH_PRECEDENT = "c".repeat(64);
    const lignes = [
      {
        id: "inv-emise",
        status: "issued",
        organizationId: "org-1",
        issuedAt: new Date("2026-09-01T10:00:00Z"),
        hash: HASH_PRECEDENT,
      },
      // Jamais émise : ni date d'émission, ni hash. Ce n'est pas un maillon.
      { id: "inv-brouillon-annule", status: "voided", organizationId: "org-1", issuedAt: null, hash: null },
    ];

    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          const retenues = lignes.filter((ligne) => {
            if (where.organizationId && ligne.organizationId !== where.organizationId) return false;
            if (where.issuedAt?.not === null && ligne.issuedAt === null) return false;
            if (where.status?.not && ligne.status === where.status.not) return false;
            return true;
          });
          // NULLS FIRST en DESC, comme PostgreSQL.
          const triees = [...retenues].sort((a, b) => {
            if (a.issuedAt === null) return -1;
            if (b.issuedAt === null) return 1;
            return b.issuedAt.getTime() - a.issuedAt.getTime();
          });
          return Promise.resolve(triees[0] ?? null);
        }),
      },
    });

    const certification = createFakeSigningKeyService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    await service.issue("inv-1", "org-1");

    expect(certification.certifyForOrganization).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ previousHash: HASH_PRECEDENT }),
      expect.anything(),
    );
  });

  it("autorise draft → issued et certifie la facture (chaînage GENESIS pour la 1ère facture de l'org)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
    });
    const numbering = createFakeNumbering();
    const certification = createFakeSigningKeyService();
    const service = new InvoicesService(
      prisma as any,
      numbering as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.issue("inv-1", "org-1");

    // Quality Audit 2026-08-23, revue post-fix #1 — 3e argument (tx) désormais
    // passé explicitement, voir invoice-numbering.service.ts/organization-signing-key.service.ts.
    expect(numbering.nextNumber).toHaveBeenCalledWith("org-1", expect.any(Number), expect.anything());
    expect(certification.certifyForOrganization).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ previousHash: "GENESIS" }),
      expect.anything(),
    );
    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
  });

  it("passe le tx de la transaction en cours à nextNumber()/certifyForOrganization(), jamais le client Prisma global (Quality Audit 2026-08-23, revue post-fix #1)", async () => {
    // Sans ce câblage, nextNumber() écrirait en autocommit sur le client global
    // — un numéro de séquence serait consommé de façon irréversible même si
    // l'écriture finale de la transaction échoue ensuite. createFakePrisma()
    // définit $transaction: (callback) => callback(prisma) — le tx REÇU PAR LE
    // CALLBACK est donc, par construction, ce même objet `prisma` : si
    // InvoicesService appelait encore this.prisma au lieu du tx reçu, ce test
    // resterait identique en valeur mais on vérifie ici précisément l'identité
    // de l'objet passé en 3e argument, pas simplement sa présence.
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
    });
    const numbering = createFakeNumbering();
    const certification = createFakeSigningKeyService();
    const service = new InvoicesService(
      prisma as any,
      numbering as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    await service.issue("inv-1", "org-1");

    expect(numbering.nextNumber.mock.calls[0][2]).toBe(prisma);
    expect(certification.certifyForOrganization.mock.calls[0][2]).toBe(prisma);
  });

  it("persiste signingKeyId — la facture référence la clé racine de son organisation, jamais la clé globale légataire (A3, ADR-026)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.issue("inv-1", "org-1");

    expect(result.signingKeyId).toBe("signing-key-1");
  });

  it("émet une facture pour une organisation sans NIF avec le placeholder de certification (B1/B4)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", nif: null, commercialTier: "freemium" }),
      },
    });
    const certification = createFakeSigningKeyService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    await service.issue("inv-1", "org-1");

    expect(certification.certifyForOrganization).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ organizationNif: "UNVERIFI" }),
      expect.anything(),
    );
  });

  it("refuse d'émettre (issued) une facture qui n'est pas draft", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued" }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/statut/);
  });

  it("annule (voided) une facture draft sans paiement", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.void("inv-1", "org-1");

    expect(result.status).toBe("voided");
  });

  it("refuse d'annuler une facture déjà voided (Quality Audit 2026-08-23, revue post-fix #3, cas limite)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "voided", amountPaid: 0n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.void("inv-1", "org-1")).rejects.toThrow(/statut voided/);
  });

  it("refuse d'annuler une facture ayant déjà un paiement enregistré", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "issued", amountPaid: 500_000n }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.void("inv-1", "org-1")).rejects.toThrow(/avoir/);
  });

  it("refuse d'annuler si updateMany ne réclame rien (paiement/statut modifié entretemps, Quality Audit 2026-08-23, finding #3)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", amountPaid: 0n }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.void("inv-1", "org-1")).rejects.toThrow(ConflictException);
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      // organizationId dans le where de l'ÉCRITURE, pas seulement de la lecture :
      // c'est le garde-fou qui empêche d'annuler la facture d'une autre
      // organisation tant que RLS est dormant.
      where: { id: "inv-1", organizationId: "org-1", status: { in: ["draft", "issued"] }, amountPaid: 0n },
      data: { status: "voided" },
    });
  });

  it("traduit une violation de contrainte unique sur (organization_id, number) en erreur explicite, jamais un 500 brut", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["organization_id", "number"] },
    });
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
        update: vi.fn().mockRejectedValue(uniqueViolation),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/numéro/);
  });

  it("traduit une violation de contrainte unique sur certification_id en erreur explicite, jamais un 500 brut (collision entre organisations sans NIF, B1/B4)", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["certification_id"] },
    });
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
        update: vi.fn().mockRejectedValue(uniqueViolation),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/certification/);
  });

  it("convertit un timeout de transaction Prisma (P2028, contention sur FOR UPDATE) en 409 explicite, pas un 500 brut (Quality Audit 2026-08-23, revue post-fix #1)", async () => {
    const p2028 = Object.assign(new Error("Transaction already closed"), { code: "P2028" });
    const prisma: any = {
      $transaction: vi.fn().mockRejectedValue(p2028),
    // organizationScopedClient() appelle $extends ; setOrganizationScope()
    // appelle $executeRaw dans la transaction. Le vrai client porte les deux.
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(ConflictException);
    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/réessayer/);
  });

  it("sous deux appels concurrents réels sur la même facture draft, une seule certification est committée, jamais un trou dans la séquence (Quality Audit 2026-08-23, finding #1)", async () => {
    // Simule le verrou de ligne Postgres (SELECT ... FOR UPDATE) réel de la
    // transaction : $queryRaw acquiert un mutex, $transaction le relâche au
    // finally — un $transaction/$queryRaw naïfs (comme createFakePrisma())
    // n'exercent aucune vraie section critique et laisseraient ce test passer
    // même sans le fix (les deux callbacks liraient "draft" avant que l'un des
    // deux n'écrive), donc ce mock dédié est nécessaire pour prouver la garde.
    let invoiceState: any = {
      id: "inv-1",
      status: "draft",
      documentType: "invoice",
      organizationId: "org-1",
      totalTtc: 1_500_000n,
    };
    let lockHeld = false;
    const lockWaiters: Array<() => void> = [];
    function acquireLock(): Promise<void> {
      if (!lockHeld) {
        lockHeld = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => lockWaiters.push(resolve));
    }
    function releaseLock() {
      const next = lockWaiters.shift();
      if (next) next();
      else lockHeld = false;
    }

    const prisma: any = {
      invoice: {
        findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve(invoiceState)),
        // Même lecture que findUniqueOrThrow : le service migré RLS filtre sur
        // { id, organizationId }, ce qui n'est plus une clé unique.
        findFirstOrThrow: vi.fn().mockImplementation(() => Promise.resolve(invoiceState)),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation(({ data }: any) => {
          invoiceState = { ...invoiceState, ...data };
          return Promise.resolve(invoiceState);
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", nif: "GN12345678", commercialTier: "freemium" }),
      },
      fiscalPeriodClosing: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockImplementation(() => acquireLock()),
      // setOrganizationScope() : neutre ici. Il ne doit surtout PAS prendre le
      // verrou simulé — le scope RLS se pose, il ne sérialise rien.
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn(async (callback: any) => {
        try {
          return await callback(prisma);
        } finally {
          releaseLock();
        }
      }),
      // $executeRaw est déjà déclaré plus haut (neutre, il ne prend pas le
      // verrou simulé) — ici seul $extends manquait.
      $extends: vi.fn(() => prisma),
    };

    const numbering = createFakeNumbering();
    const certification = createFakeSigningKeyService();
    const service = new InvoicesService(
      prisma as any,
      numbering as any,
      certification as any,
      createFakePaymentLinkClient() as any,
    );

    const results = await Promise.allSettled([service.issue("inv-1", "org-1"), service.issue("inv-1", "org-1")]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    // La preuve centrale du fix : la requête perdante n'a JAMAIS appelé
    // nextNumber() ni certifyForOrganization() — jamais de trou dans la
    // séquence légale OHADA Article 23, jamais de certification gaspillée.
    expect(numbering.nextNumber).toHaveBeenCalledTimes(1);
    expect(certification.certifyForOrganization).toHaveBeenCalledTimes(1);
  });
});

describe("InvoicesService — gel post-récupération de compte (G2, réinterprété)", () => {
  it("refuse d'émettre si paymentsFrozenUntil de l'organisation est dans le futur", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "org-1",
          nif: "GN12345678",
          commercialTier: "freemium",
          paymentsFrozenUntil: new Date(Date.now() + 3600_000),
        }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/gel/);
  });

  it("autorise l'émission si paymentsFrozenUntil est dans le passé (fenêtre expirée)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "org-1",
          nif: "GN12345678",
          commercialTier: "freemium",
          paymentsFrozenUntil: new Date(Date.now() - 3600_000),
        }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).resolves.toMatchObject({ status: "issued" });
  });

  it("autorise l'émission si paymentsFrozenUntil est null (jamais gelé)", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).resolves.toMatchObject({ status: "issued" });
  });
});

describe("InvoicesService — notification du client au lien de paiement (C9)", () => {
  const draftInvoiceWithCustomer = {
    id: "inv-1",
    status: "draft",
    documentType: "invoice",
    organizationId: "org-1",
    customerId: "cust-1",
    totalTtc: 1_500_000n,
  };
  const resolvedLink = {
    paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-stub-inv-1",
    providerRef: "djomy-stub-inv-1",
    expiresAt: new Date("2026-09-07T00:00:00.000Z"),
  };

  function createNotificationService(overrides: { notify?: ReturnType<typeof vi.fn> } = {}) {
    return { notify: overrides.notify ?? vi.fn().mockResolvedValue(undefined) };
  }

  it("notifie le client via PaymentLinkNotificationService quand le lien de paiement réussit et que le client a un customerId", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoiceWithCustomer) },
    });
    (prisma as any).customer = { findUnique: vi.fn().mockResolvedValue({ phone: "+224622334455", notificationChannel: "sms" }) };
    alignerFindFirst(prisma); // customer greffé APRÈS le constructeur : réaligner
    const notificationService = createNotificationService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedLink) as any,
      notificationService as any,
    );

    const result = await service.issue("inv-1", "org-1");

    expect((prisma as any).customer.findUnique).toHaveBeenCalledWith({ where: { id: "cust-1", organizationId: "org-1" } });
    expect(notificationService.notify).toHaveBeenCalledWith(
      { phone: "+224622334455", notificationChannel: "sms" },
      resolvedLink.paymentLinkUrl,
      result.totalTtc,
      "fr",
    );
  });

  it("passe la langue de l'organisation émettrice à PaymentLinkNotificationService (i18n)", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoiceWithCustomer) },
      organization: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "org-1", nif: "GN12345678", commercialTier: "freemium", preferredLanguage: "pular" }),
      },
    });
    (prisma as any).customer = { findUnique: vi.fn().mockResolvedValue({ phone: "+224622334455", notificationChannel: "sms" }) };
    alignerFindFirst(prisma); // customer greffé APRÈS le constructeur : réaligner
    const notificationService = createNotificationService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedLink) as any,
      notificationService as any,
    );

    await service.issue("inv-1", "org-1");

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "pular",
    );
  });

  it("ne notifie jamais si la facture n'a pas de customerId", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          organizationId: "org-1",
          totalTtc: 1_500_000n,
        }),
      },
    });
    const notificationService = createNotificationService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedLink) as any,
      notificationService as any,
    );

    await service.issue("inv-1", "org-1");

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it("ne notifie jamais si la génération du lien de paiement a échoué (Money Context en panne)", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoiceWithCustomer) },
    });
    const notificationService = createNotificationService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(null) as any,
      notificationService as any,
    );

    await service.issue("inv-1", "org-1");

    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it("l'échec de la notification ne fait jamais échouer l'émission — meilleur effort", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoiceWithCustomer) },
    });
    (prisma as any).customer = { findUnique: vi.fn().mockResolvedValue({ phone: "+224622334455", notificationChannel: "sms" }) };
    alignerFindFirst(prisma); // customer greffé APRÈS le constructeur : réaligner
    const notificationService = createNotificationService({ notify: vi.fn().mockRejectedValue(new Error("panne")) });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedLink) as any,
      notificationService as any,
    );

    await expect(service.issue("inv-1", "org-1")).resolves.toMatchObject({ status: "issued" });
  });

  it("n'échoue jamais l'émission si aucun PaymentLinkNotificationService n'est fourni (compat, 65+ tests existants sans ce paramètre)", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoiceWithCustomer) },
    });
    (prisma as any).customer = { findUnique: vi.fn().mockResolvedValue({ phone: "+224622334455", notificationChannel: "sms" }) };
    alignerFindFirst(prisma); // customer greffé APRÈS le constructeur : réaligner
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedLink) as any,
    );

    await expect(service.issue("inv-1", "org-1")).resolves.toMatchObject({ status: "issued" });
  });
});

describe("InvoicesService — lien de paiement à l'émission (C2 Phase 2a)", () => {
  const draftInvoice = {
    id: "inv-1",
    status: "draft",
    documentType: "invoice",
    organizationId: "org-1",
    totalTtc: 1_500_000n,
  };
  const resolvedLink = {
    paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-stub-inv-1",
    providerRef: "djomy-stub-inv-1",
    expiresAt: new Date("2026-09-07T00:00:00.000Z"),
  };

  it("peuple paymentLinkUrl/paymentLinkId/paymentLinkExpiresAt quand la génération de lien réussit", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1", "org-1");

    // amountGnf majoré de la commission freemium (2,1% de 1 500 000 = 31 500,
    // ADR-074, corrigé pour absorber le frais gateway Djomy réel 1,4%) — jamais
    // totalTtc seul, voir issue().
    expect(paymentLinkClient.tryGenerate).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      organizationId: "org-1",
      amountGnf: 1_531_500n,
    });
    expect(result.paymentLinkUrl).toBe(resolvedLink.paymentLinkUrl);
    expect(result.paymentLinkId).toBe(resolvedLink.providerRef);
    expect(result.paymentLinkExpiresAt).toBe(resolvedLink.expiresAt);
  });

  it("majore le lien selon le palier commercial de l'organisation (ADR-074) — pro 1,5%, pas freemium", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "pro" }) },
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    await service.issue("inv-1", "org-1");

    // 1,5% de 1 500 000 = 22 500 (pro, pas 2,5% freemium = 37 500).
    expect(paymentLinkClient.tryGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ amountGnf: 1_522_500n }),
    );
  });

  it("réussit normalement (émission jamais bloquée) quand le second update() échoue — money-api a répondu un corps inattendu", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    // Simule un écrit refusé par Prisma (ex. paymentLinkExpiresAt invalide suite à un
    // corps de réponse money-api malformé) — le premier update() (certification)
    // réussit normalement, seul le second (lien) échoue.
    let callCount = 0;
    prisma.invoice.update = vi.fn().mockImplementation(({ data }: any) => {
      callCount += 1;
      if (callCount === 2) {
        return Promise.reject(new Error("Invalid `DateTime` provided"));
      }
      return Promise.resolve({ ...draftInvoice, ...data });
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1", "org-1");

    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
    expect(result.paymentLinkUrl).toBeUndefined();
  });

  it("réussit normalement (émission jamais bloquée) quand la génération de lien échoue — Money Context en panne", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const paymentLinkClient = createFakePaymentLinkClient(null);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1", "org-1");

    expect(result.status).toBe("issued");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
    expect(result.paymentLinkUrl).toBeUndefined();
  });

  it("certifie la facture strictement à l'identique, que le lien de paiement réussisse ou échoue", async () => {
    const certification = createFakeSigningKeyService();

    const prismaSucces = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const serviceSucces = new InvoicesService(
      prismaSucces as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient(resolvedLink) as any,
    );
    const resultSucces = await serviceSucces.issue("inv-1", "org-1");

    const prismaEchec = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
    });
    const serviceEchec = new InvoicesService(
      prismaEchec as any,
      createFakeNumbering() as any,
      certification as any,
      createFakePaymentLinkClient(null) as any,
    );
    const resultEchec = await serviceEchec.issue("inv-1", "org-1");

    expect(resultSucces.number).toBe(resultEchec.number);
    expect(resultSucces.certificationId).toBe(resultEchec.certificationId);
    expect(resultSucces.hash).toBe(resultEchec.hash);
    expect(resultSucces.signature).toEqual(resultEchec.signature);
  });
});

describe("InvoicesService — envoi du lien de paiement immédiat ou différé (C20, ERD payment_link_auto_send)", () => {
  const draftInvoice = {
    id: "inv-1",
    status: "draft",
    documentType: "invoice",
    organizationId: "org-1",
    totalTtc: 1_500_000n,
  };
  const resolvedLink = {
    paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-stub-inv-1",
    providerRef: "djomy-stub-inv-1",
    expiresAt: new Date("2026-09-07T00:00:00.000Z"),
  };

  it("ne génère PAS de lien à l'émission quand paymentLinkAutoSend est explicitement false — envoi différé", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "org-1",
          commercialTier: "freemium",
          paymentLinkAutoSend: false,
        }),
      },
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1", "org-1");

    expect(paymentLinkClient.tryGenerate).not.toHaveBeenCalled();
    expect(result.status).toBe("issued");
    expect(result.paymentLinkUrl).toBeUndefined();
  });

  it("génère le lien normalement quand paymentLinkAutoSend est explicitement true — comportement inchangé", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue(draftInvoice) },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "org-1",
          commercialTier: "freemium",
          paymentLinkAutoSend: true,
        }),
      },
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    const result = await service.issue("inv-1", "org-1");

    expect(paymentLinkClient.tryGenerate).toHaveBeenCalled();
    expect(result.paymentLinkUrl).toBe(resolvedLink.paymentLinkUrl);
  });
});

describe("InvoicesService — rattacher un client à la création (C6, ADR-039)", () => {
  function createFakePrismaWithCustomer(customer: any) {
    // createDraft() passe par le client scopé : le faux doit porter $extends.
    const prisma: any = {
      invoice: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal: "normal_tva" }),
      },
      customer: {
        findUnique: vi.fn().mockResolvedValue(customer),
      },
      $extends: vi.fn(() => prisma),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    alignerFindFirst(prisma);
    return prisma;
  }

  it("crée la facture avec customerId quand le client appartient à la même organisation", async () => {
    const prisma = createFakePrismaWithCustomer({ id: "cust-1", organizationId: "org-1" });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      customerId: "cust-1",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
    } as any);

    expect((prisma as any).customer.findUnique).toHaveBeenCalledWith({ where: { id: "cust-1", organizationId: "org-1" } });
    expect(result.customerId).toBe("cust-1");
  });

  it("rejette un customerId appartenant à une AUTRE organisation", async () => {
    const prisma = createFakePrismaWithCustomer({ id: "cust-1", organizationId: "org-2" });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.createDraft({
        organizationId: "org-1",
        documentType: "invoice",
        customerId: "cust-1",
        lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
      } as any),
    ).rejects.toThrow(/introuvable pour cette organisation/);
  });

  it("rejette un customerId inexistant", async () => {
    const prisma = createFakePrismaWithCustomer(null);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.createDraft({
        organizationId: "org-1",
        documentType: "invoice",
        customerId: "cust-inconnu",
        lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
      } as any),
    ).rejects.toThrow(/introuvable pour cette organisation/);
  });

  it("ne fait AUCUNE requête customer quand customerId est absent — non-régression des tests createDraft() existants", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
    } as any);

    expect((prisma as any).customer).toBeUndefined();
  });
});

describe("InvoicesService — rattacher une succursale à la création (E1, ADR-037)", () => {
  function createFakePrismaWithBranch(branch: any) {
    // createDraft() passe par le client scopé : le faux doit porter $extends.
    const prisma: any = {
      invoice: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal: "normal_tva" }),
      },
      branch: {
        findUnique: vi.fn().mockResolvedValue(branch),
      },
      $extends: vi.fn(() => prisma),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    alignerFindFirst(prisma);
    return prisma;
  }

  it("crée la facture avec branchId quand la succursale appartient à la même organisation", async () => {
    const prisma = createFakePrismaWithBranch({ id: "branch-1", organizationId: "org-1" });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      branchId: "branch-1",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
    } as any);

    expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "branch-1", organizationId: "org-1" } });
    expect(result.branchId).toBe("branch-1");
  });

  it("rejette un branchId appartenant à une AUTRE organisation", async () => {
    const prisma = createFakePrismaWithBranch({ id: "branch-1", organizationId: "org-2" });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.createDraft({
        organizationId: "org-1",
        documentType: "invoice",
        branchId: "branch-1",
        lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
      } as any),
    ).rejects.toThrow(/introuvable pour cette organisation/);
  });

  it("rejette un branchId inexistant", async () => {
    const prisma = createFakePrismaWithBranch(null);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.createDraft({
        organizationId: "org-1",
        documentType: "invoice",
        branchId: "branch-inconnue",
        lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
      } as any),
    ).rejects.toThrow(/introuvable pour cette organisation/);
  });

  it("ne fait AUCUNE requête branch quand branchId est absent — non-régression des tests createDraft() existants", async () => {
    const prisma = createFakePrismaForCreateDraft("normal_tva");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 1_180_000n }],
    } as any);

    expect((prisma as any).branch).toBeUndefined();
  });
});

function createFakePrismaForRegeneratePaymentLink(
  invoice: any,
  organization: any = {},
  overrides: { updateManyCount?: number } = {},
) {
  // Security Audit 2026-08-23, finding #3 — état mutable : updateMany() applique
  // réellement les données (comme un vrai `where` transactionnel), pour que le
  // findUniqueOrThrow() final reflète le lien fraîchement régénéré. updateManyCount
  // permet de simuler explicitement une facture réglée entre-temps (count=0).
  let invoiceState = { ...invoice };
  const prisma: any = {
    invoice: {
      findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve(invoiceState)),
      updateMany: vi.fn().mockImplementation(({ data }: any) => {
        const count = overrides.updateManyCount ?? 1;
        if (count > 0) {
          invoiceState = { ...invoiceState, ...data };
        }
        return Promise.resolve({ count });
      }),
    },
    // commercialTier: freemium par défaut (grille commission, ADR-074).
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "freemium", ...organization }),
    },
    invoiceEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "event-1", ...data })),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
    // organizationScopedClient() appelle $extends ; setOrganizationScope()
    // appelle $executeRaw dans la transaction. Le vrai client porte les deux.
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow (where à deux champs,
  // donc plus de clé unique). Les faux ne déclarent que findUniqueOrThrow : on
  // adosse l'un à l'autre, les deux désignant la même lecture.
  alignerFindFirst(prisma);
  return prisma;
}

const resolvedPaymentLink = {
  paymentLinkUrl: "https://pay.facture.gn/nouveau-lien",
  providerRef: "djomy-ref-nouveau",
  expiresAt: new Date("2026-09-08T00:00:00.000Z"),
};

describe("InvoicesService — régénération du lien de paiement à la demande (C18, ADR-066)", () => {
  it("met à jour paymentLinkUrl/paymentLinkId/paymentLinkExpiresAt quand la régénération réussit", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "issued",
      totalTtc: 350_000n,
      amountDue: 350_000n,
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );

    const result = await service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1");

    expect(result.paymentLinkUrl).toBe("https://pay.facture.gn/nouveau-lien");
    expect(result.paymentLinkId).toBe("djomy-ref-nouveau");
    expect(result.paymentLinkExpiresAt).toEqual(new Date("2026-09-08T00:00:00.000Z"));
  });

  it("écrit un InvoiceEvent payment_link_regenerated tracé à l'auteur de la demande", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "issued",
      totalTtc: 350_000n,
      amountDue: 350_000n,
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );

    await service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1");

    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: { invoiceId: "inv-1", type: "payment_link_regenerated", actorId: "user-djenabou" },
    });
  });

  it("met à jour le lien et trace l'InvoiceEvent atomiquement (revue sécurité) — jamais un lien mis à jour sans sa trace d'audit", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "issued",
      totalTtc: 350_000n,
      amountDue: 350_000n,
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );

    await service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1");

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("lève une ConflictException explicite si la génération échoue — jamais un succès silencieux (divergence assumée vs. issue())", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "issued",
      totalTtc: 350_000n,
      amountDue: 350_000n,
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(null) as any,
    );

    await expect(service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("refuse la régénération sur une facture draft — rien n'a encore été émis", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "draft",
      totalTtc: 350_000n,
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );

    await expect(service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
  });

  it("refuse la régénération sur une facture voided ou paid — plus rien à régler", async () => {
    const prismaVoided = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "voided",
      totalTtc: 350_000n,
    });
    const serviceVoided = new InvoicesService(
      prismaVoided as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );
    await expect(serviceVoided.regeneratePaymentLink("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);

    const prismaPaid = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "paid",
      totalTtc: 350_000n,
    });
    const servicePaid = new InvoicesService(
      prismaPaid as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );
    await expect(servicePaid.regeneratePaymentLink("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
  });

  it("accepte la régénération sur une facture partially_paid — toujours payable", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "partially_paid",
      totalTtc: 350_000n,
      amountDue: 200_000n,
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );

    const result = await service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1");

    expect(result.paymentLinkUrl).toBe("https://pay.facture.gn/nouveau-lien");
  });

  it("génère le nouveau lien pour le solde restant (amountDue), jamais le total original (C11 — bug corrigé)", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink({
      id: "inv-1",
      organizationId: "org-1",
      status: "partially_paid",
      totalTtc: 350_000n,
      amountDue: 120_000n,
    });
    const paymentLinkClient = createFakePaymentLinkClient(resolvedPaymentLink);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      paymentLinkClient as any,
    );

    await service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1");

    // 120 000 + commission freemium 2,1% (2 520) = 122 520 (ADR-074, corrigé).
    expect(paymentLinkClient.tryGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ amountGnf: 122_520n }),
    );
  });

  it("rejette (ConflictException) si la facture a été réglée pendant l'appel provider — jamais un lien écrit sur une facture déjà payée (Security Audit 2026-08-23, finding #3)", async () => {
    const prisma = createFakePrismaForRegeneratePaymentLink(
      {
        id: "inv-1",
        organizationId: "org-1",
        status: "partially_paid",
        totalTtc: 350_000n,
        amountDue: 200_000n,
      },
      {},
      { updateManyCount: 0 },
    );
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient(resolvedPaymentLink) as any,
    );

    await expect(service.regeneratePaymentLink("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
    expect(prisma.invoiceEvent.create).not.toHaveBeenCalled();
  });
});

function createFakePrismaForCreateAssisted(
  overrides: { user?: any; assistedSession?: any; regimeFiscal?: string } = {},
) {
  let invoiceState: any = { id: "inv-1", documentType: "invoice" };

  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(
        overrides.user !== undefined ? overrides.user : { id: "agent-1", isCommercialAgent: true },
      ),
    },
    assistedSession: {
      findFirst: vi.fn().mockResolvedValue(
        overrides.assistedSession !== undefined
          ? overrides.assistedSession
          : { id: "session-1", commercialAgentUserId: "agent-1", organizationId: "org-1" },
      ),
    },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "org-1",
        regimeFiscal: overrides.regimeFiscal ?? "tpu",
        commercialTier: "freemium",
      }),
    },
    invoice: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        invoiceState = { ...invoiceState, ...data };
        return Promise.resolve(invoiceState);
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve(invoiceState)),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }: any) => {
        invoiceState = { ...invoiceState, ...data };
        return Promise.resolve(invoiceState);
      }),
    },
    // Quality Audit 2026-08-23, finding #1 — voir createFakePrisma() plus haut
    // dans ce fichier pour le même ajout et sa justification.
    fiscalPeriodClosing: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((callback: any) => callback(prisma)),
    $queryRaw: vi.fn().mockResolvedValue([]),
    // organizationScopedClient() appelle $extends ; setOrganizationScope()
    // appelle $executeRaw dans la transaction. Le vrai client porte les deux.
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow (where à deux champs,
  // donc plus de clé unique). Les faux ne déclarent que findUniqueOrThrow : on
  // adosse l'un à l'autre, les deux désignant la même lecture.
  alignerFindFirst(prisma);
  return prisma;
}

const assistedInvoiceDto = {
  organizationId: "org-1",
  documentType: "invoice" as const,
  lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 350_000n }],
};

describe("InvoicesService — facture assistée par un agent terrain (F2, ADR-045)", () => {
  it("crée ET émet la facture en un seul appel pour un agent avec une AssistedSession valide", async () => {
    const prisma = createFakePrismaForCreateAssisted();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createAssisted(assistedInvoiceDto as any, "agent-1");

    expect(result.status).toBe("issued");
    expect(result.number).toBe("FG-2026-000001");
    expect(result.certificationId).toBe("GN-GN123456-2026-ABCDEF");
  });

  it("refuse si l'appelant n'a pas isCommercialAgent (relu depuis la DB)", async () => {
    const prisma = createFakePrismaForCreateAssisted({ user: { id: "agent-1", isCommercialAgent: false } });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.createAssisted(assistedInvoiceDto as any, "agent-1")).rejects.toThrow(/agent terrain/);
  });

  it("refuse si aucune AssistedSession n'existe pour ce couple agent/organisation", async () => {
    const prisma = createFakePrismaForCreateAssisted({ assistedSession: null });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.createAssisted(assistedInvoiceDto as any, "agent-1")).rejects.toThrow(/AssistedSession/);
  });

  it("refuse si l'AssistedSession a été révoquée (Security Audit 2026-08-23, finding #8)", async () => {
    // Le filtre revokedAt:null vit dans le where Prisma — un vrai driver ne
    // renverrait jamais cette ligne, simulé ici par null (même précédent que le
    // test "autre organisation" ci-dessous).
    const prisma = createFakePrismaForCreateAssisted({ assistedSession: null });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.createAssisted(assistedInvoiceDto as any, "agent-1")).rejects.toThrow(/AssistedSession active/);
  });

  it("refuse si l'AssistedSession existe mais pour une autre organisation", async () => {
    const prisma = createFakePrismaForCreateAssisted();
    prisma.assistedSession.findFirst = vi.fn().mockResolvedValue(null); // simule le filtre where non satisfait
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.createAssisted({ ...assistedInvoiceDto, organizationId: "org-2" } as any, "agent-1"),
    ).rejects.toThrow(/AssistedSession/);
  });
});

describe("InvoicesService — consulter le statut d'une facture (C10)", () => {
  it("retourne la facture telle qu'elle existe actuellement en DB, sans transformation", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "inv-1",
          status: "partially_paid",
          amountDue: 500_000n,
          amountPaid: 500_000n,
          paymentLinkUrl: "https://pay.djomy.africa/abc",
        }),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.findOne("inv-1", "org-1");

    expect(result).toEqual({
      id: "inv-1",
      status: "partially_paid",
      amountDue: 500_000n,
      amountPaid: 500_000n,
      paymentLinkUrl: "https://pay.djomy.africa/abc",
    });
  });

  // L'écran de détail affiche les lignes et le journal d'événements. Sans cet
  // include, la page se rendrait sans erreur, simplement vide de son contenu
  // le plus utile — une régression invisible côté API et silencieuse côté web.
  it("remonte les lignes, la chaîne d'événements et le client", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1" }) },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findOne("inv-1", "org-1");

    const args = (prisma as any).invoice.findUniqueOrThrow.mock.calls[0][0];
    expect(args.include.lines).toBeTruthy();
    expect(args.include.events).toBeTruthy();
    expect(args.include.customer).toBeTruthy();
    // Antéchronologique : sur une facture ancienne, ce qui vient de se passer
    // est ce qu'on cherche en premier.
    expect(args.include.events.orderBy).toEqual({ createdAt: "desc" });
  });

  // `include` seul sur actor/customer remonterait l'entité User entière —
  // passwordHash compris — dans une réponse HTTP. Le select est la barrière,
  // et elle doit tenir même quand un champ est ajouté à ces tables plus tard.
  it("ne remonte JAMAIS l'entité User ni Customer en entier", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1" }) },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findOne("inv-1", "org-1");

    const args = (prisma as any).invoice.findUniqueOrThrow.mock.calls[0][0];
    expect(args.include.events.include.actor.select).toBeTruthy();
    expect(args.include.events.include.actor.select.passwordHash).toBeUndefined();
    expect(args.include.customer.select).toBeTruthy();
  });

  it("propage l'échec (404) si la facture n'existe pas", async () => {
    const prisma = createFakePrisma({
      invoice: {
        findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("Facture introuvable")),
      },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.findOne("inv-inconnue", "org-1")).rejects.toThrow(/introuvable/);
  });
});

// RLS, étape 1 du runbook rls-rollout : la lecture doit passer par
// organizationScopedClient(), qui pose app.current_org_id pour la durée de
// la transaction. Tant que les politiques sont dormantes cela ne change rien
// au résultat — d'où ce test, sinon rien ne signalerait une régression.
describe("findAllByOrganization — scope RLS", () => {
  it("passe par le client scopé RLS, avec l'organisation demandée", async () => {
    const prisma = createFakeScopedPrisma();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findAllByOrganization("org-1", {});

    expect(prisma.$extends).toHaveBeenCalledTimes(1);
    expect(prisma.__scoped.invoice.findMany).toHaveBeenCalled();
    // Le client de base ne doit PAS avoir servi : sinon la requête
    // s'exécuterait hors de toute transaction scopée.
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  // Le where explicite reste la seule protection réelle tant que RLS dort.
  it("garde organizationId dans le where, RLS étant encore dormant", async () => {
    const prisma = createFakeScopedPrisma();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findAllByOrganization("org-1", {});

    const args = prisma.__scoped.invoice.findMany.mock.calls[0][0];
    expect(args.where.organizationId).toBe("org-1");
  });
});

describe("findAllByOrganization", () => {
  it("liste les factures de l'organisation, plus récentes d'abord, paginées avec une limite par défaut", async () => {
    const prisma = createFakeScopedPrisma([{ id: "inv-2" }, { id: "inv-1" }]);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.findAllByOrganization("org-1", {});

    expect(prisma.__scoped.invoice.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { createdAt: "desc" },
      take: 50,
      skip: 0,
    });
    expect(result).toEqual([{ id: "inv-2" }, { id: "inv-1" }]);
  });

  it("respecte take/skip explicites, plafonnés à 100 pour éviter une réponse non bornée (DAT, 1M factures/mois)", async () => {
    const prisma = createFakeScopedPrisma();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findAllByOrganization("org-1", { take: 500, skip: 20 });

    expect(prisma.__scoped.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, skip: 20 }),
    );
  });
});

describe("InvoicesService — snapshot costPriceAtTime à la création (E7, ADR-084)", () => {
  function createFakePrismaWithProducts(products: any[]) {
    // createDraft() passe par le client scopé : le faux doit porter $extends.
    const prisma: any = {
      invoice: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "inv-1", ...data })),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", regimeFiscal: "normal_tva" }),
      },
      product: {
        findMany: vi.fn().mockResolvedValue(products),
      },
      $extends: vi.fn(() => prisma),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    alignerFindFirst(prisma);
    return prisma;
  }

  it("snapshotte costPrice du produit référencé dans costPriceAtTime de la ligne", async () => {
    const prisma = createFakePrismaWithProducts([{ id: "product-1", organizationId: "org-1", costPrice: 15_000n }]);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 25_000n, productId: "product-1" }],
    } as any);

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["product-1"] }, organizationId: "org-1" },
    });
    const createCall = (prisma.invoice.create as any).mock.calls[0][0];
    expect(createCall.data.lines.create[0]).toMatchObject({ productId: "product-1", costPriceAtTime: 15_000n });
  });

  it("laisse costPriceAtTime undefined pour une ligne sans productId, jamais une requête product", async () => {
    const prisma = createFakePrismaWithProducts([]);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 25_000n }],
    } as any);

    expect(prisma.product.findMany).not.toHaveBeenCalled();
    const createCall = (prisma.invoice.create as any).mock.calls[0][0];
    expect(createCall.data.lines.create[0].costPriceAtTime).toBeUndefined();
    expect(createCall.data.lines.create[0].productId).toBeUndefined();
  });

  it("ne fabrique jamais costPriceAtTime=0 quand Product.costPrice est null (E6, jamais renseigné)", async () => {
    const prisma = createFakePrismaWithProducts([{ id: "product-1", organizationId: "org-1", costPrice: null }]);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 25_000n, productId: "product-1" }],
    } as any);

    const createCall = (prisma.invoice.create as any).mock.calls[0][0];
    expect(createCall.data.lines.create[0].costPriceAtTime).toBeNull();
  });

  it("rejette un productId appartenant à une AUTRE organisation (IDOR)", async () => {
    const prisma = createFakePrismaWithProducts([]);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(
      service.createDraft({
        organizationId: "org-1",
        documentType: "invoice",
        lines: [{ description: "Sac de riz 50kg", quantity: 1, unitPrice: 25_000n, productId: "product-victime" }],
      } as any),
    ).rejects.toThrow(/introuvable pour cette organisation/);
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("résout tous les produits en un seul findMany batché, même avec plusieurs lignes", async () => {
    const prisma = createFakePrismaWithProducts([
      { id: "product-1", organizationId: "org-1", costPrice: 10_000n },
      { id: "product-2", organizationId: "org-1", costPrice: 20_000n },
    ]);
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [
        { description: "Sac de riz 50kg", quantity: 1, unitPrice: 25_000n, productId: "product-1" },
        { description: "Huile 5L", quantity: 1, unitPrice: 45_000n, productId: "product-2" },
      ],
    } as any);

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    const createCall = (prisma.invoice.create as any).mock.calls[0][0];
    expect(createCall.data.lines.create[0].costPriceAtTime).toBe(10_000n);
    expect(createCall.data.lines.create[1].costPriceAtTime).toBe(20_000n);
  });
});

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function createFakePrismaForSendReminder(invoice: any) {
  const prisma: any = {
    invoice: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(invoice),
    },
    invoiceEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "event-1", ...data })),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
    // organizationScopedClient() appelle $extends ; setOrganizationScope()
    // appelle $executeRaw dans la transaction. Le vrai client porte les deux.
    $extends: vi.fn(() => prisma),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  // Les méthodes migrées RLS appellent findFirstOrThrow (where à deux champs,
  // donc plus de clé unique). Les faux ne déclarent que findUniqueOrThrow : on
  // adosse l'un à l'autre, les deux désignant la même lecture.
  alignerFindFirst(prisma);
  return prisma;
}

function createFakePaymentReminderService() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

const OVERDUE_INVOICE_BASE = {
  id: "inv-1",
  organizationId: "org-1",
  number: "FG-2026-000001",
  status: "issued",
  issuedAt: daysAgo(31),
  amountDue: 150_000n,
  customerId: "cust-1",
  customer: { id: "cust-1", phone: "+224622334455", notificationChannel: "sms" },
  organization: { preferredLanguage: "fr" },
};

describe("InvoicesService — rappel de paiement après échéance (I2)", () => {
  it("envoie le rappel et émet payment_reminder_sent tracé à l'auteur de la demande", async () => {
    const prisma = createFakePrismaForSendReminder(OVERDUE_INVOICE_BASE);
    const reminderService = createFakePaymentReminderService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
      undefined,
      reminderService as any,
    );

    await service.sendReminder("inv-1", "user-djenabou", "org-1");

    expect(reminderService.send).toHaveBeenCalledWith(
      { phone: "+224622334455", notificationChannel: "sms" },
      "FG-2026-000001",
      1_500n,
      "fr",
    );
  });

  it("passe la langue de l'organisation émettrice au rappel (i18n)", async () => {
    const prisma = createFakePrismaForSendReminder({
      ...OVERDUE_INVOICE_BASE,
      organization: { preferredLanguage: "pular" },
    });
    const reminderService = createFakePaymentReminderService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
      undefined,
      reminderService as any,
    );

    await service.sendReminder("inv-1", "user-djenabou", "org-1");

    expect(reminderService.send).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), "pular");
    expect(prisma.invoiceEvent.create).toHaveBeenCalledWith({
      data: { invoiceId: "inv-1", type: "payment_reminder_sent", actorId: "user-djenabou" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("rejette (ConflictException) une facture pas encore en retard", async () => {
    const prisma = createFakePrismaForSendReminder({ ...OVERDUE_INVOICE_BASE, issuedAt: daysAgo(5) });
    const reminderService = createFakePaymentReminderService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
      undefined,
      reminderService as any,
    );

    await expect(service.sendReminder("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
    expect(reminderService.send).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) une facture draft/paid/voided même émise il y a longtemps", async () => {
    const prisma = createFakePrismaForSendReminder({ ...OVERDUE_INVOICE_BASE, status: "paid" });
    const reminderService = createFakePaymentReminderService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
      undefined,
      reminderService as any,
    );

    await expect(service.sendReminder("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
  });

  it("rejette (ConflictException) une facture sans client associé", async () => {
    const prisma = createFakePrismaForSendReminder({ ...OVERDUE_INVOICE_BASE, customerId: null, customer: null });
    const reminderService = createFakePaymentReminderService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
      undefined,
      reminderService as any,
    );

    await expect(service.sendReminder("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
    expect(reminderService.send).not.toHaveBeenCalled();
  });

  it("rejette (ConflictException) un client sans téléphone renseigné", async () => {
    const prisma = createFakePrismaForSendReminder({
      ...OVERDUE_INVOICE_BASE,
      customer: { id: "cust-1", phone: null, notificationChannel: "sms" },
    });
    const reminderService = createFakePaymentReminderService();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
      undefined,
      reminderService as any,
    );

    await expect(service.sendReminder("inv-1", "user-djenabou", "org-1")).rejects.toThrow(ConflictException);
    expect(reminderService.send).not.toHaveBeenCalled();
  });
});

describe("InvoicesService — canal d'émission (Lot D)", () => {
  it("createDraft sans 2e argument estampille la facture 'pwa' (défaut serveur, jamais un champ client)", async () => {
    const prisma = createFakePrismaForCreateDraft("tpu");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Vente comptoir", quantity: 1, unitPrice: 100_000n }],
    } as any);

    expect(result.emissionChannel).toBe("pwa");
  });

  it("createDraft propage le canal passé en 2e argument (ex. 'ussd')", async () => {
    const prisma = createFakePrismaForCreateDraft("tpu");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createDraft(
      {
        organizationId: "org-1",
        documentType: "invoice",
        lines: [{ description: "Vente USSD", quantity: 1, unitPrice: 100_000n }],
      } as any,
      "ussd",
    );

    expect(result.emissionChannel).toBe("ussd");
  });

  it("createAssisted estampille la facture émise 'agent_terrain'", async () => {
    const prisma = createFakePrismaForCreateAssisted();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.createAssisted(assistedInvoiceDto as any, "agent-1");

    expect(result.emissionChannel).toBe("agent_terrain");
  });

  it("findAllByOrganization filtre par emissionChannel quand il est fourni", async () => {
    const prisma = createFakeScopedPrisma();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findAllByOrganization("org-1", { emissionChannel: "ussd" });

    expect(prisma.__scoped.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", emissionChannel: "ussd" } }),
    );
  });

  it("findAllByOrganization n'ajoute pas de clé emissionChannel au where quand le filtre est absent", async () => {
    const prisma = createFakeScopedPrisma();
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.findAllByOrganization("org-1", {});

    expect(prisma.__scoped.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1" } }),
    );
  });
});

describe("InvoicesService — champs EN 16931 / B2G (Lot C)", () => {
  it("persiste cadreFacturation, numeroBonCommande, numeroContrat, numeroEngagement et le productCode de ligne", async () => {
    const prisma = createFakePrismaForCreateDraft("tpu");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      cadreFacturation: "marche_public",
      numeroBonCommande: "BC-MEF-2026-0042",
      numeroContrat: "CT-2026-118",
      numeroEngagement: "ENG-2026-00931",
      lines: [{ description: "Fourniture ordinateurs", quantity: 10, unitPrice: 4_500_000n, productCode: "CPV-30213000" }],
    } as any);

    const createCall = (prisma.invoice.create as any).mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      cadreFacturation: "marche_public",
      numeroBonCommande: "BC-MEF-2026-0042",
      numeroContrat: "CT-2026-118",
      numeroEngagement: "ENG-2026-00931",
    });
    expect(createCall.data.lines.create[0]).toMatchObject({ productCode: "CPV-30213000" });
  });

  it("par défaut : cadreFacturation 'standard', références et productCode undefined", async () => {
    const prisma = createFakePrismaForCreateDraft("tpu");
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await service.createDraft({
      organizationId: "org-1",
      documentType: "invoice",
      lines: [{ description: "Vente comptoir", quantity: 1, unitPrice: 100_000n }],
    } as any);

    const createCall = (prisma.invoice.create as any).mock.calls[0][0];
    expect(createCall.data.cadreFacturation).toBe("standard");
    expect(createCall.data.numeroBonCommande).toBeUndefined();
    expect(createCall.data.numeroContrat).toBeUndefined();
    expect(createCall.data.numeroEngagement).toBeUndefined();
    expect(createCall.data.lines.create[0].productCode).toBeUndefined();
  });
});

describe("InvoicesService.issue — garde d'exercice clos (Lot B, ADR-110)", () => {
  it("refuse d'émettre si l'exercice de l'année courante est clos", async () => {
    const currentYear = new Date().getUTCFullYear();
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", documentType: "invoice", organizationId: "org-1", totalTtc: 100_000n }) },
      fiscalPeriodClosing: { id: "fpc-1", year: currentYear, closedAt: new Date(`${currentYear}-02-01T00:00:00Z`) },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    await expect(service.issue("inv-1", "org-1")).rejects.toThrow(/exercice/i);
    expect(prisma.fiscalPeriodClosing.findUnique).toHaveBeenCalledWith({
      where: { organizationId_year: { organizationId: "org-1", year: currentYear } },
    });
  });

  it("émet normalement quand aucun exercice n'est clos (non-régression)", async () => {
    const prisma = createFakePrisma({
      invoice: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "inv-1", status: "draft", documentType: "invoice", organizationId: "org-1", totalTtc: 100_000n }) },
    });
    const service = new InvoicesService(
      prisma as any,
      createFakeNumbering() as any,
      createFakeSigningKeyService() as any,
      createFakePaymentLinkClient() as any,
    );

    const result = await service.issue("inv-1", "org-1");
    expect(result.status).toBe("issued");
  });
});
