import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ReferralsService } from "./referrals.service";
import {
  PRIME_FILLEUL_CENTIMES,
  PRIME_PARRAIN_CENTIMES,
  genererCodeParrainage,
} from "./referrals.constants";

// Le client scopé rendu par $extends partage les mocks de modèles — pour que
// les assertions restent lisibles — SAUF referral.findMany, qui reçoit un mock
// distinct. Sans cette séparation, une lecture qui oublierait le scope
// emprunterait le même mock que la lecture scopée et passerait inaperçue :
// c'est exactement la mutation qui avait survécu au banc.
// Le type de retour déclare ce que le helper AJOUTE : sans ça le compilateur ne
// voit que la forme entrante, et `nest build` casse là où vitest ne dit rien —
// il ne typecheck pas les specs.
type ClientFaux<T> = T & {
  $extends: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
  scopeView: any;
};

function auClientScope<T extends Record<string, any>>(prisma: T): ClientFaux<T> {
  const p = prisma as Record<string, any>;
  p.$executeRaw = vi.fn().mockResolvedValue(1);
  p.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));

  // Les deux mocks doivent être INDÉPENDANTS. Envelopper le mock brut ferait
  // enregistrer l'appel des deux côtés, et « lecture hors scope » deviendrait
  // indétectable — c'est ce qui avait laissé la mutation survivre.
  const listeScopee = p.referral.findMany;
  p.referral.findMany = vi.fn().mockResolvedValue([]);
  const scope = { ...prisma, referral: { ...p.referral, findMany: listeScopee } };
  p.$extends = vi.fn(() => scope);
  p.scopeView = scope;
  return prisma as ClientFaux<T>;
}

const PARRAIN = "org-parrain";
const FILLEUL = "org-filleul";

function fakePrisma(overrides: Record<string, any> = {}) {
  return auClientScope({
    organization: {
      findFirstOrThrow: vi.fn().mockResolvedValue({ referralCode: null }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.referralCode) {
          // Cle absente = parrain par defaut ; cle posee a null = code inconnu.
          return "parrain" in overrides ? overrides.parrain : { id: PARRAIN };
        }
        return { name: "Boutique Filleul" };
      }),
      update: vi.fn(async ({ data }: any) => ({ ...data })),
      ...overrides.organization,
    },
    referral: {
      create: vi.fn(async ({ data }: any) => ({ id: "ref-1", ...data })),
      findUnique: vi.fn().mockResolvedValue(overrides.referral ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.referrals ?? []),
      update: vi.fn(async ({ data }: any) => ({ ...data })),
    },
  });
}

function fakeCredits() {
  return { grant: vi.fn().mockResolvedValue({ balanceAfterCentimes: 0n }) };
}

const service = (prisma: any, credits: any = fakeCredits()) =>
  new ReferralsService(prisma as never, credits as never);

describe("code de parrainage", () => {
  it("six caractères Base32, sans 0/1/O/I ambigus", () => {
    for (let i = 0; i < 50; i++) {
      expect(genererCodeParrainage()).toMatch(/^[A-Z2-7]{6}$/);
    }
  });

  it("ne se répète pas", () => {
    const codes = new Set(Array.from({ length: 200 }, () => genererCodeParrainage()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe("ReferralsService.activate", () => {
  it("génère et enregistre un code", async () => {
    const prisma = fakePrisma();
    const { referralCode } = await service(prisma).activate(PARRAIN);

    expect(referralCode).toMatch(/^[A-Z2-7]{6}$/);
    expect(prisma.organization.update).toHaveBeenCalled();
  });

  // Un second code invaliderait tous les partages déjà faits — affiches,
  // messages, bouche-à-oreille.
  it("idempotent : rend le code existant sans en générer un autre", async () => {
    const prisma = fakePrisma();
    prisma.organization.findFirstOrThrow = vi.fn().mockResolvedValue({ referralCode: "ABC234" });

    const { referralCode } = await service(prisma).activate(PARRAIN);

    expect(referralCode).toBe("ABC234");
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("réessaie sur collision de code", async () => {
    const prisma = fakePrisma();
    let appels = 0;
    prisma.organization.update = vi.fn(async ({ data }: any) => {
      appels += 1;
      if (appels === 1) {
        throw Object.assign(new Error("Unique"), {
          code: "P2002",
          meta: { target: ["referral_code"] },
        });
      }
      return data;
    });

    await service(prisma).activate(PARRAIN);
    expect(appels).toBe(2);
  });
});

describe("ReferralsService.attach", () => {
  it("rattache le filleul et recopie son nom", async () => {
    const prisma = fakePrisma();
    await service(prisma).attach(FILLEUL, "ABC234");

    const data = prisma.referral.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      referrerOrganizationId: PARRAIN,
      referredOrganizationId: FILLEUL,
      // Recopié : sous RLS, le parrain ne pourra jamais lire l'organisation du
      // filleul pour l'afficher.
      referredName: "Boutique Filleul",
      code: "ABC234",
    });
  });

  // NE VERSE RIEN à l'inscription : la prime attend le premier abonnement.
  it("ne crédite personne au rattachement", async () => {
    const credits = fakeCredits();
    await service(fakePrisma(), credits).attach(FILLEUL, "ABC234");
    expect(credits.grant).not.toHaveBeenCalled();
  });

  it("code inconnu : 404", async () => {
    const prisma = fakePrisma({ parrain: null });
    await expect(service(prisma).attach(FILLEUL, "ZZZZZZ")).rejects.toThrow(NotFoundException);
  });

  // Se parrainer soi-même doublerait la prime sans amener personne.
  it("refuse l'auto-parrainage", async () => {
    const prisma = fakePrisma({ parrain: { id: FILLEUL } });
    await expect(service(prisma).attach(FILLEUL, "ABC234")).rejects.toThrow(ConflictException);
    expect(prisma.referral.create).not.toHaveBeenCalled();
  });

  it("filleul déjà rattaché : 409", async () => {
    const prisma = fakePrisma();
    prisma.referral.create = vi.fn().mockRejectedValue(
      Object.assign(new Error("Unique"), {
        code: "P2002",
        meta: { target: ["referred_organization_id"] },
      }),
    );
    await expect(service(prisma).attach(FILLEUL, "ABC234")).rejects.toThrow(ConflictException);
  });

  // Écriture sous le scope du PARRAIN : c'est lui que la politique reconnaît
  // sur referrer_organization_id, donc lui qui satisfait le WITH CHECK.
  it("écrit sous le scope du parrain, pas du filleul", async () => {
    const prisma = fakePrisma();
    await service(prisma).attach(FILLEUL, "ABC234");

    const setConfig = prisma.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain(PARRAIN);
    expect(setConfig.values).not.toContain(FILLEUL);
  });
});

describe("ReferralsService.convertirSiEligible", () => {
  const enAttente = {
    id: "ref-1",
    referrerOrganizationId: PARRAIN,
    referredOrganizationId: FILLEUL,
    referredName: "Boutique Filleul",
    status: "pending",
  };

  it("verse les DEUX primes au premier palier payant", async () => {
    const credits = fakeCredits();
    const prisma = fakePrisma({ referral: enAttente });

    await service(prisma, credits).convertirSiEligible(FILLEUL, "starter");

    expect(credits.grant).toHaveBeenCalledTimes(2);
    expect(credits.grant).toHaveBeenCalledWith(
      PARRAIN,
      PRIME_PARRAIN_CENTIMES,
      expect.stringContaining("Boutique Filleul"),
      expect.anything(),
    );
    expect(credits.grant).toHaveBeenCalledWith(
      FILLEUL,
      PRIME_FILLEUL_CENTIMES,
      expect.any(String),
      expect.anything(),
    );
  });

  it("le parrain touche 50 000 GNF, le filleul 15 000", () => {
    expect(PRIME_PARRAIN_CENTIMES).toBe(5_000_000n);
    expect(PRIME_FILLEUL_CENTIMES).toBe(1_500_000n);
  });

  it("rester en freemium ne verse rien", async () => {
    const credits = fakeCredits();
    await service(fakePrisma({ referral: enAttente }), credits).convertirSiEligible(FILLEUL, "freemium");
    expect(credits.grant).not.toHaveBeenCalled();
  });

  // LE TEST CENTRAL : monter de Starter à Pro ne doit pas reverser la prime.
  it("idempotent : un parrainage déjà converti ne reverse rien", async () => {
    const credits = fakeCredits();
    const prisma = fakePrisma({ referral: { ...enAttente, status: "converted" } });

    await service(prisma, credits).convertirSiEligible(FILLEUL, "pro");

    expect(credits.grant).not.toHaveBeenCalled();
    expect(prisma.referral.update).not.toHaveBeenCalled();
  });

  it("aucun parrainage : rien ne se passe", async () => {
    const credits = fakeCredits();
    await service(fakePrisma({ referral: null }), credits).convertirSiEligible(FILLEUL, "pro");
    expect(credits.grant).not.toHaveBeenCalled();
  });

  // Une prime est un bonus, pas une condition : son échec ne doit jamais
  // défaire un changement de palier déjà acquis.
  it("NE LÈVE JAMAIS, même si le versement échoue", async () => {
    const credits = { grant: vi.fn().mockRejectedValue(new Error("panne")) };
    const prisma = fakePrisma({ referral: enAttente });

    await expect(
      service(prisma, credits).convertirSiEligible(FILLEUL, "starter"),
    ).resolves.toBeUndefined();
  });

  it("fige les montants versés sur la ligne", async () => {
    const prisma = fakePrisma({ referral: enAttente });
    await service(prisma).convertirSiEligible(FILLEUL, "enterprise");

    const data = prisma.referral.update.mock.calls[0][0].data;
    expect(data.status).toBe("converted");
    expect(data.referrerBonusCentimes).toBe(PRIME_PARRAIN_CENTIMES);
    expect(data.convertedAt).toBeInstanceOf(Date);
  });
});

describe("ReferralsService.summary", () => {
  it("totalise les primes réellement versées", async () => {
    const prisma = fakePrisma({
      referrals: [
        { referrerBonusCentimes: PRIME_PARRAIN_CENTIMES },
        { referrerBonusCentimes: PRIME_PARRAIN_CENTIMES },
        // En attente : ne compte pas.
        { referrerBonusCentimes: null },
      ],
    });
    prisma.organization.findFirstOrThrow = vi.fn().mockResolvedValue({ referralCode: "ABC234" });

    const resume = await service(prisma).summary(PARRAIN);

    expect(resume.isActive).toBe(true);
    expect(resume.totalGainsCentimes).toBe((PRIME_PARRAIN_CENTIMES * 2n).toString());
    expect(resume.referrals).toHaveLength(3);
  });

  it("programme non activé : isActive false", async () => {
    const prisma = fakePrisma();
    const resume = await service(prisma).summary(PARRAIN);
    expect(resume.isActive).toBe(false);
    expect(resume.referralCode).toBeNull();
  });

  // Double épinglage : le GUC porte bien la bonne organisation, ET la liste des
  // filleuls passe par le client scopé. Deux constructions distinctes — vérifier
  // la première seule laisserait croire le scope en place alors que la lecture
  // s'en échapperait.
  it("lit sous le scope de l'organisation, jamais une autre", async () => {
    const prisma = fakePrisma();
    await service(prisma).summary("org-a-proteger");

    const extension = prisma.$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = prisma.$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("org-a-proteger");

    expect(prisma.scopeView.referral.findMany).toHaveBeenCalled();
    expect(prisma.referral.findMany).not.toHaveBeenCalled();
  });
});
