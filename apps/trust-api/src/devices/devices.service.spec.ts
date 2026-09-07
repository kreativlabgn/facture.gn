import { createHash } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DevicesService } from "./devices.service";

// organizationScopedClient() appelle `$extends`, et setOrganizationScope() pose
// le GUC via `$executeRaw`. Le vrai client offre les deux ; un faux qui ne les
// offre pas ne teste pas le service, il plante dessus. `$extends` rend le client
// LUI-MÊME pour que les mocks de modèle restent partagés. `$transaction`
// bi-forme : la forme tableau est celle qu'emploie makeScopedOperation(), ce qui
// rend l'extension rejouable — indispensable pour épingler la VALEUR du scope.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction =
    p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  for (const valeur of Object.values(p)) {
    const modele = valeur as Record<string, unknown> | null;
    if (!modele || typeof modele !== "object") continue;
    if (modele.findUniqueOrThrow && !modele.findFirstOrThrow) modele.findFirstOrThrow = modele.findUniqueOrThrow;
    if (modele.findUnique && !modele.findFirst) modele.findFirst = modele.findUnique;
  }
  return prisma;
}

const ORG = "org-1";
const JETON = "jeton-en-clair-du-terminal";

// argon2 réel serait lent et sans intérêt ici : ce qui compte est QUE le jeton
// soit haché avant persistance et vérifié par le service, pas la primitive.
//
// Le faux hachage doit être NON INVERSIBLE, et pas un `hache(${clair})` : un
// faux qui embarque le clair fait apparaître le jeton dans la ligne persistée
// et rend impossible toute assertion de non-fuite — elle échouerait toujours,
// à cause du faux, jamais à cause du service.
const empreinte = (clair: string) => `argon2id${createHash("sha256").update(clair).digest("hex")}`;

function createFakePasswordService(jetonAttendu: string = JETON) {
  return {
    hash: vi.fn(async (clair: string) => empreinte(clair)),
    verify: vi.fn(async (hache: string, clair: string) => hache === empreinte(jetonAttendu) && clair === jetonAttendu),
    generateTemporaryPassword: vi.fn(),
  };
}

function createFakePrisma(
  overrides: {
    candidats?: any[];
    branch?: any;
    device?: any;
    revendiqueCount?: number;
    createImpl?: any;
  } = {},
) {
  return auClientScope({
    branch: {
      findFirst: vi.fn().mockResolvedValue("branch" in overrides ? overrides.branch : { id: "branch-1" }),
    },
    device: {
      create: vi.fn(
        overrides.createImpl ??
          (({ data }: any) => Promise.resolve({ id: "device-1", ...data })),
      ),
      findMany: vi.fn().mockResolvedValue(overrides.candidats ?? []),
      findFirst: vi.fn().mockResolvedValue("device" in overrides ? overrides.device : null),
      updateMany: vi.fn().mockResolvedValue({ count: overrides.revendiqueCount ?? 1 }),
      update: vi.fn(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
    },
  });
}

describe("DevicesService.provision (chemin PME)", () => {
  it("rend le jeton en clair UNE SEULE FOIS et ne persiste que son empreinte", async () => {
    const prisma = createFakePrisma();
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    const resultat = await service.provision(ORG, { label: "Caisse 1" }, "user-1");

    expect(resultat.enrollmentToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const data = (prisma as any).device.create.mock.calls[0][0].data;
    const ligne = JSON.stringify(data);

    // Ni le jeton entier, ni un PRÉFIXE de celui-ci. Le préfixe est le cas
    // réel : le placeholder d'imeiOrSerial doit tirer son propre aléa, pas
    // découper le secret que enrollmentTokenHash existe pour ne pas stocker.
    expect(ligne).not.toContain(resultat.enrollmentToken);
    expect(ligne).not.toContain(resultat.enrollmentToken.slice(0, 12));
    expect(data.enrollmentTokenHash).toBe(empreinte(resultat.enrollmentToken));
    expect(data.status).toBe("pending");
    expect(data.organizationId).toBe(ORG);
  });

  it("refuse une succursale qui n'appartient pas à l'organisation", async () => {
    const prisma = createFakePrisma({ branch: null });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await expect(
      service.provision(ORG, { label: "Caisse 1", branchId: "branch-tiers" }, "user-1"),
    ).rejects.toThrow(NotFoundException);
    expect((prisma as any).device.create).not.toHaveBeenCalled();
  });

  it("la succursale est lue avec la DOUBLE CLAUSE, jamais par id seul", async () => {
    const prisma = createFakePrisma();
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.provision(ORG, { label: "Caisse 1", branchId: "branch-1" }, "user-1");

    expect((prisma as any).branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "branch-1", organizationId: ORG } }),
    );
  });

  // DOUBLE ÉPINGLAGE, volet 1 — la valeur portée par le CLIENT SCOPÉ. Les faux
  // `$extends` se renvoyant eux-mêmes, elle n'est observable qu'en rejouant
  // l'extension capturée.
  it("pose app.current_org_id sur l'organisation du RolesGuard, jamais une autre", async () => {
    const prisma = createFakePrisma();
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.provision("org-a-proteger", { label: "Caisse 1" }, "user-1");

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });

    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });
});

describe("DevicesService.enroll (chemin TERMINAL)", () => {
  const candidat = {
    id: "device-1",
    organizationId: "org-du-terminal",
    enrollmentTokenHash: empreinte(JETON),
  };
  const dto = { enrollmentToken: JETON, imeiOrSerial: "356938035643809", publicKey: "a".repeat(64) };

  it("enrôle le terminal et consomme le jeton", async () => {
    const prisma = createFakePrisma({ candidats: [candidat] });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    const resultat = await service.enroll(dto);

    expect(resultat).toEqual({ deviceId: "device-1", status: "active" });
    const revendication = (prisma as any).device.updateMany.mock.calls[0][0];
    expect(revendication.data).toMatchObject({
      imeiOrSerial: dto.imeiOrSerial,
      publicKey: dto.publicKey,
      status: "active",
    });
    // La course se ferme par la clause where, pas par la lecture en amont.
    expect(revendication.where).toMatchObject({ status: "pending", tokenConsumedAt: null });
  });

  // DOUBLE ÉPINGLAGE, volet 2 — l'ABSENCE de scope sur la découverte, puis sa
  // présence ensuite. C'est l'invariant central du module : le terminal ne
  // porte aucune organisation, la résoudre exige une lecture globale.
  it("ne pose AUCUN scope avant d'avoir résolu le jeton, puis scope l'organisation découverte", async () => {
    const prisma = createFakePrisma({ candidats: [candidat] });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.enroll(dto);

    // La lecture de découverte passe par le client de BASE : aucun $extends
    // n'a été construit pour elle.
    expect((prisma as any).$extends).not.toHaveBeenCalled();
    expect((prisma as any).device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "pending" }) }),
    );

    // Puis le GUC est posé — sur l'organisation DÉCOUVERTE, jamais une autre.
    const setConfig = (prisma as any).$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-du-terminal");

    // Et il précède la revendication.
    const guc = (prisma as any).$executeRaw.mock.invocationCallOrder[0];
    const revendication = (prisma as any).device.updateMany.mock.invocationCallOrder[0];
    expect(guc).toBeLessThan(revendication);
  });

  it("jeton inconnu : 404 générique, aucune écriture", async () => {
    const prisma = createFakePrisma({ candidats: [] });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await expect(service.enroll(dto)).rejects.toThrow(NotFoundException);
    expect((prisma as any).device.updateMany).not.toHaveBeenCalled();
  });

  // Un terminal ne doit jamais pouvoir distinguer « jeton inconnu » de « jeton
  // expiré » ou « déjà consommé » : ce serait un oracle de balayage. Les trois
  // cas convergent sur le même message.
  it("jeton expiré ou déjà consommé : message IDENTIQUE à un jeton inconnu", async () => {
    const inconnu = createFakePrisma({ candidats: [] });
    const consomme = createFakePrisma({ candidats: [candidat], revendiqueCount: 0 });
    const service1 = new DevicesService(inconnu as any, createFakePasswordService() as any);
    const service2 = new DevicesService(consomme as any, createFakePasswordService() as any);

    const erreur1 = await service1.enroll(dto).catch((e) => e.message);
    const erreur2 = await service2.enroll(dto).catch((e) => e.message);

    expect(erreur1).toBe(erreur2);
    expect(erreur1).toMatch(/invalide ou expiré/);
  });

  it("matériel déjà enrôlé ailleurs : 409 distinct — le jeton, lui, était valide", async () => {
    const prisma = createFakePrisma({ candidats: [candidat] });
    (prisma as any).device.updateMany = vi.fn().mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["imei_or_serial"] },
      }),
    );
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await expect(service.enroll(dto)).rejects.toThrow(ConflictException);
  });
});

describe("DevicesService.revoke", () => {
  it("coupe le terminal sans jamais le supprimer", async () => {
    const prisma = createFakePrisma({ device: { id: "device-1", status: "active" } });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.revoke(ORG, "device-1", "user-2");

    expect((prisma as any).device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "device-1" },
        data: expect.objectContaining({ status: "revoked", revokedByUserId: "user-2" }),
      }),
    );
  });

  it("terminal d'un tiers et terminal inexistant : même 404", async () => {
    const prisma = createFakePrisma({ device: null });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await expect(service.revoke(ORG, "device-tiers", "user-2")).rejects.toThrow(NotFoundException);
    expect((prisma as any).device.update).not.toHaveBeenCalled();
  });

  // update() ne peut pas porter la colonne de scope : c'est CETTE lecture qui
  // fait barrière. Sans la double clause, un id de terminal tiers passerait dès
  // que le RLS est contourné ou absent — le test doit donc regarder la clause,
  // pas seulement le fait que la lecture rende null.
  it("le terminal est lu avec la DOUBLE CLAUSE, jamais par id seul", async () => {
    const prisma = createFakePrisma({ device: { id: "device-1", status: "active" } });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.revoke(ORG, "device-1", "user-2");

    expect((prisma as any).device.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "device-1", organizationId: ORG } }),
    );
  });

  it("pose app.current_org_id sur l'organisation du RolesGuard", async () => {
    const prisma = createFakePrisma({ device: { id: "device-1", status: "active" } });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.revoke("org-a-proteger", "device-1", "user-2");

    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });
});

describe("DevicesService.list", () => {
  it("n'expose jamais l'empreinte du jeton ni la clé publique", async () => {
    const prisma = createFakePrisma();
    (prisma as any).device.findMany = vi.fn().mockResolvedValue([]);
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.list(ORG);

    const select = (prisma as any).device.findMany.mock.calls[0][0].select;
    expect(select.enrollmentTokenHash).toBeUndefined();
    expect(select.publicKey).toBeUndefined();
  });

  it("double clause et scope épinglé sur l'organisation du RolesGuard", async () => {
    const prisma = createFakePrisma();
    (prisma as any).device.findMany = vi.fn().mockResolvedValue([]);
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await service.list("org-a-proteger");

    expect((prisma as any).device.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a-proteger" } }),
    );
    const extension = (prisma as any).$extends.mock.calls[0][0];
    await extension.query.$allModels.$allOperations({ args: {}, query: async () => null });
    const setConfig = (prisma as any).$executeRaw.mock.calls.at(-1)?.[0];
    expect(setConfig.values).toContain("org-a-proteger");
  });

  it("révocation idempotente refusée explicitement (409, jamais un no-op silencieux)", async () => {
    const prisma = createFakePrisma({ device: { id: "device-1", status: "revoked" } });
    const service = new DevicesService(prisma as any, createFakePasswordService() as any);

    await expect(service.revoke(ORG, "device-1", "user-2")).rejects.toThrow(ConflictException);
  });
});
