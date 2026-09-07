import { ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

// organizationScopedClient() appelle `$extends` sur le client. Le vrai client
// l'offre ; un faux qui ne l'offre pas ne teste pas le service migré, il plante
// dessus. `$extends` rend ici le client LUI-MÊME, pour que les mocks de modèle
// restent partagés et les assertions existantes sur les arguments inchangées.
// (La pose effective du set_config est couverte par packages/db rls.spec.ts.)
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}
import { OrganizationsService } from "./organizations.service";

// A3 — partagé par tous les tests de ce fichier (règle des 3, même discipline
// que les autres helpers de fixture) : les 3 chemins de création provisionnent
// une clé racine, mais la plupart des tests existants ne portent pas sur CE
// comportement — un double par défaut minimal suffit.
function createFakeSigningKeyService() {
  return {
    provisionRootKey: vi.fn().mockResolvedValue({ id: "signing-key-1", publicKey: "pubkey-hex" }),
    revoke: vi.fn().mockResolvedValue({ id: "signing-key-1", revokedAt: new Date() }),
    rotate: vi.fn().mockResolvedValue({ id: "signing-key-2", publicKey: "pubkey-hex-2" }),
    getKeyStatus: vi.fn().mockResolvedValue({ active: true, rotationDue: false }),
  };
}

// F10 — double par défaut minimal, même discipline que createFakeSigningKeyService()
// ci-dessus : la plupart des tests existants de ce fichier ne portent pas sur la
// résolution de PendingMemberInvite.
function createFakePendingMemberInviteService() {
  return {
    resolveForNewUser: vi.fn().mockResolvedValue(undefined),
  };
}

function createFakePrisma(createImpl?: ReturnType<typeof vi.fn>) {
  const prisma: any = auClientScope({
    organization: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "org-1" }),
    },
    organizationMember: {
      create: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  });
  return prisma;
}

describe("OrganizationsService", () => {
  it("persiste le régime fiscal fourni par le client, jamais un défaut serveur", async () => {
    const prisma = createFakePrisma();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

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
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

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
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.create(
        { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
        "user-1",
      ),
    ).rejects.toThrow(/NIF/);
  });

  // rccm et etax_number ne sont uniques que depuis 20260907040000. Avant le
  // balayage de collisionIdentifiantEtat(), seul le NIF rendait un 409 : les
  // deux autres remontaient le P2002 brut, donc un 500 (aucun ExceptionFilter
  // au-dessus de ce service).
  it.each([
    ["rccm", /RCCM/],
    ["etax_number", /eTax/],
  ])("traduit une collision sur %s en 409 explicite, jamais un 500", async (colonne, motif) => {
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: [colonne] },
    });
    const prisma = createFakePrisma(vi.fn().mockRejectedValue(uniqueViolation));
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const promesse = service.create(
      { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
      "user-1",
    );
    await expect(promesse).rejects.toThrow(ConflictException);
    await expect(promesse).rejects.toThrow(motif);
  });

  it("crée une organisation sans NIF ni eTax — inscription self-service jamais bloquée (B1/B4)", async () => {
    const prisma = createFakePrisma();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.create({ name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial" }, "user-1");

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nif: undefined, etaxNumber: undefined }),
    });
  });

  it("provisionne une clé racine Ed25519 pour la nouvelle organisation, dans la même transaction (A3, ADR-026)", async () => {
    const prisma = createFakePrisma();
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any, createFakePendingMemberInviteService() as any);

    await service.create(
      { name: "Boutique Aissatou", regimeFiscal: "tpu", legalForm: "commercial", nif: "GN12345678" },
      "user-1",
    );

    expect(signingKeyService.provisionRootKey).toHaveBeenCalledWith("org-1", expect.anything());
  });
});

function createFakePrismaForVerifyDgi(organization: any) {
  return auClientScope({
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(organization),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...organization, ...data })),
    },
  });
}

describe("OrganizationsService — vérification DGI (B2)", () => {
  it("refuse de vérifier une organisation qui n'a jamais fourni NIF ni eTax — ADR-035, jamais un 500 brut", async () => {
    const prisma = createFakePrismaForVerifyDgi({
      id: "org-1",
      nif: null,
      etaxNumber: null,
      dgiVerificationStatus: "unverified",
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

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
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const before = Date.now();
    const result = await service.verifyDgi("org-1");

    expect(result.dgiVerificationStatus).toBe("verified");
    const call = prisma.organization.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "org-1" });
    expect(call.data.dgiVerificationStatus).toBe("verified");
    // D4, §4 Spec USSD — nécessaire pour "T1+90j" (velocity_tier).
    expect(call.data.dgiVerifiedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("est idempotent sur une organisation déjà vérifiée — un second appel ne casse rien", async () => {
    const prisma = createFakePrismaForVerifyDgi({
      id: "org-1",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
      dgiVerificationStatus: "verified",
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.verifyDgi("org-1");

    expect(result.dgiVerificationStatus).toBe("verified");
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

function createFakePrismaForAssisted(overrides?: { isCommercialAgent?: boolean; accountCodeCollisions?: number }) {
  let organizationCreateCalls = 0;
  const collisions = overrides?.accountCodeCollisions ?? 0;

  const prisma: any = auClientScope({
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "agent-1", isCommercialAgent: overrides?.isCommercialAgent ?? true }),
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
  });
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
  it("refuse si l'appelant n'a pas le statut agent terrain (isCommercialAgent=false)", async () => {
    const prisma = createFakePrismaForAssisted({ isCommercialAgent: false });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(service.createAssisted("agent-1", ASSISTED_DTO)).rejects.toThrow(/agent terrain/);
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("crée le marchand comme owner — jamais de membership pour l'agent terrain lui-même", async () => {
    const prisma = createFakePrismaForAssisted();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(prisma.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "merchant-1", role: "owner" },
    });
    expect(prisma.organizationMember.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "agent-1" }) }),
    );
  });

  it("F10 — résout toute PendingMemberInvite en attente pour le msisdn du marchand, dans la même transaction", async () => {
    const prisma = createFakePrismaForAssisted();
    const pendingMemberInvite = createFakePendingMemberInviteService();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, pendingMemberInvite as any);

    await service.createAssisted("agent-1", { ...ASSISTED_DTO, msisdn: "+224600000001" });

    expect(pendingMemberInvite.resolveForNewUser).toHaveBeenCalledWith(prisma, "merchant-1", "+224600000001");
  });

  it("F10 — ne tente aucune résolution si le marchand n'a pas de msisdn (inscription assistée sans téléphone)", async () => {
    const prisma = createFakePrismaForAssisted();
    const pendingMemberInvite = createFakePendingMemberInviteService();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, pendingMemberInvite as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(pendingMemberInvite.resolveForNewUser).not.toHaveBeenCalled();
  });

  it("enregistre une AssistedSession traçant l'agent, l'organisation et le consentement horodaté", async () => {
    const prisma = createFakePrismaForAssisted();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(prisma.assistedSession.create).toHaveBeenCalledWith({
      data: {
        commercialAgentUserId: "agent-1",
        organizationId: "org-1",
        consentRecordedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      },
    });
  });

  it("réessaie la génération du code-compte jusqu'à 3 tentatives en cas de collision", async () => {
    const prisma = createFakePrismaForAssisted({ accountCodeCollisions: 2 });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(result).toEqual({ id: "org-1" });
    expect(prisma.organization.create).toHaveBeenCalledTimes(3);
  });

  // Le code-compte est tiré au hasard par la plateforme : sa collision se
  // réessaie. Un identifiant d'État est saisi par l'agent : le réessayer
  // produirait la même collision indéfiniment. Il doit donc sortir de la
  // boucle en 409 — et non remonter en 500, ce qu'il faisait jusqu'ici Y
  // COMPRIS pour le NIF, pourtant unique bien avant ce chantier.
  it.each([
    ["nif", /NIF/],
    ["etax_number", /eTax/],
  ])("collision sur %s : 409 immédiat, sans réessai (contrairement au code-compte)", async (colonne, motif) => {
    const prisma = createFakePrismaForAssisted();
    prisma.organization.create = vi.fn().mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: [colonne] } }),
    );
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const promesse = service.createAssisted("agent-1", ASSISTED_DTO);
    await expect(promesse).rejects.toThrow(ConflictException);
    await expect(promesse).rejects.toThrow(motif);
    // Une seule tentative par appel : réessayer serait une boucle stérile.
    expect(prisma.organization.create).toHaveBeenCalledTimes(1);
  });

  // ADR-107 — avant ce correctif, registrationSource retombait silencieusement sur
  // le défaut "organic" du schema : une organisation créée par l'Agent commercial
  // terrain était mal étiquetée dans les données, sans qu'aucun test ne le détecte.
  it("marque l'organisation registrationSource=agent_terrain (ADR-107)", async () => {
    const prisma = createFakePrismaForAssisted();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(prisma.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ registrationSource: "agent_terrain" }),
    });
  });

  it("provisionne une clé racine pour l'organisation créée en inscription assistée (A3, ADR-026)", async () => {
    const prisma = createFakePrismaForAssisted();
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any, createFakePendingMemberInviteService() as any);

    await service.createAssisted("agent-1", ASSISTED_DTO);

    expect(signingKeyService.provisionRootKey).toHaveBeenCalledWith("org-1", expect.anything());
  });
});

describe("OrganizationsService.revokeAssistedSession (Security Audit 2026-08-23, finding #8)", () => {
  it("révoque l'AssistedSession active entre l'agent et l'organisation", async () => {
    const prisma: any = auClientScope({
      assistedSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    const service = new OrganizationsService(prisma, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.revokeAssistedSession("org-1", "agent-1");

    expect(prisma.assistedSession.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", commercialAgentUserId: "agent-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("échoue proprement si aucune AssistedSession active ne correspond (déjà révoquée ou jamais existante)", async () => {
    const prisma: any = auClientScope({
      assistedSession: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    const service = new OrganizationsService(prisma, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(service.revokeAssistedSession("org-1", "agent-1")).rejects.toThrow(/Aucune AssistedSession/);
  });
});

function createFakePrismaForVerifiedPaymentRatio(totalSum: bigint | null, verifiedSum: bigint | null) {
  return auClientScope({
    payment: {
      // aggregate() appelé deux fois : une fois sans filtre method (total), une fois
      // avec method:"payment_link" (vérifié) — on distingue via la présence du filtre.
      aggregate: vi.fn(({ where }: any) =>
        Promise.resolve({ _sum: { amount: where.method ? verifiedSum : totalSum } }),
      ),
    },
  });
}

describe("OrganizationsService.getVerifiedPaymentRatio (E8, ADR-093)", () => {
  it("calcule le ratio paiements vérifiés / total des encaissements", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(500_000n, 300_000n);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.getVerifiedPaymentRatio("org-1");

    expect(result).toEqual({ totalAmount: 500_000n, verifiedAmount: 300_000n, ratio: 0.6 });
  });

  it("renvoie ratio:null pour une organisation sans aucun paiement — jamais un faux 0%", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(null, null);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.getVerifiedPaymentRatio("org-1");

    expect(result).toEqual({ totalAmount: 0n, verifiedAmount: 0n, ratio: null });
  });

  it("renvoie ratio:1 quand 100% des encaissements sont réglés par lien de paiement", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(400_000n, 400_000n);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.getVerifiedPaymentRatio("org-1");

    expect(result.ratio).toBe(1);
  });

  it("exclut toujours les arrhes des deux totaux — bucket financier distinct (C5)", async () => {
    const prisma = createFakePrismaForVerifiedPaymentRatio(500_000n, 300_000n);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

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

// `existantes` décrit ce que la plateforme contient DÉJÀ, par clé naturelle.
// Un faux qui rendrait la même organisation pour n'importe quel `where` ne
// saurait pas distinguer « redélivrance sur le NIF » de « redélivrance sur le
// RCCM » ni détecter un payload contradictoire — soit les trois cas que
// createFromApip() traite désormais différemment.
function createFakePrismaForCreateFromApip(
  createImpl?: ReturnType<typeof vi.fn>,
  existantes: { parNif?: unknown; parRccm?: unknown } = {
    parNif: { id: "org-1", ...APIP_DTO, registrationSource: "apip" },
    parRccm: { id: "org-1", ...APIP_DTO, registrationSource: "apip" },
  },
) {
  const prisma: any = auClientScope({
    organization: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "org-1", ...APIP_DTO, registrationSource: "apip" }),
      findUnique: vi.fn(async ({ where }: any) =>
        (where.nif !== undefined ? existantes.parNif : existantes.parRccm) ?? null,
      ),
    },
    // A3 — atomicité création+provisionnement, même précédent que create()/
    // createAssisted() : jamais une organisation sans clé.
    $transaction: vi.fn((callback: any) => callback(prisma)),
  });
  return prisma;
}

describe("OrganizationsService — création depuis webhook APIP (F11, ADR-077)", () => {
  it("crée l'organisation avec registrationSource apip, aucun OrganizationMember", async () => {
    const prisma = createFakePrismaForCreateFromApip();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

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

    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.createFromApip(APIP_DTO);

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { nif: APIP_DTO.nif } });
    expect(result.id).toBe("org-1");
  });

  // Le RCCM est immuable là où le NIF peut être corrigé par le guichet : une
  // redélivrance dont seul le RCCM percute la contrainte est tout aussi
  // légitime. Avant l'ajout de l'index unique sur rccm elle n'existait pas ;
  // depuis, ne pas la traiter la ferait remonter en 500.
  it("idempotent : une redélivraison qui ne percute QUE le RCCM retourne l'organisation existante", async () => {
    const createImpl = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["rccm"] } });
    const prisma = createFakePrismaForCreateFromApip(createImpl, {
      parNif: null,
      parRccm: { id: "org-1", ...APIP_DTO, registrationSource: "apip" },
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.createFromApip(APIP_DTO);

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { rccm: APIP_DTO.rccm } });
    expect(result.id).toBe("org-1");
  });

  // Le cas dangereux : rendre l'une des deux au hasard rattacherait les futures
  // factures à la mauvaise entreprise, sans retour possible une fois la chaîne
  // de certification entamée.
  it("payload contradictoire (NIF et RCCM sur deux organisations distinctes) : 409, jamais un choix arbitraire", async () => {
    const createImpl = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["nif"] } });
    const prisma = createFakePrismaForCreateFromApip(createImpl, {
      parNif: { id: "org-nif", ...APIP_DTO },
      parRccm: { id: "org-rccm", ...APIP_DTO },
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(service.createFromApip(APIP_DTO)).rejects.toThrow(ConflictException);
  });

  // Course : la ligne percutée a disparu entre le create() et la relecture.
  // Maquiller ça en succès rendrait une réponse vide au partenaire.
  it("organisation disparue entre la collision et la relecture : propage l'erreur d'origine", async () => {
    const createImpl = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["nif"] } });
    const prisma = createFakePrismaForCreateFromApip(createImpl, { parNif: null, parRccm: null });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(service.createFromApip(APIP_DTO)).rejects.toMatchObject({ code: "P2002" });
  });

  it("propage toute autre erreur inattendue (pas une collision NIF)", async () => {
    const createImpl = vi.fn().mockRejectedValue(new Error("panne DB inattendue"));
    const prisma = createFakePrismaForCreateFromApip(createImpl);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(service.createFromApip(APIP_DTO)).rejects.toThrow(/panne DB inattendue/);
  });

  it("provisionne une clé racine pour une création fraîche (A3, ADR-026)", async () => {
    const prisma = createFakePrismaForCreateFromApip();
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma as any, signingKeyService as any, createFakePendingMemberInviteService() as any);

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
    const service = new OrganizationsService(prisma as any, signingKeyService as any, createFakePendingMemberInviteService() as any);

    await service.createFromApip(APIP_DTO);

    expect(signingKeyService.provisionRootKey).not.toHaveBeenCalled();
  });

  describe("listMine", () => {
    it("retourne les organisations dont l'utilisateur est membre actif, avec son rôle sur chacune", async () => {
      const prisma: any = auClientScope({
        organizationMember: {
          findMany: vi.fn().mockResolvedValue([
            { role: "owner", organization: { id: "org-1", name: "Boutique Aissatou" } },
            { role: "cashier", organization: { id: "org-2", name: "Restaurant Le Damier" } },
          ]),
        },
      });
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      const result = await service.listMine("user-1");

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1", revokedAt: null } }),
      );
      expect(result).toEqual([
        { id: "org-1", name: "Boutique Aissatou", role: "owner" },
        { id: "org-2", name: "Restaurant Le Damier", role: "cashier" },
      ]);
    });

    it("ne sélectionne jamais bankAccountDetails/chiffreAffairesBrutDeclare ni la config anti-fraude interne (Quality Audit 2026-08-23, finding #5)", async () => {
      const prisma: any = auClientScope({
        organizationMember: {
          findMany: vi.fn().mockResolvedValue([
            { role: "cashier", organization: { id: "org-1", name: "Boutique Aissatou" } },
          ]),
        },
      });
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      await service.listMine("user-1");

      const call = prisma.organizationMember.findMany.mock.calls[0][0];
      const orgSelect = call.select.organization.select;
      expect(orgSelect).not.toHaveProperty("bankAccountDetails");
      expect(orgSelect).not.toHaveProperty("chiffreAffairesBrutDeclare");
      expect(orgSelect).not.toHaveProperty("creditLimitApprovalThreshold");
      expect(orgSelect).not.toHaveProperty("commissionBypassLevel");
      expect(orgSelect).not.toHaveProperty("commissionBypassProofThresholdOverrideGnf");
    });

    it("la RÉPONSE réelle de listMine() ne contient jamais bankAccountDetails/chiffreAffairesBrutDeclare, pas seulement la requête (Quality Audit 2026-08-23, revue post-fix #5)", async () => {
      // Contrairement au test précédent (qui n'inspecte que l'argument select
      // passé au mock), celui-ci simule le comportement RÉEL de Prisma : le
      // mock ne renvoie que les champs listés dans select.organization.select,
      // à partir d'une fixture volontairement "complète" (avec les champs
      // sensibles). Si un futur refactor de listMine() élargissait le select
      // ou fusionnait une autre source après la requête, ce test échouerait —
      // contrairement à un test qui n'inspecte que l'argument de l'appel.
      const fullOrganizationRow = {
        id: "org-1",
        name: "Boutique Aissatou",
        bankAccountDetails: "GN00 0000 0000 0000 0000 00",
        chiffreAffairesBrutDeclare: 50_000_000n,
        creditLimitApprovalThreshold: 10_000_000n,
        commissionBypassLevel: "level_1_flagged",
        commissionBypassProofThresholdOverrideGnf: null,
      };
      const prisma: any = auClientScope({
        organizationMember: {
          findMany: vi.fn().mockImplementation(({ select }: any) => {
            const orgSelect = select.organization.select;
            const filteredOrganization = Object.fromEntries(
              Object.entries(fullOrganizationRow).filter(([key]) => orgSelect[key] === true),
            );
            return Promise.resolve([{ role: "cashier", organization: filteredOrganization }]);
          }),
        },
      });
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      const result = await service.listMine("user-1");

      expect(result[0]).not.toHaveProperty("bankAccountDetails");
      expect(result[0]).not.toHaveProperty("chiffreAffairesBrutDeclare");
      expect(result[0]).not.toHaveProperty("creditLimitApprovalThreshold");
      expect(result[0]).not.toHaveProperty("commissionBypassLevel");
      expect(result[0]).not.toHaveProperty("commissionBypassProofThresholdOverrideGnf");
      expect(result[0]).toMatchObject({ id: "org-1", name: "Boutique Aissatou", role: "cashier" });
    });

    it("ne retourne jamais un membership révoqué (filtré côté requête, pas côté application)", async () => {
      const prisma: any = auClientScope({ organizationMember: { findMany: vi.fn().mockResolvedValue([]) } });
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      const result = await service.listMine("user-1");

      expect(result).toEqual([]);
      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }),
      );
    });
  });

  describe("findOneDetail", () => {
    it("retourne l'organisation demandée par id", async () => {
      const prisma: any = auClientScope({
        organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Boutique Aissatou" }) },
      });
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      const result = await service.findOneDetail("org-1");

      expect(prisma.organization.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "org-1" } });
      expect(result).toEqual({ id: "org-1", name: "Boutique Aissatou" });
    });
  });

  describe("listAuditLog — journal d'audit en lecture seule (G4, ADR-097)", () => {
    function createFakePrismaForAuditLog() {
      return auClientScope({
        invoiceEvent: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      });
    }

    it("scope les événements aux factures de l'organisation demandée", async () => {
      const prisma = createFakePrismaForAuditLog();
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      await service.listAuditLog("org-1", {});

      expect(prisma.invoiceEvent.findMany).toHaveBeenCalledWith({
        where: { invoice: { organizationId: "org-1" } },
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      });
    });

    it("filtre sur les types de la catégorie paiement quand category=paiement", async () => {
      const prisma = createFakePrismaForAuditLog();
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      await service.listAuditLog("org-1", { category: "paiement" });

      const calledWhere = prisma.invoiceEvent.findMany.mock.calls[0][0].where;
      expect(calledWhere.type.in).toContain("payment_link_generated");
      expect(calledWhere.type.in).toContain("refund_issued");
      expect(calledWhere.type.in).not.toContain("invoice_voided");
    });

    it("filtre sur les types hors catégorie paiement quand category=facture", async () => {
      const prisma = createFakePrismaForAuditLog();
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      await service.listAuditLog("org-1", { category: "facture" });

      const calledWhere = prisma.invoiceEvent.findMany.mock.calls[0][0].where;
      expect(calledWhere.type.in).toContain("invoice_voided");
      expect(calledWhere.type.in).toContain("liquidation_validated");
      expect(calledWhere.type.in).not.toContain("payment_link_generated");
    });

    it("plafonne take à 100 quel que soit ce que le client demande", async () => {
      const prisma = createFakePrismaForAuditLog();
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      await service.listAuditLog("org-1", { take: 500 });

      expect(prisma.invoiceEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });

    it("respecte skip fourni par le client", async () => {
      const prisma = createFakePrismaForAuditLog();
      const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

      await service.listAuditLog("org-1", { skip: 20 });

      expect(prisma.invoiceEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20 }));
    });
  });
});

describe("OrganizationsService.inviteMember (F14, ADR-104)", () => {
  function createFakePrismaForInvite(
    opts: { userPhone?: any; existingMembership?: any; organization?: any; memberCount?: number } = {},
  ) {
    return auClientScope({
      userPhone: {
        // "userPhone" in opts, jamais ?? : le test "téléphone sans compte" passe
        // explicitement null, qu'un ?? traiterait à tort comme absent (null est
        // nullish) et retomberait sur le défaut.
        findUnique: vi.fn().mockResolvedValue("userPhone" in opts ? opts.userPhone : { userId: "user-invite-1" }),
      },
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue(opts.existingMembership ?? null),
        count: vi.fn().mockResolvedValue(opts.memberCount ?? 0),
        create: vi.fn().mockResolvedValue({
          id: "member-invite-1",
          organizationId: "org-1",
          userId: "user-invite-1",
          role: "tax_controller_readonly",
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(opts.organization ?? { id: "org-1", commercialTier: "pro" }),
      },
    });
  }

  it("crée un OrganizationMember tax_controller_readonly pour un utilisateur déjà inscrit", async () => {
    const prisma = createFakePrismaForInvite();
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.inviteMember("org-1", { msisdn: "+224612345678", role: "tax_controller_readonly" }, "user-owner-1");

    expect(prisma.userPhone.findUnique).toHaveBeenCalledWith({ where: { msisdn: "+224612345678" } });
    expect(prisma.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: "org-1", userId: "user-invite-1", role: "tax_controller_readonly" },
    });
    expect(result.role).toBe("tax_controller_readonly");
  });

  it("rejette un téléphone sans compte facture.gn associé", async () => {
    const prisma = createFakePrismaForInvite({ userPhone: null });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224699999999", role: "tax_controller_readonly" }, "user-owner-1"),
    ).rejects.toThrow(/introuvable/);
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it("rejette un utilisateur déjà membre actif de l'organisation", async () => {
    const prisma = createFakePrismaForInvite({
      existingMembership: { organizationId: "org-1", userId: "user-invite-1", role: "cashier", revokedAt: null },
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "tax_controller_readonly" }, "user-owner-1"),
    ).rejects.toThrow(/déjà membre/);
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it("rejette un utilisateur déjà membre même révoqué — pas de réactivation silencieuse", async () => {
    const prisma = createFakePrismaForInvite({
      existingMembership: {
        organizationId: "org-1",
        userId: "user-invite-1",
        role: "cashier",
        revokedAt: new Date(),
      },
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "tax_controller_readonly" }, "user-owner-1"),
    ).rejects.toThrow(/déjà membre/);
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it("convertit une violation de contrainte unique concurrente (P2002) en ConflictException lisible", async () => {
    const prisma = createFakePrismaForInvite();
    prisma.organizationMember.create = vi.fn().mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["organization_id", "user_id"] },
      }),
    );
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "tax_controller_readonly" }, "user-owner-1"),
    ).rejects.toThrow(/déjà membre/);
  });
});

describe("OrganizationsService.inviteMember — restriction admin/approver au owner (Security Audit 2026-08-23, finding #12)", () => {
  function createFakePrismaForInviteRestriction(requesterRole: string | null) {
    return auClientScope({
      userPhone: { findUnique: vi.fn().mockResolvedValue({ userId: "user-invite-1" }) },
      organizationMember: {
        // Distingue la vérification du DEMANDEUR (son propre membership, userId
        // variable selon le test) de celle de L'INVITÉ (toujours "user-invite-1",
        // doit rester null pour ne jamais déclencher le garde "déjà membre").
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          const { userId } = where;
          if (userId === "user-invite-1") {
            return Promise.resolve(null);
          }
          return Promise.resolve(requesterRole ? { organizationId: "org-1", role: requesterRole } : null);
        }),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: "member-invite-1",
          organizationId: "org-1",
          userId: "user-invite-1",
          role: "admin",
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", commercialTier: "enterprise" }),
      },
    });
  }

  it("refuse qu'un admin invite un pair admin", async () => {
    const prisma = createFakePrismaForInviteRestriction("admin");
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "admin" }, "user-admin-requester"),
    ).rejects.toThrow(/Seul le owner/);
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it("refuse qu'un admin invite un approver", async () => {
    const prisma = createFakePrismaForInviteRestriction("admin");
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "approver" }, "user-admin-requester"),
    ).rejects.toThrow(/Seul le owner/);
  });

  it("autorise le owner à inviter un admin", async () => {
    const prisma = createFakePrismaForInviteRestriction("owner");
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.inviteMember("org-1", { msisdn: "+224612345678", role: "admin" }, "user-owner-1");

    expect(result.role).toBe("admin");
  });

  it("n'applique jamais cette restriction aux rôles moindres — un admin peut toujours inviter un cashier", async () => {
    const prisma = createFakePrismaForInviteRestriction("admin");
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.inviteMember("org-1", { msisdn: "+224612345678", role: "cashier" }, "user-admin-requester");

    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", userId: "user-admin-requester" } }),
    );
  });
});

describe("OrganizationsService.inviteMember — palier commercial (H1, Grille §2)", () => {
  function createFakePrismaForInvite(
    opts: { organization?: any; memberCount?: number } = {},
  ) {
    return auClientScope({
      userPhone: {
        findUnique: vi.fn().mockResolvedValue({ userId: "user-invite-1" }),
      },
      organizationMember: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(opts.memberCount ?? 0),
        create: vi.fn().mockResolvedValue({
          id: "member-invite-1",
          organizationId: "org-1",
          userId: "user-invite-1",
          role: "inventory_manager",
        }),
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(opts.organization ?? { id: "org-1", commercialTier: "pro" }),
      },
    });
  }

  it("refuse d'assigner inventory_manager en Freemium (nécessite Starter+)", async () => {
    const prisma = createFakePrismaForInvite({ organization: { id: "org-1", commercialTier: "freemium" } });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "inventory_manager" }, "user-owner-1"),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it("refuse d'assigner approver en Starter (nécessite Pro+)", async () => {
    const prisma = createFakePrismaForInvite({ organization: { id: "org-1", commercialTier: "starter" } });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "approver" }, "user-owner-1"),
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuse au-delà du plafond de collaborateurs (Freemium, plafond = 1)", async () => {
    const prisma = createFakePrismaForInvite({
      organization: { id: "org-1", commercialTier: "freemium" },
      memberCount: 1,
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await expect(
      service.inviteMember("org-1", { msisdn: "+224612345678", role: "cashier" }, "user-owner-1"),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it("ne compte que les membres actifs (revokedAt: null) contre le plafond", async () => {
    const prisma = createFakePrismaForInvite({ organization: { id: "org-1", commercialTier: "freemium" } });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.inviteMember("org-1", { msisdn: "+224612345678", role: "cashier" }, "user-owner-1");

    expect(prisma.organizationMember.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", revokedAt: null },
    });
  });

  it("aucun plafond de collaborateurs en Enterprise", async () => {
    const prisma = createFakePrismaForInvite({
      organization: { id: "org-1", commercialTier: "enterprise" },
      memberCount: 500,
    });
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    await service.inviteMember("org-1", { msisdn: "+224612345678", role: "cashier" }, "user-owner-1");

    expect(prisma.organizationMember.create).toHaveBeenCalled();
  });
});

describe("OrganizationsService.upgradeCommercialTier (H2, ADR-049)", () => {
  function createFakePrismaForUpgrade(organization: any) {
    return auClientScope({
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(organization),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...organization, ...data })),
      },
    });
  }

  it("change commercialTier vers le palier demandé", async () => {
    const organization = { id: "org-1", commercialTier: "freemium", dgiVerificationStatus: "verified" };
    const prisma = createFakePrismaForUpgrade(organization);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.upgradeCommercialTier("org-1", "pro");

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { commercialTier: "pro" },
    });
    expect(result.commercialTier).toBe("pro");
  });

  it("autorise l'upgrade même pour une organisation dgiVerificationStatus='unverified' (ADR-049, jamais dépendant de DGI)", async () => {
    const organization = { id: "org-1", commercialTier: "freemium", dgiVerificationStatus: "unverified" };
    const prisma = createFakePrismaForUpgrade(organization);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.upgradeCommercialTier("org-1", "starter");

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { commercialTier: "starter" },
    });
    expect(result.commercialTier).toBe("starter");
  });

  it("autorise un downgrade (pro → freemium)", async () => {
    const organization = { id: "org-1", commercialTier: "pro", dgiVerificationStatus: "verified" };
    const prisma = createFakePrismaForUpgrade(organization);
    const service = new OrganizationsService(prisma as any, createFakeSigningKeyService() as any, createFakePendingMemberInviteService() as any);

    const result = await service.upgradeCommercialTier("org-1", "freemium");

    expect(result.commercialTier).toBe("freemium");
  });
});

describe("OrganizationsService.revokeSigningKey (A4, ADR-025)", () => {
  it("délègue à OrganizationSigningKeyService.revoke()", async () => {
    const prisma = {} as any;
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService(prisma, signingKeyService as any, createFakePendingMemberInviteService() as any);

    const result = await service.revokeSigningKey("org-1");

    expect(signingKeyService.revoke).toHaveBeenCalledWith("org-1");
    expect(result.revokedAt).toBeInstanceOf(Date);
  });
});

describe("OrganizationsService — rotation de clé (E3, ADR-114)", () => {
  it("rotateSigningKey délègue à OrganizationSigningKeyService.rotate()", async () => {
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService({} as any, signingKeyService as any, createFakePendingMemberInviteService() as any);

    const result = await service.rotateSigningKey("org-1");

    expect(signingKeyService.rotate).toHaveBeenCalledWith("org-1");
    expect(result.id).toBe("signing-key-2");
  });

  it("getSigningKeyStatus délègue à OrganizationSigningKeyService.getKeyStatus()", async () => {
    const signingKeyService = createFakeSigningKeyService();
    const service = new OrganizationsService({} as any, signingKeyService as any, createFakePendingMemberInviteService() as any);

    expect(await service.getSigningKeyStatus("org-1")).toMatchObject({ active: true });
    expect(signingKeyService.getKeyStatus).toHaveBeenCalledWith("org-1");
  });
});
