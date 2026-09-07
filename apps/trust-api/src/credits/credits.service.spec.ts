import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CreditsService } from "./credits.service";
import {
  PACK_SMS_CENTIMES,
  PACK_SMS_QUANTITE,
  TARIF_SMS_CENTIMES,
  TARIF_WHATSAPP_CENTIMES,
  canauxFactures,
} from "./credits.constants";

// organizationScopedClient() appelle `$extends`, setOrganizationScope() pose le
// GUC via `$executeRaw`. `$transaction` bi-forme : la forme fonction sert aux
// transactions interactives du service, la forme tableau à makeScopedOperation()
// — c'est elle qui rend l'extension rejouable, seul moyen d'épingler la VALEUR
// du scope, le faux `$extends` se renvoyant lui-même.
function auClientScope<T extends Record<string, unknown>>(prisma: T): T {
  const p = prisma as Record<string, unknown>;
  p.$extends = vi.fn(() => prisma);
  p.$executeRaw = p.$executeRaw ?? vi.fn().mockResolvedValue(1);
  p.$transaction =
    p.$transaction ?? vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  return prisma;
}

const ORG = "org-1";

function fakePrisma(soldeInitial = 0n) {
  let solde = soldeInitial;
  const prisma: any = auClientScope({
    organization: {
      findUniqueOrThrow: vi.fn(async () => ({ creditBalanceCentimes: solde })),
      findFirstOrThrow: vi.fn(async () => ({ creditBalanceCentimes: solde })),
      update: vi.fn(async ({ data }: any) => {
        solde = data.creditBalanceCentimes;
        return { creditBalanceCentimes: solde };
      }),
    },
    creditTransaction: {
      create: vi.fn(async ({ data }: any) => ({ id: "mvt-1", ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn(async () => ({ _sum: { amountCentimes: 0n } })),
    },
  });
  Object.defineProperty(prisma, "solde", { get: () => solde });
  return prisma;
}

function service(prisma: any) {
  return new CreditsService(prisma as never);
}

describe("tarifs", () => {
  // Le pack commercial est la SEULE valeur communiquée : 100 SMS pour
  // 30 000 GNF. Le tarif unitaire en découle, il ne se pose pas à côté.
  it("le tarif du SMS découle exactement du pack vendu", () => {
    expect(TARIF_SMS_CENTIMES * BigInt(PACK_SMS_QUANTITE)).toBe(PACK_SMS_CENTIMES);
    // 30 000 GNF = 3 000 000 centimes.
    expect(PACK_SMS_CENTIMES).toBe(3_000_000n);
    // 300 GNF le SMS.
    expect(TARIF_SMS_CENTIMES).toBe(30_000n);
  });

  it("WhatsApp coûte moins cher que le SMS", () => {
    expect(TARIF_WHATSAPP_CENTIMES).toBeLessThan(TARIF_SMS_CENTIMES);
  });

  // Un client en `both` reçoit deux messages : il doit être débité deux fois.
  it.each([
    ["sms", ["sms"]],
    ["whatsapp", ["whatsapp"]],
    ["both", ["sms", "whatsapp"]],
  ])("canal %s → %s", (canal, attendu) => {
    expect(canauxFactures(canal as never)).toEqual(attendu);
  });
});

describe("CreditsService.grant", () => {
  it("crédite le portefeuille et écrit le mouvement", async () => {
    const prisma = fakePrisma(0n);
    const resultat = await service(prisma).grant(ORG, 3_000_000n, "Pack 100 SMS");

    expect(resultat.balanceAfterCentimes).toBe(3_000_000n);
    const data = prisma.creditTransaction.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: "purchase",
      amountCentimes: 3_000_000n,
      balanceAfterCentimes: 3_000_000n,
      label: "Pack 100 SMS",
    });
  });

  // Le solde dénormalisé et le registre sont écrits ENSEMBLE : l'un sans
  // l'autre rendrait le portefeuille faux sans que rien ne le signale.
  it("écrit le registre ET le solde", async () => {
    const prisma = fakePrisma(0n);
    await service(prisma).grant(ORG, 1_000n, "Geste commercial");

    expect(prisma.creditTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.organization.update).toHaveBeenCalledTimes(1);
  });

  it("refuse un rechargement nul ou négatif", async () => {
    const prisma = fakePrisma(0n);
    await expect(service(prisma).grant(ORG, 0n, "X")).rejects.toThrow(ConflictException);
    await expect(service(prisma).grant(ORG, -100n, "X")).rejects.toThrow(ConflictException);
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
  });
});

describe("CreditsService.consume", () => {
  it("débite le tarif du canal", async () => {
    const prisma = fakePrisma(3_000_000n);
    const resultat = await service(prisma).consume(ORG, "sms", "Relance SMS — FG-1", "inv-1");

    expect(resultat?.balanceAfterCentimes).toBe(3_000_000n - TARIF_SMS_CENTIMES);
    const data = prisma.creditTransaction.create.mock.calls[0][0].data;
    // Le montant est SIGNÉ : la somme de la colonne est le solde, sans règle
    // de signe à réappliquer à la lecture.
    expect(data.amountCentimes).toBe(-TARIF_SMS_CENTIMES);
    expect(data.type).toBe("consumption");
    expect(data.invoiceId).toBe("inv-1");
  });

  // LE TEST CENTRAL. Solde insuffisant : rien n'est écrit, et le service rend
  // null plutôt que de lever — c'est l'appelant qui sait si l'envoi peut être
  // annulé.
  it("solde insuffisant : rend null et n'écrit RIEN", async () => {
    const prisma = fakePrisma(1_000n);
    const resultat = await service(prisma).consume(ORG, "sms", "Relance");

    expect(resultat).toBeNull();
    expect(prisma.creditTransaction.create).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  // Un portefeuille ne descend jamais sous zéro : un solde négatif serait une
  // dette que rien dans ce système ne sait recouvrer.
  it("un solde exactement suffisant passe, un centime de moins non", async () => {
    const juste = fakePrisma(TARIF_SMS_CENTIMES);
    expect(await service(juste).consume(ORG, "sms", "R")).not.toBeNull();
    expect(juste.solde).toBe(0n);

    const insuffisant = fakePrisma(TARIF_SMS_CENTIMES - 1n);
    expect(await service(insuffisant).consume(ORG, "sms", "R")).toBeNull();
  });
});

describe("CreditsService.refund", () => {
  it("remet le tarif en crédit", async () => {
    const prisma = fakePrisma(0n);
    await service(prisma).refund(ORG, "whatsapp", "Annulation relance", "inv-1");

    const data = prisma.creditTransaction.create.mock.calls[0][0].data;
    expect(data.amountCentimes).toBe(TARIF_WHATSAPP_CENTIMES);
    expect(data.type).toBe("refund");
  });
});

describe("CreditsService.reconcile", () => {
  // Le registre est la vérité : la réconciliation ne peut que corriger le
  // solde dénormalisé, jamais l'inverse.
  it("corrige un solde qui a dérivé du registre", async () => {
    const prisma = fakePrisma(999n);
    prisma.creditTransaction.aggregate = vi.fn(async () => ({ _sum: { amountCentimes: 500n } }));

    const { avant, apres } = await service(prisma).reconcile(ORG);

    expect(avant).toBe(999n);
    expect(apres).toBe(500n);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { creditBalanceCentimes: 500n } }),
    );
  });

  it("n'écrit rien quand le solde est déjà juste", async () => {
    const prisma = fakePrisma(500n);
    prisma.creditTransaction.aggregate = vi.fn(async () => ({ _sum: { amountCentimes: 500n } }));

    await service(prisma).reconcile(ORG);

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

describe("RLS", () => {
  // Un relevé de compte est ce qu'une organisation a de plus privé après ses
  // factures : chaque mouvement pose le GUC sur l'organisation ciblée.
  it("pose app.current_org_id sur l'organisation débitée, jamais une autre", async () => {
    const prisma = fakePrisma(3_000_000n);
    await service(prisma).consume("org-a-proteger", "sms", "R");

    const setConfig = prisma.$executeRaw.mock.calls[0]?.[0];
    expect(setConfig.values).toContain("app.current_org_id");
    expect(setConfig.values).toContain("org-a-proteger");
  });

  it("le relevé est lu sous scope, antéchronologique", async () => {
    const prisma = fakePrisma(0n);
    await service(prisma).getStatement("org-a-proteger");

    expect(prisma.$extends).toHaveBeenCalled();
    const args = prisma.creditTransaction.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: "org-a-proteger" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  // Un relevé non borné sur une organisation active serait une réponse HTTP
  // sans fin.
  it("le relevé est plafonné", async () => {
    const prisma = fakePrisma(0n);
    await service(prisma).getStatement(ORG, 10_000);

    expect(prisma.creditTransaction.findMany.mock.calls[0][0].take).toBe(200);
  });
});
