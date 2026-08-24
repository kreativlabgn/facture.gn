import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";

export interface AuthTokenPayload {
  sub: string;
  // Security Audit 2026-08-23, finding #14 — identifiant unique par token émis,
  // seule clé consultée par TokenRevocationService/RevokedToken pour une
  // révocation immédiate (POST /auth/logout). exp est ajouté automatiquement par
  // jsonwebtoken à la signature (claim standard) et relu tel quel par verify() —
  // jamais recalculé ici.
  jti: string;
  exp?: number;
  // Cross-Story Audit 2026-08-24, finding #1 — portée du token. undefined/absent
  // (login()/register()) = portée complète, comportement historique inchangé.
  // "client_portal" (ClientPortalAuthService.verifyOtp(), OTP F13) = un contrôle
  // de numéro de téléphone SEULEMENT, jamais un mot de passe — RolesGuard rejette
  // désormais explicitement ce scope sur toute route @Roles(), et
  // ClientPortalScopeGuard n'accepte que ce scope (ou son absence) sur les
  // routes du portail client. Aucune autre valeur n'existe à ce jour.
  scope?: string;
}

export interface AuthTokenService {
  sign(payload: Omit<AuthTokenPayload, "jti" | "exp">): Promise<string>;
  verify(token: string): Promise<AuthTokenPayload>;
}

// ADR-011 : JWT RS256 pour l'authentification (distinct de la signature Ed25519
// par requête, non couverte par ce sprint — voir plan auth-rbac, alternatives écartées).
// Clé privée/publique en PEM via variables d'environnement en dev.
// TODO(ADR-008) : migrer vers HashiCorp Vault Transit en production, sans changer
// cette interface ni ses appelants.
export class JwtAuthTokenService implements AuthTokenService {
  private readonly jwt: JwtService;

  constructor(privateKey: string, publicKey: string, options: { expiresIn?: string } = {}) {
    this.jwt = new JwtService({
      privateKey,
      publicKey,
      // expiresIn accepte tout format "vercel/ms" ("12h", "1ms", ...) ; le typage de
      // @nestjs/jwt exige le type interne StringValue du package transitif "ms", non
      // résolvable ici en import direct — cast local plutôt que dépendance ajoutée
      // uniquement pour un type.
      signOptions: { algorithm: "RS256", expiresIn: (options.expiresIn ?? "12h") as never },
    });
  }

  sign(payload: Omit<AuthTokenPayload, "jti" | "exp">): Promise<string> {
    return this.jwt.signAsync({ ...payload, jti: randomUUID() });
  }

  verify(token: string): Promise<AuthTokenPayload> {
    return this.jwt.verifyAsync<AuthTokenPayload>(token, { algorithms: ["RS256"] });
  }
}
