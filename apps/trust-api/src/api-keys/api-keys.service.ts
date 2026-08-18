import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApiKeyEnvironment, PrismaClient } from "@facture-gn/db";
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
  async createApiKey(organizationId: string, environment: ApiKeyEnvironment) {
    const { secret, keySuffix } = generateApiKeySecret(environment);
    const keyHash = await this.passwordService.hash(secret);

    const apiKey = await this.prisma.apiKey.create({
      data: { organizationId, environment, keyHash, keySuffix },
    });

    return { id: apiKey.id, secret, environment };
  }

  // Jamais keyHash dans la réponse — label masqué reconstruit depuis
  // environment + keySuffix, même format que le schéma openapi ApiKey.
  async listApiKeys(organizationId: string) {
    const apiKeys = await this.prisma.apiKey.findMany({
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

  // IDOR — organizationId JAMAIS déduit de apiKeyId seul : vérifié explicitement
  // contre l'organisation ciblée par l'URL, même discipline que
  // CustomersService.merge() (E4). NotFoundException générique dans les deux cas
  // (clé d'une autre organisation vs clé inexistante) : ne révèle jamais si une
  // clé existe ailleurs.
  async revokeApiKey(organizationId: string, apiKeyId: string) {
    const apiKey = await this.prisma.apiKey.findUniqueOrThrow({ where: { id: apiKeyId } });
    if (apiKey.organizationId !== organizationId) {
      throw new NotFoundException(`Clé API ${apiKeyId} introuvable pour cette organisation`);
    }
    if (apiKey.revokedAt) {
      throw new ConflictException(`Clé API ${apiKeyId} déjà révoquée`);
    }

    return this.prisma.apiKey.update({ where: { id: apiKeyId }, data: { revokedAt: new Date() } });
  }

  private buildLabel(environment: ApiKeyEnvironment, keySuffix: string): string {
    const envTag = environment === "production" ? "live" : "test";
    return `fg_${envTag}_••••${keySuffix}`;
  }
}
