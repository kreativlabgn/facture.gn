import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApiKeyEnvironment, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PASSWORD_SERVICE } from "../auth/auth.tokens";
import type { PasswordService } from "../auth/password.service";
import { generateApiKeySecret } from "./api-key-secret";

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(PASSWORD_SERVICE) private readonly passwordService: PasswordService,
  ) {}

  // F15, ADR-097 — secret retourné une seule fois, jamais stocké tel quel
  // (argon2id via PasswordService, même primitive que les mots de passe).
  // createdByUserId tracé (trouvé en revue dev-security-reviewer) : une clé
  // d'API est un secret d'organisation, savoir qui l'a générée importe autant
  // que pour un mot de passe temporaire (B3) — sans ça, aucune organisation
  // à plusieurs owner/admin/developer_api ne peut savoir qui a créé quoi.
  async createApiKey(organizationId: string, environment: ApiKeyEnvironment, requestedByUserId: string) {
    const { secret, keySuffix } = generateApiKeySecret(environment);
    const keyHash = await this.passwordService.hash(secret);

    // Aucune transaction ici : une création de clé n'invalide rien (les clés
    // coexistent jusqu'à révocation explicite), donc pas de setOrganizationScope().
    const apiKey = await organizationScopedClient(this.prisma, organizationId).apiKey.create({
      data: { organizationId, environment, keyHash, keySuffix, createdByUserId: requestedByUserId },
    });

    return { id: apiKey.id, secret, environment };
  }

  // Jamais keyHash dans la réponse — label masqué reconstruit depuis
  // environment + keySuffix, même format que le schéma openapi ApiKey.
  async listApiKeys(organizationId: string) {
    const apiKeys = await organizationScopedClient(this.prisma, organizationId).apiKey.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return apiKeys.map((apiKey) => ({
      id: apiKey.id,
      label: this.buildLabel(apiKey.environment, apiKey.keySuffix),
      environment: apiKey.environment,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
    }));
  }

  // IDOR — organizationId JAMAIS déduit de apiKeyId seul : la double clause
  // `where: { id, organizationId }` porte désormais cette vérification, là où un
  // findUniqueOrThrow suivi d'une comparaison applicative la portait avant. Les
  // deux cas (clé d'une autre organisation, clé inexistante) deviennent
  // littéralement indistinguables — c'était déjà l'intention documentée ici, mais
  // findUniqueOrThrow lançait une NotFoundError Prisma non interceptée sur le
  // second cas (aucun ExceptionFilter dans cette application, vérifié) : un 500
  // au lieu du 404 annoncé. Le findFirst nullable + le throw explicite ci-dessous
  // rendent enfin les deux réponses identiques.
  async revokeApiKey(organizationId: string, apiKeyId: string, revokedByUserId: string) {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const apiKey = await scoped.apiKey.findFirst({ where: { id: apiKeyId, organizationId } });
    if (!apiKey) {
      throw new NotFoundException(`Clé API ${apiKeyId} introuvable pour cette organisation`);
    }
    if (apiKey.revokedAt) {
      throw new ConflictException(`Clé API ${apiKeyId} déjà révoquée`);
    }

    // update() exige un `where` unique et ne peut pas porter la colonne de
    // scope : la lecture scopée ci-dessus est la barrière.
    return scoped.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date(), revokedByUserId },
    });
  }

  private buildLabel(environment: ApiKeyEnvironment, keySuffix: string): string {
    const envTag = environment === "production" ? "live" : "test";
    return `fg_${envTag}_••••${keySuffix}`;
  }
}
