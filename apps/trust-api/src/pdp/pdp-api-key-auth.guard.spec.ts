import { createHash } from "node:crypto";
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PdpApiKeyAuthGuard } from "./pdp-api-key-auth.guard";
import { PDP_API_KEY_HEADER } from "./pdp.constants";

const ORG = "org-1";
const API_KEY_ID = "key-1";

// Un secret de la forme EXACTE produite par generateApiKeySecret() : préfixe
// d'environnement + 48 caractères hexadécimaux. Un secret de forme approximative
// serait écarté par apiKeySuffixOf() avant toute lecture, et le test ne
// vérifierait plus rien du chemin nominal.
const SECRET = `fg_live_${"a".repeat(44)}b3f9`;
const SUFFIXE = "b3f9";

// argon2 réel serait lent et sans intérêt ici. Le faux hachage doit être NON
// INVERSIBLE, jamais un `hache(${clair})` : un faux qui embarque le clair
// rendrait impossible toute assertion de non-fuite (même discipline que
// devices.service.spec.ts).
const empreinte = (clair: string) => `argon2id${createHash("sha256").update(clair).digest("hex")}`;

function fakePasswordService(secretAttendu = SECRET) {
  return {
    hash: vi.fn(async (clair: string) => empreinte(clair)),
    verify: vi.fn(async (hache: string, clair: string) => hache === empreinte(secretAttendu) && clair === secretAttendu),
    generateTemporaryPassword: vi.fn(),
  };
}

// organizationScopedClient() appelle `$extends` ; `$extends` rend le client
// LUI-MÊME pour que les mocks de modèle restent partagés. `$transaction`
// bi-forme : la forme tableau est celle qu'emploie makeScopedOperation().
function fakePrisma(
  overrides: { candidates?: unknown[]; organization?: unknown } = {},
) {
  const p: any = {
    apiKey: {
      findMany: vi.fn().mockResolvedValue(
        overrides.candidates ?? [{ id: API_KEY_ID, organizationId: ORG, keyHash: empreinte(SECRET) }],
      ),
    },
    organization: {
      findFirst: vi
        .fn()
        .mockResolvedValue("organization" in overrides ? overrides.organization : { commercialTier: "enterprise" }),
    },
  };
  p.$extends = vi.fn(() => p);
  p.$executeRaw = vi.fn().mockResolvedValue(1);
  p.$transaction = vi.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(p)));
  return p;
}

function contexte(headers: Record<string, unknown>) {
  const request: any = { headers };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function garde(prisma: any, passwordService = fakePasswordService()) {
  return new PdpApiKeyAuthGuard(prisma, passwordService as any);
}

describe("PdpApiKeyAuthGuard (ADR-107)", () => {
  it("laisse passer une clé valide d'une organisation enterprise", async () => {
    const prisma = fakePrisma();
    const { context, request } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await expect(garde(prisma).canActivate(context)).resolves.toBe(true);
    expect(request.pdpClient).toEqual({ organizationId: ORG, apiKeyId: API_KEY_ID });
  });

  it("laisse passer une organisation custom", async () => {
    const prisma = fakePrisma({ organization: { commercialTier: "custom" } });
    const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await expect(garde(prisma).canActivate(context)).resolves.toBe(true);
  });

  // 403 EXPLICITE, contrairement aux échecs d'authentification : la clé est
  // valide, l'appelant est bien qui il prétend être, et son propre palier n'est
  // pas un secret pour lui. Lui cacher la raison ne protégerait rien.
  it("refuse un palier pro avec un 403 nommant le palier requis", async () => {
    const prisma = fakePrisma({ organization: { commercialTier: "pro" } });
    const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await expect(garde(prisma).canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(garde(prisma).canActivate(context)).rejects.toThrow(/enterprise/);
  });

  it.each(["freemium", "starter", "starter_plus", "pro"])(
    "refuse le palier %s",
    async (tier) => {
      const prisma = fakePrisma({ organization: { commercialTier: tier } });
      const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

      await expect(garde(prisma).canActivate(context)).rejects.toThrow(ForbiddenException);
    },
  );

  it("n'expose aucun contexte connecteur quand le palier est refusé", async () => {
    const prisma = fakePrisma({ organization: { commercialTier: "pro" } });
    const { context, request } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await expect(garde(prisma).canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(request.pdpClient).toBeUndefined();
  });

  describe("échecs d'authentification — message unique, jamais un oracle", () => {
    // Un connecteur ne doit pas pouvoir distinguer « clé inconnue » de « clé
    // révoquée » : la différence transformerait l'endpoint en oracle
    // d'énumération des clés en circulation.
    const messages: string[] = [];

    it.each([
      ["en-tête absent", {}],
      ["en-tête vide", { [PDP_API_KEY_HEADER]: "" }],
      ["en-tête non textuel", { [PDP_API_KEY_HEADER]: ["a", "b"] }],
      ["préfixe étranger", { [PDP_API_KEY_HEADER]: `sk_live_${"a".repeat(48)}` }],
      ["longueur incorrecte", { [PDP_API_KEY_HEADER]: "fg_live_deadbeef" }],
      ["hexadécimal invalide", { [PDP_API_KEY_HEADER]: `fg_live_${"z".repeat(48)}` }],
    ])("%s → 401", async (_libelle, headers) => {
      const prisma = fakePrisma();
      const { context } = contexte(headers as Record<string, unknown>);

      await expect(garde(prisma).canActivate(context)).rejects.toThrow(UnauthorizedException);
      // Aucune lecture : une chaîne mal formée ne peut correspondre à aucune
      // ligne, la payer d'une requête offrirait un levier de charge gratuit sur
      // un endpoint public.
      expect(prisma.apiKey.findMany).not.toHaveBeenCalled();

      await garde(prisma)
        .canActivate(context)
        .catch((error: Error) => messages.push(error.message));
    });

    it("clé bien formée mais inconnue → 401", async () => {
      const prisma = fakePrisma({ candidates: [] });
      const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

      await garde(prisma)
        .canActivate(context)
        .catch((error: Error) => messages.push(error.message));
      await expect(garde(prisma).canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("clé dont le suffixe correspond mais dont le hash ne vérifie pas → 401", async () => {
      const prisma = fakePrisma({
        candidates: [{ id: "autre", organizationId: "org-2", keyHash: empreinte("un-autre-secret") }],
      });
      const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

      await expect(garde(prisma).canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("organisation disparue → 401, jamais une trace différenciée", async () => {
      const prisma = fakePrisma({ organization: null });
      const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

      await garde(prisma)
        .canActivate(context)
        .catch((error: Error) => messages.push(error.message));
      await expect(garde(prisma).canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it("tous les échecs d'authentification portent le MÊME message", () => {
      expect(new Set(messages).size).toBe(1);
    });
  });

  it("ne considère jamais une clé révoquée comme candidate", async () => {
    const prisma = fakePrisma();
    const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await garde(prisma).canActivate(context);

    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keySuffix: SUFFIXE, revokedAt: null } }),
    );
  });

  // La lecture de découverte ne doit jamais rapatrier plus que nécessaire : le
  // keyHash sert à la vérification, rien d'autre ne quitte la base.
  it("ne sélectionne que les colonnes strictement nécessaires à la découverte", async () => {
    const prisma = fakePrisma();
    const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await garde(prisma).canActivate(context);

    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, organizationId: true, keyHash: true } }),
    );
  });

  // RLS (ADR-111) — dès que la clé est identifiée, TOUT redevient scopé. La
  // lecture du palier commercial passe donc par organizationScopedClient, qui
  // pose le GUC via $extends.
  it("lit le palier commercial sous scope organisation, jamais en clair", async () => {
    const prisma = fakePrisma();
    const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await garde(prisma).canActivate(context);

    expect(prisma.$extends).toHaveBeenCalled();
    // findFirst et double clause — jamais findUnique via un client scopé.
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORG } }),
    );
  });

  it("s'arrête à la première clé qui vérifie, sans éprouver les suivantes", async () => {
    const passwordService = fakePasswordService();
    const prisma = fakePrisma({
      candidates: [
        { id: API_KEY_ID, organizationId: ORG, keyHash: empreinte(SECRET) },
        { id: "jamais-atteinte", organizationId: "org-2", keyHash: empreinte("autre") },
      ],
    });
    const { context } = contexte({ [PDP_API_KEY_HEADER]: SECRET });

    await garde(prisma, passwordService).canActivate(context);

    expect(passwordService.verify).toHaveBeenCalledTimes(1);
  });
});
