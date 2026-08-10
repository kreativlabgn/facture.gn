import { describe, expect, it, vi } from "vitest";
import { OrganizationsService } from "./organizations.service";

// A3 — partagé par tous les tests de ce fichier (règle des 3, même discipline
// que les autres helpers de fixture) : les 3 chemins de création provisionnent
// une clé racine, mais la plupart des tests existants ne portent pas sur CE
// comportement — un double par défaut minimal suffit.
function createFakeSigningKeyService() {
  return { provisionRootKey: vi.fn().mockResolvedValue({ id: "signing-key-1", publicKey: "pubkey-hex" }) };
}

function createFakePrisma(createImpl?: ReturnType<typeof vi.fn>) {
  const prisma: any = {
    organization: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "org-1" }),
    },
    organizationMember: {
      create: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

describe("OrganizationsService", () => {
  it("persiste le régime fiscal fourni par le client, jamais un défaut serveur", async () => {
    const prisma = createFakePrisma();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.create(
      { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
      "user-1",
    );

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ regimeFiscal: "tpu" }),
    });
  });

  it("crée automatiquement le créateur comme owner de la nouvelle organisation", async () => {
    const prisma = createFakePrisma();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.create(
      { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
      "user-1",
    );

    expect(prisma.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "user-1", role: "owner" },
    });
  });

  it("traduit une violation de contrainte unique sur le NIF en erreur explicite", async () => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["nif"] },
    });
    const prisma = createFakePrisma(vi.fn().mockRejectedValue(uniqueViolation));
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await expect(
      service.create(
        { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
        "user-1",
      ),
    ).rejects.toThrow(/NIF/);
  });

  it("crée une organisation sans NIF ni eTax — inscription self-service jamais bloquée (B1/B4)", async () => {
    const prisma = createFakePrisma();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.create({ name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial" }, "user-1");

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nif: undefined, etaxNumber: undefined }),
    });
  });

  it("provisionne une clé racine Ed25519 pour la nouvelle organisation, dans la même transaction (A3, ADR-026)", async () => {
    const prisma = createFakePrisma();
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any);

    await service.create(
      { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
      "user-1",
    );

    expect(signingKeyService.provisionRootKey).toHaveBeenCalledWith("org-1", expect.anything());
  });
});

function createFakePrismaForVerifyDgi(organization: any) {
  return {
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(organization),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...organization, ...data })),
    },
  };
}

describe("OrganizationsService — vérification DGI (B2)", () => {
  it("refuse de vérifier une organisation qui n'a jamais fourni NIF ni eTax — ADR-035, jamais un 500 brut", async () => {
    const prisma = createFakePrismaForVerifyDgi({
      id: "org-1",
      nif: null,
      etaxNumber: null,
      dgiVerificationStatus: "unverified",
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await expect(service.verifyDgi("org-1")).rejects.toThrow(/NIF/);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("passe une organisation avec NIF+eTax de unverified à verified", async () => {
    const prisma = createFakePrismaForVerifyDgi({
      id: "org-1",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
      dgiVerificationStatus: "unverified",
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.verifyDgi("org-1");

    expect(result.dgiVerificationStatus).toBe("verified");
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { dgiVerificationStatus: "verified" },
    });
  });

  it("est idempotent sur une organisation déjà vérifiée — un second appel ne casse rien", async () => {
    const prisma = createFakePrismaForVerifyDgi({
      id: "org-1",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
      dgiVerificationStatus: "verified",
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.verifyDgi("org-1");

    expect(result.dgiVerificationStatus).toBe("verified");
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

function createFakePrismaForAssisted(overrides?: { isFieldAgent?: boolean; accountCodeCollisions?: number }) {
  let organizationCreateCalls = 0;
  const collisions = overrides?.accountCodeCollisions ?? 0;

  const prisma: any = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "agent-1", isFieldAgent: overrides?.isFieldAgent ?? true }),
      create: vi.fn().mockResolvedValue({ id: "merchant-1" }),
    },
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "phone-1" }),
    },
    organization: {
      create: vi.fn().mockImplementation(() => {
        organizationCreateCalls++;
        if (organizationCreateCalls <= collisions) {
          return Promise.reject(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["account_code"] } }),
          );
        }
        return Promise.resolve({ id: "org-1" });
      }),
    },
    organizationMember: {
      create: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    assistedSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

const ASSISTED_DTO = {
  organizationName: "Boutique Djénabou",
  regimeFiscal: "tpu" as const,
  legalForm: "commercial" as const,
  merchantName: "Djénabou Diallo",
  consentRecorded: true as const,
};

describe("OrganizationsService.createAssisted (B5, ADR-045/046/047)", () => {
  it("refuse si l'appelant n'a pas le statut agent terrain (isFieldAgent=false)", async () => {
    const prisma = createFakePrismaForAssisted({ isFieldAgent: false });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await expect(service.createAssisted("agent-1", ASSISTED_DTO)).rejects.toThrow(/agent terrain/);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("crée le marchand comme owner — jamais de membership pour l'agent terrain lui-même", async () => {
    const prisma = createFakePrismaForAssisted();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(prisma.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "merchant-1", role: "owner" },
    });
    expect(prisma.organizationMember.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "agent-1" }) }),
    );
  });

  it("enregistre une AssistedSession traçant l'agent, l'organisation et le consentement horodaté", async () => {
    const prisma = createFakePrismaForAssisted();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(prisma.assistedSession.create).toHaveBeenCalledWith({
      data: {
        fieldAgentUserId: "agent-1",
        organizationId: "org-1",
        consentRecordedAt: expect.any(Date),
      },
    });
  });

  it("réessaie la génération du code-compte jusqu'à 3 tentatives en cas de collision", async () => {
    const prisma = createFakePrismaForAssisted({ accountCodeCollisions: 2 });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(result).toEqual({ id: "org-1" });
    expect(prisma.organization.create).toHaveBeenCalledTimes(3);
  });

  it("provisionne une clé racine pour l'organisation créée en inscription assistée (A3, ADR-026)", async () => {
    const prisma = createFakePrismaForAssisted();
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(signingKeyService.provisionRootKey).toHaveBeenCalledWith("org-1", expect.anything());
  });
});

function createFakePrismaForVerifiedPaymentRatio(totalSum: bigint | null, verifiedSum: bigint | null) {
  return {
    payment: {
      // aggregate() appelé deux fois : une fois sans filtre method (total), une fois
      // avec method:"payment_link" (vérifié) — on distingue via la présence du filtre.
      aggregate: vi.fn(({ where }: any) =>
        Promise.resolve({ _sum: { amount: where.method ? verifiedSum : totalSum } }),
      ),
    },
  };
}

describe("OrganizationsService.getVerifiedPaymentRatio (E8, ADR-093)", () => {
  it("calcule le ratio paiements vérifiés / total des encaissements", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(500_000n, 300_000n);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.getVerifiedPaymentRatio("org-1");

    expect(result).toEqual({ totalAmount: 500_000n, verifiedAmount: 300_000n, ratio: 0.6 });
  });

  it("renvoie ratio:null pour une organisation sans aucun paiement — jamais un faux 0%", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(null, null);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.getVerifiedPaymentRatio("org-1");

    expect(result).toEqual({ totalAmount: 0n, verifiedAmount: 0n, ratio: null });
  });

  it("renvoie ratio:1 quand 100% des encaissements sont réglés par lien de paiement", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(400_000n, 400_000n);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.getVerifiedPaymentRatio("org-1");

    expect(result.ratio).toBe(1);
  });

  it("exclut toujours les arrhes des deux totaux — bucket financier distinct (C5)", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(500_000n, 300_000n);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.getVerifiedPaymentRatio("org-1");

    expect(prisma.payment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ depositType: null }) }),
    );
  });
});

const APIP_DTO = {
  name: "Boutique Kaloum SARL",
  regimeFiscal: "normal_tva" as const,
  legalForm: "commercial" as const,
  nif: "GN99887766",
  rccm: "GC-KAL-2026-A-001",
};

function createFakePrismaForCreateFromApip(createImpl?: ReturnType<typeof vi.fn>) {
  const prisma: any = {
    organization: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "org-1", ...APIP_DTO, registrationSource: "apip" }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", ...APIP_DTO, registrationSource: "apip" }),
    },
    // A3 — atomicité création+provisionnement, même précédent que create()/
    // createAssisted() : jamais une organisation sans clé.
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

describe("OrganizationsService — création depuis webhook APIP (F11, ADR-077)", () => {
  it("crée l'organisation avec registrationSource apip, aucun OrganizationMember", async () => {
    const prisma = createFakePrismaForCreateFromApip();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await service.createFromApip(APIP_DTO);

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: APIP_DTO.name,
        regimeFiscal: APIP_DTO.regimeFiscal,
        legalForm: APIP_DTO.legalForm,
        nif: APIP_DTO.nif,
        rccm: APIP_DTO.rccm,
        registrationSource: "apip",
      }),
    });
    expect(prisma.organizationMember).toBeUndefined();
  });

  it("idempotent : une redélivraison webhook (même NIF) retourne l'organisation existante, jamais une erreur", async () => {
    const createImpl = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["nif"] },
    });
    const prisma = createFakePrismaForCreateFromApip(createImpl);

    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    const result = await service.createFromApip(APIP_DTO);

    expect(prisma.organization.findUniqueOrThrow).toHaveBeenCalledWith({ where: { nif: APIP_DTO.nif } });
    expect(result.id).toBe("org-1");
  });

  it("propage toute autre erreur inattendue (pas une collision NIF)", async () => {
    const createImpl = vi.fn().mockRejectedValue(new Error("panne DB inattendue"));
    const prisma = createFakePrismaForCreateFromApip(createImpl);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any);

    await expect(service.createFromApip(APIP_DTO)).rejects.toThrow(/panne DB inattendue/);
  });

  it("provisionne une clé racine pour une création fraîche (A3, ADR-026)", async () => {
    const prisma = createFakePrismaForCreateFromApip();
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any);

    await service.createFromApip(APIP_DTO);

    expect(signingKeyService.provisionRootKey).toHaveBeenCalledWith("org-1", expect.anything());
  });

  it("ne provisionne JAMAIS de 2e clé sur une redélivraison idempotente — violerait la contrainte @unique", async () => {
    const createImpl = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["nif"] },
    });
    const prisma = createFakePrismaForCreateFromApip(createImpl);
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any);

    await service.createFromApip(APIP_DTO);

    expect(signingKeyService.provisionRootKey).not.toHaveBeenCalled();
  });
});
