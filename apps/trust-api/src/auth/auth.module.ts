import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { Argon2PasswordService, type PasswordService } from "./password.service";
import { JwtAuthTokenService, type AuthTokenService } from "./auth-token.service";
import { TokenRevocationService } from "./token-revocation.service";
import { PASSWORD_SERVICE, AUTH_TOKEN_SERVICE } from "./auth.tokens";
import { ClientPortalModule } from "../client-portal/client-portal.module";

// Clés RS256 (ADR-011) en PEM via l'environnement, `\n` littéraux à décoder — pattern
// standard pour stocker un PEM multiligne dans une variable d'environnement dotenv.
// TODO(ADR-008) : migrer vers HashiCorp Vault Transit en production.
function readPemFromEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} manquant — voir README pour générer une paire de clés RS256 de dev`);
  }
  return value.replace(/\\n/g, "\n");
}

// Cross-Story Audit 2026-08-24, finding #2 — ClientPortalModule importé pour
// ClientPortalOtpService (réclamation d'un compte fantôme F13 dans
// AuthService.register(), voir auth.service.ts). Pas de cycle de modules :
// ClientPortalModule n'importe jamais AuthModule (il consomme
// PASSWORD_SERVICE/AUTH_TOKEN_SERVICE via @Global(), sans edge explicite dans
// le graphe de modules Nest).
@Global()
@Module({
  imports: [ClientPortalModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenRevocationService,
    {
      provide: PASSWORD_SERVICE,
      useFactory: (): PasswordService => new Argon2PasswordService(),
    },
    {
      provide: AUTH_TOKEN_SERVICE,
      useFactory: (): AuthTokenService =>
        new JwtAuthTokenService(readPemFromEnv("JWT_PRIVATE_KEY"), readPemFromEnv("JWT_PUBLIC_KEY")),
    },
  ],
  exports: [AUTH_TOKEN_SERVICE, PASSWORD_SERVICE, TokenRevocationService],
})
export class AuthModule {}
