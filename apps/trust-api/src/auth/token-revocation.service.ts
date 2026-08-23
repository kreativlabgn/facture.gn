import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";

// Security Audit 2026-08-23, finding #14 — capacité MINIMALE de révocation
// immédiate d'un JWT compromis. Ce n'est PAS un système de refresh token
// rotatif (hors scope, chantier séparé) : l'access token reste un JWT RS256
// classique (auth-token.service.ts, TTL 12h inchangé), simplement consulté
// contre cette liste par JwtAuthGuard à chaque requête. upsert (jamais create
// seul) : un logout rejoué avec le même jti (retry réseau) ne doit jamais lever
// une erreur de contrainte unique.
@Injectable()
export class TokenRevocationService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async revoke(jti: string, expiresAt: Date): Promise<void> {
    await this.prisma.revokedToken.upsert({
      where: { jti },
      update: {},
      create: { jti, expiresAt },
    });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const row = await this.prisma.revokedToken.findUnique({ where: { jti } });
    return row !== null;
  }
}
