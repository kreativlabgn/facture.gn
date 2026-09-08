import { describe, expect, it, vi } from "vitest";
import { PracticesService } from "./practices.service";

function createFakePrisma(createImpl?: ReturnType<typeof vi.fn>) {
  const prisma: any = {
    professionalPractice: {
      create: createImpl ?? vi.fn().mockResolvedValue({ id: "practice-1" }),
    },
    practiceMember: {
      create: vi.fn().mockResolvedValue({ id: "member-1" }),
    },
    $transaction: vi.fn((callback: any) => callback(prisma)),
  };
  return prisma;
}

describe("PracticesService", () => {
  it("crée une practice avec les champs fournis, type persisté tel quel", async () => {
    const prisma = createFakePrisma();
    const service = new PracticesService(prisma as any);

    await service.create(
      { name: "Cabinet Mamadou & Associés", type: "cabinet_comptable", phone: "+224612345678" },
      "user-1",
    );

    expect(prisma.professionalPractice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Cabinet Mamadou & Associés", type: "cabinet_comptable" }),
    });
  });

  it("le créateur devient automatiquement practice_admin de la nouvelle practice", async () => {
    const prisma = createFakePrisma();
    const service = new PracticesService(prisma as any);

    await service.create(
      { name: "Cabinet Mamadou & Associés", type: "cabinet_comptable", phone: "+224612345678" },
      "user-1",
    );

    expect(prisma.practiceMember.create).toHaveBeenCalledWith({
      data: { practiceId: "practice-1", userId: "user-1", role: "practice_admin" },
    });
  });

  it("registrationNumber et email absents → null, jamais un défaut serveur inventé", async () => {
    const prisma = createFakePrisma();
    const service = new PracticesService(prisma as any);

    await service.create({ name: "CGA Kaloum", type: "cga", phone: "+224612345678" }, "user-1");

    expect(prisma.professionalPractice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ registrationNumber: undefined, email: undefined }),
    });
  });
});

const PRACTICE_ID = "practice-1";
const ADMIN_ID = "admin-1";
const INVITED_MSISDN = "+224612345678";

function createFakePrismaForInviteMember(
  overrides: { requesterMember?: any; userPhone?: any; existingMembership?: any } = {},
) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        // Distingue l'appel "vérifie que le demandeur est practice_admin" du
        // 2e appel "vérifie si l'invité est déjà membre" via userId.
        if (where.userId === ADMIN_ID) {
          return Promise.resolve(
            overrides.requesterMember !== undefined
              ? overrides.requesterMember
              : { id: "member-admin", role: "practice_admin" },
          );
        }
        return Promise.resolve(overrides.existingMembership ?? null);
      }),
      create: vi.fn().mockResolvedValue({ id: "member-2", role: "accountant_external" }),
    },
    userPhone: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.userPhone !== undefined ? overrides.userPhone : { userId: "invited-1", msisdn: INVITED_MSISDN },
      ),
    },
  };
  return prisma;
}

describe("PracticesService — inviter un collaborateur (F8, ADR-068)", () => {
  it("ajoute un collaborateur déjà inscrit avec role accountant_external", async () => {
    const prisma = createFakePrismaForInviteMember();
    const service = new PracticesService(prisma as any);

    await service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID);

    expect(prisma.practiceMember.create).toHaveBeenCalledWith({
      data: { practiceId: PRACTICE_ID, userId: "invited-1", role: "accountant_external" },
    });
  });

  it("refuse si l'appelant n'est pas practice_admin de la practice ciblée", async () => {
    const prisma = createFakePrismaForInviteMember({ requesterMember: null });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).rejects.toThrow(/practice_admin/);
  });

  it("refuse (404) si le msisdn n'est associé à aucun compte", async () => {
    const prisma = createFakePrismaForInviteMember({ userPhone: null });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).rejects.toThrow(/introuvable/);
  });

  it("refuse (409) si l'utilisateur est déjà membre actif de cette practice", async () => {
    const prisma = createFakePrismaForInviteMember({
      existingMembership: { id: "member-existing", userId: "invited-1", leftAt: null },
    });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).rejects.toThrow(/déjà membre/);
  });

  it("accepte un ré-ajout si le seul membership existant a leftAt renseigné", async () => {
    const prisma = createFakePrismaForInviteMember({ existingMembership: null });
    const service = new PracticesService(prisma as any);

    await expect(
      service.inviteMember(PRACTICE_ID, { msisdn: INVITED_MSISDN, role: "accountant_external" }, ADMIN_ID),
    ).resolves.toEqual({ id: "member-2", role: "accountant_external" });
  });
});

function createFakePrismaForUpgrade(requesterRole: string | null, organisationsSuivies = 0) {
  const prisma: any = {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(requesterRole ? { id: "member-admin", role: requesterRole } : null),
    },
    professionalPractice: {
      update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
    // Le décompte des entreprises suivies : c'est lui qui décide si le palier
    // visé est tenable.
    mandate: { count: vi.fn().mockResolvedValue(organisationsSuivies) },
  };
  return prisma;
}

describe("PracticesService.upgradePartnerTier (H3, ADR-071)", () => {
  it("un practice_admin peut poser le palier Partner", async () => {
    const prisma = createFakePrismaForUpgrade("practice_admin");
    const service = new PracticesService(prisma as any);

    const result = await service.upgradePartnerTier(PRACTICE_ID, "partner_starter", ADMIN_ID);

    expect(prisma.professionalPractice.update).toHaveBeenCalledWith({
      where: { id: PRACTICE_ID },
      data: { tier: "partner_starter" },
    });
    expect(result.tier).toBe("partner_starter");
  });

  it("refuse un membre non practice_admin (ForbiddenException)", async () => {
    const prisma = createFakePrismaForUpgrade("accountant_external");
    const service = new PracticesService(prisma as any);

    await expect(service.upgradePartnerTier(PRACTICE_ID, "partner_pro", ADMIN_ID)).rejects.toThrow(/practice_admin/);
    expect(prisma.professionalPractice.update).not.toHaveBeenCalled();
  });

  it("refuse un non-membre (ForbiddenException)", async () => {
    const prisma = createFakePrismaForUpgrade(null);
    const service = new PracticesService(prisma as any);

    await expect(service.upgradePartnerTier(PRACTICE_ID, "partner_pro", ADMIN_ID)).rejects.toThrow(/practice_admin/);
  });

  // LE SENS DESCENDANT. Sans ce garde, un partenaire Pro suivant quatre-vingts
  // entreprises retombait en Free et les gardait toutes : le plafond posé à la
  // demande de mandat était contourné par la porte de derrière, en une requête.
  it("refuse une rétrogradation qui laisserait le cabinet au-dessus de son plafond", async () => {
    const prisma = createFakePrismaForUpgrade("practice_admin", 80);
    const service = new PracticesService(prisma as any);

    await expect(service.upgradePartnerTier(PRACTICE_ID, "partner_free", ADMIN_ID)).rejects.toThrow(
      /limité à 5/,
    );
    expect(prisma.professionalPractice.update).not.toHaveBeenCalled();
  });

  it("accepte la rétrogradation quand le portefeuille tient dans le palier visé", async () => {
    const prisma = createFakePrismaForUpgrade("practice_admin", 4);
    const service = new PracticesService(prisma as any);

    await service.upgradePartnerTier(PRACTICE_ID, "partner_free", ADMIN_ID);
    expect(prisma.professionalPractice.update).toHaveBeenCalled();
  });

  it("monter vers un palier illimité ne compte rien", async () => {
    const prisma = createFakePrismaForUpgrade("practice_admin", 10_000);
    const service = new PracticesService(prisma as any);

    await service.upgradePartnerTier(PRACTICE_ID, "partner_pro", ADMIN_ID);
    expect(prisma.professionalPractice.update).toHaveBeenCalled();
  });

  // On ne révoque AUCUN mandat pour faire rentrer le cabinet dans son nouveau
  // palier : couper l'accès d'un comptable à ses clients parce qu'il a changé
  // d'abonnement serait une décision commerciale déguisée en effet de bord.
  it("ne révoque aucun mandat pour faire tenir le palier", async () => {
    const prisma = createFakePrismaForUpgrade("practice_admin", 80);
    prisma.mandate.updateMany = vi.fn();
    const service = new PracticesService(prisma as any);

    await expect(service.upgradePartnerTier(PRACTICE_ID, "partner_free", ADMIN_ID)).rejects.toThrow();
    expect(prisma.mandate.updateMany).not.toHaveBeenCalled();
  });
});

// LE DÉPART D'UN COLLABORATEUR — la contrepartie du mandat accordé à l'ENTITÉ
// (ADR-068). C'est lui qui coupe tous les accès d'un seul coup. Rien n'écrivait
// jamais `leftAt` : dix lectures dans le dépôt, aucune écriture. La garantie
// était énoncée, pas outillée.
describe("PracticesService.revokeMember — départ d'un collaborateur", () => {
  const MEMBRE_ID = "user-collaborateur";

  function fakePrisma(options: {
    demandeur: string | null;
    cible: { id: string; role: string } | null;
    autresAdmins?: number;
  }) {
    const prisma: any = {
      practiceMember: {
        findFirst: vi
          .fn()
          // 1er appel : assertPracticeAdmin sur le demandeur.
          .mockResolvedValueOnce(options.demandeur ? { id: "m-dem", role: options.demandeur } : null)
          // 2e appel : la cible.
          .mockResolvedValueOnce(options.cible),
        count: vi.fn().mockResolvedValue(options.autresAdmins ?? 1),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "m-cible", ...data })),
      },
    };
    return prisma;
  }

  it("pose une date de départ, sans supprimer la ligne", async () => {
    const prisma = fakePrisma({ demandeur: "practice_admin", cible: { id: "m-cible", role: "accountant_external" } });
    const service = new PracticesService(prisma as any);

    await service.revokeMember(PRACTICE_ID, MEMBRE_ID, ADMIN_ID);

    const appel = prisma.practiceMember.update.mock.calls[0][0];
    expect(appel.data.leftAt).toBeInstanceOf(Date);
    // Un cabinet doit pouvoir dire qui suivait tel dossier l'an dernier :
    // effacer l'appartenance effacerait aussi cette réponse.
    expect(prisma.practiceMember.delete).toBeUndefined();
  });

  it("refuse un demandeur qui n'est pas administrateur", async () => {
    const prisma = fakePrisma({ demandeur: "accountant_external", cible: { id: "m-cible", role: "accountant_external" } });
    const service = new PracticesService(prisma as any);

    await expect(service.revokeMember(PRACTICE_ID, MEMBRE_ID, ADMIN_ID)).rejects.toThrow(/practice_admin/);
    expect(prisma.practiceMember.update).not.toHaveBeenCalled();
  });

  it("refuse un collaborateur qui n'est pas membre actif", async () => {
    const prisma = fakePrisma({ demandeur: "practice_admin", cible: null });
    const service = new PracticesService(prisma as any);

    await expect(service.revokeMember(PRACTICE_ID, MEMBRE_ID, ADMIN_ID)).rejects.toThrow(/pas membre actif/);
  });

  // Atteignable en un clic — un associé unique qui se retire lui-même — et
  // irréversible sans intervention manuelle : le cabinet n'aurait plus personne
  // pour inviter, demander un mandat ou changer de palier.
  it("refuse de retirer le dernier administrateur", async () => {
    const prisma = fakePrisma({
      demandeur: "practice_admin",
      cible: { id: "m-cible", role: "practice_admin" },
      autresAdmins: 0,
    });
    const service = new PracticesService(prisma as any);

    await expect(service.revokeMember(PRACTICE_ID, MEMBRE_ID, ADMIN_ID)).rejects.toThrow(
      /plus aucun administrateur/,
    );
    expect(prisma.practiceMember.update).not.toHaveBeenCalled();
  });

  it("accepte de retirer un administrateur s'il en reste un autre", async () => {
    const prisma = fakePrisma({
      demandeur: "practice_admin",
      cible: { id: "m-cible", role: "practice_admin" },
      autresAdmins: 1,
    });
    const service = new PracticesService(prisma as any);

    await service.revokeMember(PRACTICE_ID, MEMBRE_ID, ADMIN_ID);
    expect(prisma.practiceMember.update).toHaveBeenCalled();
  });
});

describe("PracticesService.upgradeRevenueShareSettlementMode (H3, ADR-071)", () => {
  it("un practice_admin peut changer le mode de règlement", async () => {
    const prisma = createFakePrismaForUpgrade("practice_admin");
    const service = new PracticesService(prisma as any);

    const result = await service.upgradeRevenueShareSettlementMode(PRACTICE_ID, "subscription_deduction", ADMIN_ID);

    expect(prisma.professionalPractice.update).toHaveBeenCalledWith({
      where: { id: PRACTICE_ID },
      data: { revenueShareSettlementMode: "subscription_deduction" },
    });
    expect(result.revenueShareSettlementMode).toBe("subscription_deduction");
  });

  it("refuse un membre non practice_admin (ForbiddenException)", async () => {
    const prisma = createFakePrismaForUpgrade("accountant_external");
    const service = new PracticesService(prisma as any);

    await expect(
      service.upgradeRevenueShareSettlementMode(PRACTICE_ID, "payout", ADMIN_ID),
    ).rejects.toThrow(/practice_admin/);
    expect(prisma.professionalPractice.update).not.toHaveBeenCalled();
  });
});

describe("PracticesService — lister les practices dont je suis membre", () => {
  it("retourne les practices dont l'utilisateur est membre actif, avec son rôle sur chacune", async () => {
    const prisma: any = {
      practiceMember: {
        findMany: vi.fn().mockResolvedValue([
          { role: "practice_admin", practice: { id: "practice-1", name: "Cabinet Mamadou & Associés", type: "cabinet_comptable" } },
          { role: "accountant_external", practice: { id: "practice-2", name: "CGA Kaloum", type: "cga" } },
        ]),
      },
    };
    const service = new PracticesService(prisma as any);

    const result = await service.listMine("user-1");

    expect(prisma.practiceMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", leftAt: null },
      include: { practice: true },
      orderBy: { joinedAt: "asc" },
    });
    expect(result).toEqual([
      { id: "practice-1", name: "Cabinet Mamadou & Associés", type: "cabinet_comptable", role: "practice_admin" },
      { id: "practice-2", name: "CGA Kaloum", type: "cga", role: "accountant_external" },
    ]);
  });

  it("ne retourne jamais un membership quitté (leftAt renseigné) — filtré côté requête", async () => {
    const prisma: any = { practiceMember: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new PracticesService(prisma as any);

    const result = await service.listMine("user-1");

    expect(result).toEqual([]);
    expect(prisma.practiceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leftAt: null }) }),
    );
  });
});

describe("PracticesService — lister les collaborateurs d'un cabinet", () => {
  it("retourne les membres actifs avec leur nom, tout membre actif peut consulter", async () => {
    const prisma: any = {
      practiceMember: {
        findFirst: vi.fn().mockResolvedValue({ id: "member-requester", role: "accountant_external", leftAt: null }),
        findMany: vi.fn().mockResolvedValue([
          { id: "member-1", role: "practice_admin", user: { id: "user-1", name: "Mamadou Diallo" } },
          { id: "member-2", role: "accountant_external", user: { id: "user-2", name: "Fanta Camara" } },
        ]),
      },
    };
    const service = new PracticesService(prisma as any);

    const result = await service.listMembers(PRACTICE_ID, "requester-1");

    expect(prisma.practiceMember.findMany).toHaveBeenCalledWith({
      where: { practiceId: PRACTICE_ID, leftAt: null },
      include: { user: { select: { id: true, name: true } } },
    });
    expect(result).toEqual([
      { id: "member-1", role: "practice_admin", user: { id: "user-1", name: "Mamadou Diallo" } },
      { id: "member-2", role: "accountant_external", user: { id: "user-2", name: "Fanta Camara" } },
    ]);
  });

  it("refuse un non-membre de la practice", async () => {
    const prisma: any = {
      practiceMember: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
      },
    };
    const service = new PracticesService(prisma as any);

    await expect(service.listMembers(PRACTICE_ID, "outsider-1")).rejects.toThrow(/membre/);
    expect(prisma.practiceMember.findMany).not.toHaveBeenCalled();
  });
});

// SANS TRI, Postgres rend les lignes dans l'ordre qui l'arrange, et il peut
// changer d'une requête à l'autre. Or l'appelant — le layout de l'espace
// cabinet — se pose sur le PREMIER élément : un collaborateur membre de deux
// structures atterrissait tantôt dans la sienne, tantôt dans celle d'un
// confrère. L'accès était légitime dans les deux cas, mais l'effet à l'écran
// était celui d'une fuite.
describe("PracticesService.listMine — l'ordre est le contrat", () => {
  it("trie par ancienneté de rattachement, le cabinet d'origine d'abord", async () => {
    const prisma: any = {
      practiceMember: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await new PracticesService(prisma as any).listMine("user-1");

    expect(prisma.practiceMember.findMany.mock.calls[0][0].orderBy).toEqual({ joinedAt: "asc" });
  });
});

describe("PracticesService — lister par type (F12, ADR-078)", () => {
  it("liste les practices du type demandé", async () => {
    const prisma: any = {
      professionalPractice: {
        findMany: vi.fn().mockResolvedValue([{ id: "cga-1", type: "cga", name: "CGA Kaloum" }]),
      },
    };
    const service = new PracticesService(prisma as any);

    const result = await service.findAllByType("cga");

    expect(prisma.professionalPractice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: "cga" } }),
    );
    expect(result).toEqual([{ id: "cga-1", type: "cga", name: "CGA Kaloum" }]);
  });

  // CET ANNUAIRE EST LISIBLE PAR TOUT COMPTE AUTHENTIFIÉ, sans appartenance.
  // Un findMany nu rendait la ligne entière, donc `tier` et
  // `revenueShareSettlementMode` : le palier commercial d'un partenaire et la
  // façon dont il est rémunéré. Un concurrent inscrit les lisait d'une requête.
  it("n'expose jamais les conditions commerciales d'un partenaire", async () => {
    const prisma: any = {
      professionalPractice: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await new PracticesService(prisma as any).findAllByType("cga");

    const { select } = prisma.professionalPractice.findMany.mock.calls[0][0];
    // Projection EXPLICITE, jamais implicite : c'est elle qui garantit qu'un
    // champ ajouté demain au modèle ne se retrouve pas publié par accident.
    expect(select).toBeDefined();
    expect(select.tier).toBeUndefined();
    expect(select.revenueShareSettlementMode).toBeUndefined();
    // Ce qui reste est ce qu'un adhérent doit voir pour choisir un CGA.
    expect(select).toMatchObject({ id: true, name: true, ordreVerified: true });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Annuaire NIF → organisation (Chantier C). Endpoint d'annuaire : ces tests
// figent les barrières anti-énumération autant que le comportement nominal.
// ─────────────────────────────────────────────────────────────────────────────
function createLookupPrisma(options: { adminOf?: boolean; organization?: unknown } = {}) {
  const { adminOf = true, organization = { id: "org-1", name: "Boutique Aissatou" } } = options;
  return {
    practiceMember: {
      findFirst: vi.fn().mockResolvedValue(adminOf ? { id: "member-1" } : null),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(organization),
    },
  } as any;
}

describe("PracticesService.lookupOrganizationByNif", () => {
  it("rend l'organisation correspondante à un practice_admin", async () => {
    const prisma = createLookupPrisma();
    const service = new PracticesService(prisma);

    await expect(service.lookupOrganizationByNif("123456789", "user-1")).resolves.toEqual({
      id: "org-1",
      name: "Boutique Aissatou",
    });
  });

  // La correspondance doit être EXACTE : un `contains`/`startsWith` permettrait
  // de balayer l'espace des NIF par préfixes.
  it("interroge par correspondance exacte, jamais par préfixe", async () => {
    const prisma = createLookupPrisma();
    await new PracticesService(prisma).lookupOrganizationByNif("123456789", "user-1");

    const where = prisma.organization.findUnique.mock.calls[0][0].where;
    expect(where).toEqual({ nif: "123456789" });
    expect(JSON.stringify(where)).not.toMatch(/contains|startsWith|endsWith|mode/);
  });

  // Celui qui cherche n'est pas encore mandaté : il n'a droit qu'à de quoi
  // identifier son client, rien de fiscal ni de commercial.
  it("ne sélectionne que l'identifiant et le nom", async () => {
    const prisma = createLookupPrisma();
    await new PracticesService(prisma).lookupOrganizationByNif("123456789", "user-1");

    expect(prisma.organization.findUnique.mock.calls[0][0].select).toEqual({ id: true, name: true });
  });

  it("n'accepte qu'une appartenance ACTIVE de rôle practice_admin", async () => {
    const prisma = createLookupPrisma();
    await new PracticesService(prisma).lookupOrganizationByNif("123456789", "user-1");

    expect(prisma.practiceMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", leftAt: null, role: "practice_admin" },
      }),
    );
  });

  it("refuse un utilisateur qui n'est practice_admin d'aucun cabinet", async () => {
    const prisma = createLookupPrisma({ adminOf: false });
    const service = new PracticesService(prisma);

    await expect(service.lookupOrganizationByNif("123456789", "user-1")).rejects.toThrow(
      /practice_admin/,
    );
  });

  // Barrière la plus importante : un utilisateur non autorisé ne doit même pas
  // déclencher la requête. Sinon le temps de réponse trahirait l'existence du
  // NIF avant même le contrôle d'accès.
  it("ne touche pas à la base quand l'accès est refusé", async () => {
    const prisma = createLookupPrisma({ adminOf: false });
    await expect(
      new PracticesService(prisma).lookupOrganizationByNif("123456789", "user-1"),
    ).rejects.toThrow();

    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it("répond introuvable sur un NIF inconnu, sans dire pourquoi", async () => {
    const prisma = createLookupPrisma({ organization: null });
    const service = new PracticesService(prisma);

    await expect(service.lookupOrganizationByNif("999999999", "user-1")).rejects.toThrow(
      "Aucune organisation ne correspond à ce NIF",
    );
  });
});
